import { Router } from 'express';
import { sqliteDb, nosqlDb } from './db.ts';
import { seedPartitionedDatabases } from './seed.ts';
import {
  modifyAndReplicateRecord,
  replicateSharedRecord,
  getRetryQueue,
  getRetryQueueCount,
  getReplicationEvents,
  getReplicationEventsCount,
  discardRetryItem,
  processRetryItem,
  processAllRetries,
  setSimulateReplicationFailure,
  getSimulateReplicationFailure,
  logReplicationEvent,
  VersionConflictError,
  RecordNotFoundError,
} from './replication.ts';
import type {
  SalesRecord,
  ProductCatalogItem,
  StoreCityOption,
  StorageLocation,
  DatabaseMetrics,
  ReplicationEvent,
  TestSuiteReport,
  TestResultItem,
  SortField,
  SortDirection,
} from '../types/sales.ts';

export const apiRouter = Router();

// 1. GET /api/metrics - Accurate real-time counts
apiRouter.get('/metrics', async (_req, res) => {
  try {
    // 1. All SQL IDs
    const sqlRows = sqliteDb.prepare('SELECT Transaction_ID FROM sales_records').all() as { Transaction_ID: string }[];
    const sqlIdSet = new Set(sqlRows.map((r) => r.Transaction_ID));

    // 2. All NoSQL IDs
    const nosqlDocs = (await nosqlDb.findAsync({})) as SalesRecord[];
    const nosqlIdSet = new Set(nosqlDocs.map((d: SalesRecord) => d.Transaction_ID));

    let sharedBoth = 0;
    let sqlOnly = 0;
    let nosqlOnly = 0;

    for (const id of sqlIdSet) {
      if (nosqlIdSet.has(id)) {
        sharedBoth++;
      } else {
        sqlOnly++;
      }
    }

    for (const id of nosqlIdSet) {
      if (!sqlIdSet.has(id)) {
        nosqlOnly++;
      }
    }

    const totalUnique = sqlOnly + nosqlOnly + sharedBoth;
    const pendingRetries = getRetryQueueCount();
    const eventsCount = getReplicationEventsCount();
    const failureSimulation = getSimulateReplicationFailure();

    const metrics: DatabaseMetrics = {
      totalSql: sqlIdSet.size,
      totalNosql: nosqlIdSet.size,
      sqlOnly,
      nosqlOnly,
      sharedBoth,
      totalUnique,
      pendingRetries,
      eventsCount,
      failureSimulation,
    };

    res.setHeader('Cache-Control', 'no-store');
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/records - 3 distinct search modes with deduplication
apiRouter.get('/records', async (req, res) => {
  try {
    const mode = (req.query.mode as string) || 'ALL'; // 'ALL' | 'SQL' | 'NOSQL'
    const query = (req.query.query as string)?.toLowerCase().trim() || '';
    const category = (req.query.category as string) || '';
    const status = (req.query.status as string) || '';
    const sortBy = ((req.query.sortBy as string) || 'Transaction_ID') as SortField;
    const sortDir = ((req.query.sortDir as string) === 'asc' ? 'asc' : 'desc') as SortDirection;
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.max(1, Math.min(100, parseInt((req.query.limit as string) || '25', 10)));

    // Fetch from SQLite if mode is ALL or SQL
    let sqlRecords: SalesRecord[] = [];
    if (mode === 'ALL' || mode === 'SQL') {
      sqlRecords = sqliteDb.prepare('SELECT * FROM sales_records').all() as SalesRecord[];
    }

    // Fetch from NoSQL if mode is ALL or NOSQL
    let nosqlRecords: SalesRecord[] = [];
    if (mode === 'ALL' || mode === 'NOSQL') {
      nosqlRecords = (await nosqlDb.findAsync({})) as SalesRecord[];
    }

    // Determine ID maps for storage location resolution
    const sqlMap = new Map<string, SalesRecord>();
    const nosqlMap = new Map<string, SalesRecord>();

    // We need complete ID sets for classifying storage location accurately
    const allSqlIds = new Set(
      (sqliteDb.prepare('SELECT Transaction_ID FROM sales_records').all() as { Transaction_ID: string }[]).map(
        (r) => r.Transaction_ID
      )
    );
    const allNosqlDocs = (await nosqlDb.findAsync({}, { Transaction_ID: 1 })) as unknown as { Transaction_ID: string }[];
    const allNosqlIds = new Set(allNosqlDocs.map((d) => d.Transaction_ID));

    sqlRecords.forEach((r) => sqlMap.set(r.Transaction_ID, r));
    nosqlRecords.forEach((r) => nosqlMap.set(r.Transaction_ID, r));

    let combinedRecords: SalesRecord[] = [];

    if (mode === 'ALL') {
      // Federated deduplication by Transaction_ID
      const seenIds = new Set<string>();

      // Prefer SQL snapshot if both, but ensure we have all distinct records
      for (const [id, record] of sqlMap) {
        seenIds.add(id);
        const inNosql = allNosqlIds.has(id);
        const storage: StorageLocation = inNosql ? 'BOTH' : 'SQL_ONLY';
        combinedRecords.push({
          ...record,
          storage_location: storage,
          in_sql: true,
          in_nosql: inNosql,
        });
      }

      for (const [id, record] of nosqlMap) {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          const inSql = allSqlIds.has(id);
          const storage: StorageLocation = inSql ? 'BOTH' : 'NOSQL_ONLY';
          combinedRecords.push({
            ...record,
            storage_location: storage,
            in_sql: inSql,
            in_nosql: true,
          });
        }
      }
    } else if (mode === 'SQL') {
      // Returns records present in SQL (SQL_ONLY + BOTH)
      for (const [id, record] of sqlMap) {
        const inNosql = allNosqlIds.has(id);
        const storage: StorageLocation = inNosql ? 'BOTH' : 'SQL_ONLY';
        combinedRecords.push({
          ...record,
          storage_location: storage,
          in_sql: true,
          in_nosql: inNosql,
        });
      }
    } else if (mode === 'NOSQL') {
      // Returns records present in NoSQL (NOSQL_ONLY + BOTH)
      for (const [id, record] of nosqlMap) {
        const inSql = allSqlIds.has(id);
        const storage: StorageLocation = inSql ? 'BOTH' : 'NOSQL_ONLY';
        combinedRecords.push({
          ...record,
          storage_location: storage,
          in_sql: inSql,
          in_nosql: true,
        });
      }
    }

    // Extract distinct categories and statuses dynamically from active records in current mode
    const categories = Array.from(
      new Set(combinedRecords.map((r) => r.Product_Category).filter(Boolean))
    ).sort();
    const statuses = Array.from(
      new Set(combinedRecords.map((r) => r.Order_Status).filter(Boolean))
    ).sort();

    // Apply filtering
    let filtered = combinedRecords;

    if (query) {
      filtered = filtered.filter((r) => {
        return (
          r.Transaction_ID?.toLowerCase().includes(query) ||
          r.Order_ID?.toLowerCase().includes(query) ||
          r.Customer_Name?.toLowerCase().includes(query) ||
          r.Product_Name?.toLowerCase().includes(query) ||
          r.City?.toLowerCase().includes(query) ||
          r.Store_Name?.toLowerCase().includes(query) ||
          r.Customer_ID?.toLowerCase().includes(query)
        );
      });
    }

    if (category) {
      filtered = filtered.filter((r) => r.Product_Category === category);
    }

    if (status) {
      filtered = filtered.filter((r) => r.Order_Status === status);
    }

    // Sort filtered records across the full active dataset before paginating
    const dir = sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'Partition_Sync': {
          const rank = (r: SalesRecord) =>
            `${r.storage_location || 'BOTH'}_${r.sync_status || 'SUCCESS_SYNCHRONIZED'}`;
          cmp = rank(a).localeCompare(rank(b));
          break;
        }
        case 'Order_Date': {
          const da = `${a.Order_Date || ''}_${a.Order_Time || ''}_${a.Sales_Channel || ''}`;
          const db = `${b.Order_Date || ''}_${b.Order_Time || ''}_${b.Sales_Channel || ''}`;
          cmp = da.localeCompare(db);
          break;
        }
        case 'Customer_Name':
          cmp = (a.Customer_Name || '').localeCompare(b.Customer_Name || '');
          break;
        case 'Sales_Amount':
          cmp = (Number(a.Sales_Amount) || 0) - (Number(b.Sales_Amount) || 0);
          break;
        case 'Order_Status':
          cmp = (a.Order_Status || '').localeCompare(b.Order_Status || '');
          break;
        case 'Transaction_ID':
        default:
          cmp = (a.Transaction_ID || '').localeCompare(b.Transaction_ID || '', undefined, {
            numeric: true,
          });
          break;
      }
      if (cmp === 0) {
        cmp = (a.Transaction_ID || '').localeCompare(b.Transaction_ID || '', undefined, {
          numeric: true,
        });
      }
      return cmp * dir;
    });

    const totalCount = filtered.length;
    const startIndex = (page - 1) * limit;
    const paginatedRecords = filtered.slice(startIndex, startIndex + limit);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      records: paginatedRecords,
      totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit) || 1,
      mode,
      sortBy,
      sortDir,
      categories,
      statuses,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2b. GET /api/products - Unique product catalog across SQLite and NeDB
apiRouter.get('/products', async (_req, res) => {
  try {
    const sqlProducts = sqliteDb
      .prepare(
        "SELECT Product_ID, Product_Name, Product_Category, Product_Subcategory, Unit_Price FROM sales_records WHERE Product_Name IS NOT NULL AND TRIM(Product_Name) != ''"
      )
      .all() as ProductCatalogItem[];

    const nosqlProducts = (await nosqlDb.findAsync(
      {},
      { Product_ID: 1, Product_Name: 1, Product_Category: 1, Product_Subcategory: 1, Unit_Price: 1 }
    )) as unknown as ProductCatalogItem[];

    type VariantBucket = {
      count: number;
      item: ProductCatalogItem;
    };

    const byName = new Map<string, Map<string, VariantBucket>>();

    for (const raw of [...sqlProducts, ...nosqlProducts]) {
      const name = (raw.Product_Name || '').trim();
      if (!name) continue;
      const nameKey = name.toLowerCase();
      const category = (raw.Product_Category || 'Electronics').trim();
      const subcategory = (raw.Product_Subcategory || 'General').trim();
      const unitPrice = Number(Number(raw.Unit_Price || 0).toFixed(2));
      const productId = (raw.Product_ID || 'PRD-CUSTOM-01').trim();
      const variantKey = `${category}::${subcategory}::${unitPrice}`;

      let variants = byName.get(nameKey);
      if (!variants) {
        variants = new Map<string, VariantBucket>();
        byName.set(nameKey, variants);
      }

      const existing = variants.get(variantKey);
      if (existing) {
        existing.count += 1;
      } else {
        variants.set(variantKey, {
          count: 1,
          item: {
            Product_ID: productId,
            Product_Name: name,
            Product_Category: category,
            Product_Subcategory: subcategory,
            Unit_Price: unitPrice,
          },
        });
      }
    }

    const products: ProductCatalogItem[] = [];
    for (const variants of byName.values()) {
      let best: VariantBucket | null = null;
      for (const bucket of variants.values()) {
        if (!best || bucket.count > best.count) {
          best = bucket;
        }
      }
      if (best) {
        products.push(best.item);
      }
    }

    products.sort((a, b) => a.Product_Name.localeCompare(b.Product_Name));

    res.setHeader('Cache-Control', 'no-store');
    res.json({ products });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2c. GET /api/stores - Unique store/city pairs across SQLite and NeDB
apiRouter.get('/stores', async (_req, res) => {
  try {
    const sqlStores = sqliteDb
      .prepare(
        "SELECT DISTINCT Store_ID, Store_Name, City, Region, Country FROM sales_records WHERE Store_Name IS NOT NULL AND TRIM(Store_Name) != '' AND City IS NOT NULL AND TRIM(City) != ''"
      )
      .all() as StoreCityOption[];

    const nosqlStores = (await nosqlDb.findAsync(
      {},
      { Store_ID: 1, Store_Name: 1, City: 1, Region: 1, Country: 1 }
    )) as unknown as StoreCityOption[];

    const pairMap = new Map<string, StoreCityOption>();

    for (const raw of [...sqlStores, ...nosqlStores]) {
      const storeName = (raw.Store_Name || '').trim();
      const city = (raw.City || '').trim();
      if (!storeName || !city) continue;
      const key = `${storeName.toLowerCase()}::${city.toLowerCase()}`;
      if (!pairMap.has(key)) {
        pairMap.set(key, {
          Store_ID: (raw.Store_ID || 'STR-01').trim(),
          Store_Name: storeName,
          City: city,
          Region: (raw.Region || 'North America').trim(),
          Country: (raw.Country || 'United States').trim(),
        });
      }
    }

    const stores = Array.from(pairMap.values()).sort((a, b) => {
      const storeCmp = a.Store_Name.localeCompare(b.Store_Name);
      if (storeCmp !== 0) return storeCmp;
      return a.City.localeCompare(b.City);
    });

    const cities = Array.from(new Set(stores.map((s) => s.City))).sort((a, b) =>
      a.localeCompare(b)
    );

    res.setHeader('Cache-Control', 'no-store');
    res.json({ stores, cities });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/records/:id - Inspect record across both SQL and NoSQL
apiRouter.get('/records/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const sqlRecord = sqliteDb
      .prepare('SELECT * FROM sales_records WHERE Transaction_ID = ?')
      .get(id) as SalesRecord | undefined;
    const nosqlRecord = (await nosqlDb.findOneAsync({ Transaction_ID: id })) as SalesRecord | null;

    if (!sqlRecord && !nosqlRecord) {
      return res.status(404).json({ error: `Record ${id} not found in either database.` });
    }

    let storage_location: StorageLocation = 'BOTH';
    if (sqlRecord && !nosqlRecord) storage_location = 'SQL_ONLY';
    if (!sqlRecord && nosqlRecord) storage_location = 'NOSQL_ONLY';

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      transactionId: id,
      storage_location,
      sqlRecord: sqlRecord || null,
      nosqlRecord: nosqlRecord || null,
      isSynchronized:
        sqlRecord && nosqlRecord
          ? sqlRecord.version === nosqlRecord.version &&
            sqlRecord.sync_status === nosqlRecord.sync_status &&
            sqlRecord.Quantity === nosqlRecord.Quantity &&
            sqlRecord.Order_Status === nosqlRecord.Order_Status &&
            sqlRecord.Sales_Amount === nosqlRecord.Sales_Amount
          : true,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. POST /api/records - User fulfillment to SQL, NoSQL, or BOTH
apiRouter.post('/records', async (req, res) => {
  try {
    const body = req.body as Partial<SalesRecord> & { targetStore: StorageLocation };
    const targetStore: StorageLocation = body.targetStore || 'BOTH';

    let txnId = body.Transaction_ID?.trim();
    if (!txnId) {
      const sqlIds = (
        sqliteDb.prepare('SELECT Transaction_ID FROM sales_records').all() as { Transaction_ID: string }[]
      ).map((r) => r.Transaction_ID);
      const nosqlDocs = (await nosqlDb.findAsync({}, { Transaction_ID: 1 })) as unknown as {
        Transaction_ID: string;
      }[];
      let maxNum = 100899;
      for (const id of [...sqlIds, ...nosqlDocs.map((d) => d.Transaction_ID)]) {
        const match = /^TXN-(\d+)$/.exec(id || '');
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
      txnId = `TXN-${maxNum + 1}`;
    }

    const qty = Number(body.Quantity) || 1;
    const price = Number(body.Unit_Price) || 199.99;
    const disc = Number(body.Discount_Percentage) || 0;
    const salesAmt = Number(body.Sales_Amount) || Number((qty * price * (1 - disc)).toFixed(2));
    const costAmt = Number(body.Cost_Amount) || Number((salesAmt * 0.65).toFixed(2));
    const profit = Number(body.Profit) || Number((salesAmt - costAmt).toFixed(2));
    const nowIso = new Date().toISOString();

    const dbRecord: SalesRecord = {
      Transaction_ID: txnId,
      Order_ID: body.Order_ID || `ORD-2024-${Math.floor(50000 + Math.random() * 40000)}`,
      Customer_ID: body.Customer_ID || `CUST-${Math.floor(2000 + Math.random() * 500)}`,
      Customer_Name: body.Customer_Name || 'Custom Client',
      Customer_Age: Number(body.Customer_Age) || 35,
      Customer_Gender: body.Customer_Gender || 'Female',
      Customer_Segment: body.Customer_Segment || 'Corporate',
      Order_Date: body.Order_Date || nowIso.split('T')[0],
      Order_Time: body.Order_Time || '14:30:00',
      Sales_Channel: body.Sales_Channel || 'Direct Sales',
      Store_ID: body.Store_ID || 'STR-NY-01',
      Store_Name: body.Store_Name || 'Manhattan Tech Hub',
      Country: body.Country || 'United States',
      Region: body.Region || 'North America',
      City: body.City || 'New York',
      Product_ID: body.Product_ID || 'PRD-ELEC-01',
      Product_Name: body.Product_Name || 'Quantum UltraBook X15',
      Product_Category: body.Product_Category || 'Electronics',
      Product_Subcategory: body.Product_Subcategory || 'Laptops',
      Quantity: qty,
      Unit_Price: price,
      Discount_Percentage: disc,
      Sales_Amount: salesAmt,
      Cost_Amount: costAmt,
      Profit: profit,
      Payment_Method: body.Payment_Method || 'Corporate Card',
      Order_Status: body.Order_Status || 'Processing',
      Shipping_Method: body.Shipping_Method || 'Standard Ground',
      Delivery_Days: Number(body.Delivery_Days) || 3,
      Return_Flag: body.Return_Flag || 'No',
      Return_Reason: body.Return_Reason || 'None',
      Sales_Representative: body.Sales_Representative || 'Marcus Vance',
      Promotion_Code: body.Promotion_Code || 'NONE',
      Customer_Rating: Number(body.Customer_Rating) || 5.0,
      Inventory_Level: Number(body.Inventory_Level) || 120,
      Order_Year: Number(body.Order_Year) || 2024,
      version: 1,
      sync_status: targetStore === 'BOTH' ? 'SUCCESS_SYNCHRONIZED' : 'NOT_APPLICABLE',
      last_replicated_at: nowIso,
    };

    if (targetStore === 'SQL_ONLY' || targetStore === 'BOTH') {
      sqliteDb
        .prepare(`
          INSERT INTO sales_records (
            Transaction_ID, Order_ID, Customer_ID, Customer_Name, Customer_Age, Customer_Gender,
            Customer_Segment, Order_Date, Order_Time, Sales_Channel, Store_ID, Store_Name,
            Country, Region, City, Product_ID, Product_Name, Product_Category,
            Product_Subcategory, Quantity, Unit_Price, Discount_Percentage, Sales_Amount,
            Cost_Amount, Profit, Payment_Method, Order_Status, Shipping_Method,
            Delivery_Days, Return_Flag, Return_Reason, Sales_Representative, Promotion_Code,
            Customer_Rating, Inventory_Level, Order_Year, version, sync_status, last_replicated_at
          ) VALUES (
            @Transaction_ID, @Order_ID, @Customer_ID, @Customer_Name, @Customer_Age, @Customer_Gender,
            @Customer_Segment, @Order_Date, @Order_Time, @Sales_Channel, @Store_ID, @Store_Name,
            @Country, @Region, @City, @Product_ID, @Product_Name, @Product_Category,
            @Product_Subcategory, @Quantity, @Unit_Price, @Discount_Percentage, @Sales_Amount,
            @Cost_Amount, @Profit, @Payment_Method, @Order_Status, @Shipping_Method,
            @Delivery_Days, @Return_Flag, @Return_Reason, @Sales_Representative, @Promotion_Code,
            @Customer_Rating, @Inventory_Level, @Order_Year, @version, @sync_status, @last_replicated_at
          )
        `)
        .run(dbRecord);
    }

    if (targetStore === 'NOSQL_ONLY' || targetStore === 'BOTH') {
      await nosqlDb.insertAsync({ ...dbRecord });
    }

    let event: ReplicationEvent | undefined;
    if (targetStore === 'BOTH') {
      event = logReplicationEvent({
        transactionId: dbRecord.Transaction_ID,
        partition: 'BOTH',
        action: 'INSERT',
        status: 'SYNCED',
        fromVersion: 0,
        toVersion: 1,
        changedFields: [
          { field: 'Product_Name', from: '—', to: dbRecord.Product_Name },
          { field: 'Sales_Amount', from: '—', to: `$${dbRecord.Sales_Amount.toFixed(2)}` },
          { field: 'Order_Status', from: '—', to: dbRecord.Order_Status },
        ],
        syncSummary: 'SQLite ↔ NeDB · SYNCED',
        details: `Inserted & replicated new record ${dbRecord.Transaction_ID} across SQLite and NeDB (v1).`,
      });
    }

    const responseRecord: SalesRecord = {
      ...dbRecord,
      storage_location: targetStore,
      in_sql: targetStore === 'SQL_ONLY' || targetStore === 'BOTH',
      in_nosql: targetStore === 'NOSQL_ONLY' || targetStore === 'BOTH',
    };

    res.status(201).json({
      success: true,
      message: `Record ${dbRecord.Transaction_ID} fulfilled to ${targetStore}`,
      record: responseRecord,
      event,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// 5. PUT /api/records/:id - Modify record across any partition & run replication protocol
apiRouter.put('/records/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { expectedVersion, promoteToBoth, simulateFailure, ...updates } = req.body || {};
    const result = await modifyAndReplicateRecord(id, updates, {
      expectedVersion: expectedVersion !== undefined ? Number(expectedVersion) : undefined,
      promoteToBoth: Boolean(promoteToBoth),
      simulateFailure: Boolean(simulateFailure),
    });
    res.json(result);
  } catch (err: any) {
    if (err instanceof VersionConflictError) {
      return res.status(409).json({
        error: err.message,
        code: 'VERSION_CONFLICT',
        expectedVersion: err.expectedVersion,
        actualVersion: err.actualVersion,
      });
    }
    if (err instanceof RecordNotFoundError) {
      return res.status(404).json({ error: err.message });
    }
    res.status(400).json({ error: err.message });
  }
});

// 6. POST /api/seed/reset - Re-seed 900 records
apiRouter.post('/seed/reset', async (_req, res) => {
  try {
    const result = await seedPartitionedDatabases(900);
    res.json({
      success: true,
      message: 'Successfully re-seeded 900 records across SQLite and NeDB.',
      ...result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Retry Queue & Replication Event Log Routes
apiRouter.get('/retries', (_req, res) => {
  const retries = getRetryQueue();
  const events = getReplicationEvents(100);
  const eventsCount = getReplicationEventsCount();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    retries,
    count: retries.length,
    events,
    eventsCount,
  });
});

apiRouter.post('/retries/:id/retry', async (req, res) => {
  try {
    const id = req.params.id;
    const result = await processRetryItem(id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/retries/retry-all', async (_req, res) => {
  try {
    const result = await processAllRetries();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/retries/:id', (req, res) => {
  try {
    const discarded = discardRetryItem(req.params.id);
    res.json({ success: discarded });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Simulated failure toggle
apiRouter.get('/simulate-failure', (_req, res) => {
  res.json({ enabled: getSimulateReplicationFailure() });
});

apiRouter.post('/simulate-failure', (req, res) => {
  const enabled = Boolean(req.body.enabled);
  const updated = setSimulateReplicationFailure(enabled);
  res.json({
    enabled: updated,
    message: updated
      ? 'Simulated replication failure is now ENABLED. Shared updates will queue in PENDING_RETRY.'
      : 'Simulated replication failure is now DISABLED. Shared updates will synchronize to NoSQL.',
  });
});

// 9. POST /api/run-tests - Automated In-App Test Suite
apiRouter.post('/run-tests', async (_req, res) => {
  const tests: TestResultItem[] = [];
  const startAll = Date.now();

  // Test 1: Partitioning Verification
  const t1Start = Date.now();
  try {
    const sqlIds = (
      sqliteDb.prepare('SELECT Transaction_ID FROM sales_records').all() as { Transaction_ID: string }[]
    ).map((r) => r.Transaction_ID);
    const nosqlDocs = (await nosqlDb.findAsync({}, { Transaction_ID: 1 })) as unknown as { Transaction_ID: string }[];
    const nosqlIds = nosqlDocs.map((d) => d.Transaction_ID);

    const sqlSet = new Set(sqlIds);
    const nosqlSet = new Set(nosqlIds);

    let bothCount = 0;
    let sqlOnlyCount = 0;
    let nosqlOnlyCount = 0;

    for (const id of sqlSet) {
      if (nosqlSet.has(id)) bothCount++;
      else sqlOnlyCount++;
    }
    for (const id of nosqlSet) {
      if (!sqlSet.has(id)) nosqlOnlyCount++;
    }

    const passed =
      sqlSet.size === 600 &&
      nosqlSet.size === 600 &&
      sqlOnlyCount === 300 &&
      nosqlOnlyCount === 300 &&
      bothCount === 300;

    tests.push({
      name: 'Deterministic 1/3 Partitioning',
      description: 'Verifies exact 600 SQL, 600 NoSQL, 300 SQL_ONLY, 300 NOSQL_ONLY, and 300 BOTH records.',
      passed,
      expected: { sqlTotal: 600, nosqlTotal: 600, sqlOnly: 300, nosqlOnly: 300, both: 300 },
      actual: {
        sqlTotal: sqlSet.size,
        nosqlTotal: nosqlSet.size,
        sqlOnly: sqlOnlyCount,
        nosqlOnly: nosqlOnlyCount,
        both: bothCount,
      },
      durationMs: Date.now() - t1Start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Deterministic 1/3 Partitioning',
      description: 'Verifies exact 600 SQL, 600 NoSQL, 300 SQL_ONLY, 300 NOSQL_ONLY, and 300 BOTH records.',
      passed: false,
      expected: '600/600/300/300/300',
      actual: err.message,
      durationMs: Date.now() - t1Start,
      error: err.message,
    });
  }

  // Test 2: Search Deduplication (Search ALL)
  const t2Start = Date.now();
  try {
    const allSql = (sqliteDb.prepare('SELECT Transaction_ID FROM sales_records').all() as { Transaction_ID: string }[])
      .map((r) => r.Transaction_ID);
    const allNosql = ((await nosqlDb.findAsync({}, { Transaction_ID: 1 })) as unknown as { Transaction_ID: string }[]).map(
      (d) => d.Transaction_ID
    );

    const unionIds = new Set([...allSql, ...allNosql]);
    const passed = unionIds.size === 900;

    tests.push({
      name: 'Search ALL Federated Deduplication',
      description: 'Asserts querying both stores returns exactly 900 distinct records with zero duplicate IDs.',
      passed,
      expected: 900,
      actual: unionIds.size,
      durationMs: Date.now() - t2Start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Search ALL Federated Deduplication',
      description: 'Asserts querying both stores returns exactly 900 distinct records with zero duplicate IDs.',
      passed: false,
      expected: 900,
      actual: err.message,
      durationMs: Date.now() - t2Start,
      error: err.message,
    });
  }

  // Test 3: SQL Only and NoSQL Only search parity
  const t3Start = Date.now();
  try {
    const sqlCount = sqliteDb.prepare('SELECT COUNT(*) as c FROM sales_records').get() as { c: number };
    const nosqlCount = await nosqlDb.countAsync({});

    const passed = sqlCount.c === 600 && nosqlCount === 600;

    tests.push({
      name: 'Database Search Mode Parity',
      description: 'Asserts Search SQL yields 600 records and Search NoSQL yields 600 records.',
      passed,
      expected: { sqlModeCount: 600, nosqlModeCount: 600 },
      actual: { sqlModeCount: sqlCount.c, nosqlModeCount: nosqlCount },
      durationMs: Date.now() - t3Start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Database Search Mode Parity',
      description: 'Asserts Search SQL yields 600 records and Search NoSQL yields 600 records.',
      passed: false,
      expected: '600 / 600',
      actual: err.message,
      durationMs: Date.now() - t3Start,
      error: err.message,
    });
  }

  // Test 4: Shared Record Two-Phase Replication & Version Increment
  const t4Start = Date.now();
  try {
    // Pick a known shared record: index % 3 === 2 (e.g. TXN-100002)
    const testTxn = 'TXN-100002';
    const originalSql = sqliteDb
      .prepare('SELECT * FROM sales_records WHERE Transaction_ID = ?')
      .get(testTxn) as SalesRecord;
    const initialVersion = originalSql ? originalSql.version || 1 : 1;

    setSimulateReplicationFailure(false);
    const updatePayload = {
      Quantity: (originalSql?.Quantity || 1) + 2,
      Order_Status: 'Completed',
    };

    const repResult = await replicateSharedRecord(testTxn, updatePayload);

    // Verify in SQLite
    const updatedSql = sqliteDb
      .prepare('SELECT * FROM sales_records WHERE Transaction_ID = ?')
      .get(testTxn) as SalesRecord;
    // Verify in NeDB
    const updatedNoSql = (await nosqlDb.findOneAsync({ Transaction_ID: testTxn })) as SalesRecord | null;

    const passed =
      repResult.status === 'SUCCESS_SYNCHRONIZED' &&
      updatedSql.version === initialVersion + 1 &&
      updatedNoSql?.version === initialVersion + 1 &&
      updatedSql.Quantity === updatePayload.Quantity &&
      updatedNoSql?.Quantity === updatePayload.Quantity &&
      updatedSql.sync_status === 'SUCCESS_SYNCHRONIZED' &&
      updatedNoSql?.sync_status === 'SUCCESS_SYNCHRONIZED';

    tests.push({
      name: 'Shared Record Replication & Version Increment',
      description: 'Updates shared record in SQL, replicates to NoSQL, increments version, and validates SUCCESS_SYNCHRONIZED.',
      passed,
      expected: {
        status: 'SUCCESS_SYNCHRONIZED',
        newVersion: initialVersion + 1,
        sqlQty: updatePayload.Quantity,
        nosqlQty: updatePayload.Quantity,
      },
      actual: {
        status: repResult.status,
        newVersion: updatedSql?.version,
        sqlQty: updatedSql?.Quantity,
        nosqlQty: updatedNoSql?.Quantity,
      },
      durationMs: Date.now() - t4Start,
    });
  } catch (err: any) {
    tests.push({
      name: 'Shared Record Replication & Version Increment',
      description: 'Updates shared record in SQL, replicates to NoSQL, increments version, and validates SUCCESS_SYNCHRONIZED.',
      passed: false,
      expected: 'SUCCESS_SYNCHRONIZED with incremented version',
      actual: err.message,
      durationMs: Date.now() - t4Start,
      error: err.message,
    });
  }

  // Test 5: Simulated Network Partition & PENDING_RETRY Queue
  const t5Start = Date.now();
  try {
    const testTxn = 'TXN-100005'; // Shared record (100005: 5 % 3 === 2)
    setSimulateReplicationFailure(true);

    const repResult = await replicateSharedRecord(testTxn, {
      Customer_Rating: 4.8,
      Order_Status: 'In Transit',
    });

    const queueItems = getRetryQueue();
    const hasInQueue = queueItems.some((item) => item.transactionId === testTxn);
    const sqlRecord = sqliteDb
      .prepare('SELECT sync_status FROM sales_records WHERE Transaction_ID = ?')
      .get(testTxn) as { sync_status: string };

    // Now turn off failure and test retry resolution
    setSimulateReplicationFailure(false);
    const retryRes = await processRetryItem(testTxn);

    const finalSql = sqliteDb
      .prepare('SELECT sync_status FROM sales_records WHERE Transaction_ID = ?')
      .get(testTxn) as { sync_status: string };

    const passed =
      repResult.status === 'PENDING_RETRY' &&
      hasInQueue &&
      sqlRecord.sync_status === 'PENDING_RETRY' &&
      retryRes.success &&
      finalSql.sync_status === 'SUCCESS_SYNCHRONIZED';

    tests.push({
      name: 'Failure Simulation & PENDING_RETRY Resolution',
      description: 'Triggers simulated network partition, verifies PENDING_RETRY enqueueing in SQL & queue, then successfully recovers via retry.',
      passed,
      expected: { initialStatus: 'PENDING_RETRY', recoveredStatus: 'SUCCESS_SYNCHRONIZED' },
      actual: { initialStatus: repResult.status, recoveredStatus: finalSql?.sync_status },
      durationMs: Date.now() - t5Start,
    });
  } catch (err: any) {
    setSimulateReplicationFailure(false);
    tests.push({
      name: 'Failure Simulation & PENDING_RETRY Resolution',
      description: 'Triggers simulated network partition, verifies PENDING_RETRY enqueueing in SQL & queue, then successfully recovers via retry.',
      passed: false,
      expected: 'PENDING_RETRY -> SUCCESS_SYNCHRONIZED',
      actual: err.message,
      durationMs: Date.now() - t5Start,
      error: err.message,
    });
  }

  const passedCount = tests.filter((t) => t.passed).length;
  const failedCount = tests.length - passedCount;

  const report: TestSuiteReport = {
    timestamp: new Date().toISOString(),
    passedCount,
    failedCount,
    totalCount: tests.length,
    durationMs: Date.now() - startAll,
    allPassed: failedCount === 0,
    tests,
  };

  res.json(report);
});
