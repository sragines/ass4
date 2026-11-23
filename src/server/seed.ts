import { sqliteDb, nosqlDb, clearDatabases } from './db.ts';
import type { SalesRecord, StorageLocation } from '../types/sales.ts';

// Deterministic Pseudo-Random Number Generator (LCG)
class DeterministicPRNG {
  private seed: number;

  constructor(seed = 123456789) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }

  pick<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }

  intRange(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  floatRange(min: number, max: number, decimals = 2): number {
    const val = min + this.next() * (max - min);
    return Number(val.toFixed(decimals));
  }
}

const FIRST_NAMES = [
  'Alexander', 'Sophia', 'Liam', 'Emma', 'Noah', 'Olivia', 'Ethan', 'Ava',
  'Mason', 'Isabella', 'William', 'Mia', 'James', 'Charlotte', 'Benjamin', 'Amelia',
  'Lucas', 'Harper', 'Henry', 'Evelyn', 'Daniel', 'Abigail', 'Michael', 'Emily',
  'Sebastian', 'Elizabeth', 'Julian', 'Mila', 'David', 'Ella', 'Marcus', 'Elena'
];

const LAST_NAMES = [
  'Vance', 'Sterling', 'Chen', 'Rostova', 'Patel', 'Kowalski', 'Sinclair', 'Mercer',
  'Blackwood', 'Montague', 'Nakamura', 'Holloway', 'Thorne', 'Alvarez', 'Lindqvist', 'Dupont',
  'Gallagher', 'Hawthorne', 'Sutherland', 'Morrison', 'Castillo', 'Novak', 'Reyes', 'Kim'
];

const PRODUCTS = [
  { id: 'PRD-ELEC-01', name: 'Quantum UltraBook X15', category: 'Electronics', sub: 'Laptops', price: 1299.99 },
  { id: 'PRD-ELEC-02', name: 'OmniBlade 4K HDR Monitor', category: 'Electronics', sub: 'Displays', price: 549.50 },
  { id: 'PRD-ELEC-03', name: 'AeroLink Wi-Fi 7 Mesh Node', category: 'Electronics', sub: 'Networking', price: 189.95 },
  { id: 'PRD-ELEC-04', name: 'PulseFit BioTrack Smart Watch', category: 'Electronics', sub: 'Wearables', price: 249.00 },
  { id: 'PRD-FURN-01', name: 'ErgoWave Executive Desk Chair', category: 'Furniture', sub: 'Seating', price: 420.00 },
  { id: 'PRD-FURN-02', name: 'Apex Dual-Motor Standing Desk', category: 'Furniture', sub: 'Desks', price: 680.00 },
  { id: 'PRD-FURN-03', name: 'Lumina Archival Filing Cabinet', category: 'Furniture', sub: 'Storage', price: 245.00 },
  { id: 'PRD-SUPP-01', name: 'Precision Laser Cartridge 4-Pack', category: 'Office Supplies', sub: 'Printing', price: 120.00 },
  { id: 'PRD-SUPP-02', name: 'EcoFiber Heavy Duty Ream Box', category: 'Office Supplies', sub: 'Paper', price: 48.50 },
  { id: 'PRD-SUPP-03', name: 'Archival Hardbound Ledger Pack', category: 'Office Supplies', sub: 'Stationery', price: 34.00 },
  { id: 'PRD-ACCS-01', name: 'SoundMatrix ANC Wireless Headset', category: 'Accessories', sub: 'Audio', price: 179.99 },
  { id: 'PRD-ACCS-02', name: 'ProDock Thunderbolt 4 Hub', category: 'Accessories', sub: 'Cables & Docks', price: 139.00 },
  { id: 'PRD-ACCS-03', name: 'KeyCraft Mechanical Tactile Board', category: 'Accessories', sub: 'Peripherals', price: 159.00 },
];

const STORES = [
  { id: 'STR-NY-01', name: 'Manhattan Tech Hub', city: 'New York', region: 'North America', country: 'United States' },
  { id: 'STR-NY-02', name: 'New York Central', city: 'New York', region: 'North America', country: 'United States' },
  { id: 'STR-SF-02', name: 'Silicon Bay Outpost', city: 'San Francisco', region: 'North America', country: 'United States' },
  { id: 'STR-CHI-03', name: 'Loop Commerce Flagship', city: 'Chicago', region: 'North America', country: 'United States' },
  { id: 'STR-AUS-04', name: 'Austin Tech Center', city: 'Austin', region: 'North America', country: 'United States' },
  { id: 'STR-TOR-05', name: 'Ontario Commerce Post', city: 'Toronto', region: 'North America', country: 'Canada' },
  { id: 'STR-VAN-06', name: 'Pacific Gateway Hub', city: 'Vancouver', region: 'North America', country: 'Canada' },
  { id: 'STR-LON-07', name: 'Westminster Center', city: 'London', region: 'Europe', country: 'United Kingdom' },
  { id: 'STR-LON-08', name: 'Canary Wharf Exchange', city: 'London', region: 'Europe', country: 'United Kingdom' },
  { id: 'STR-BER-09', name: 'Mitte Innovation Depot', city: 'Berlin', region: 'Europe', country: 'Germany' },
  { id: 'STR-FRA-10', name: 'Mainhattan Enterprise Hub', city: 'Frankfurt', region: 'Europe', country: 'Germany' },
  { id: 'STR-SYD-11', name: 'Darling Harbour Store', city: 'Sydney', region: 'APAC', country: 'Australia' },
  { id: 'STR-MEL-12', name: 'Yarra Valley Tech Depot', city: 'Melbourne', region: 'APAC', country: 'Australia' },
  { id: 'STR-TYO-13', name: 'Shibuya Nexus Store', city: 'Tokyo', region: 'APAC', country: 'Japan' },
];

const CHANNELS = ['Online Store', 'Retail Store', 'Distributor Portal', 'Enterprise Sales', 'Mobile App'];
const SEGMENTS = ['Corporate', 'Enterprise', 'Small Business', 'Consumer', 'Government'];
const PAYMENT_METHODS = ['Corporate Card', 'ACH Wire Transfer', 'Purchase Order', 'Credit Card', 'Apple Pay'];
const ORDER_STATUSES = ['Delivered', 'Shipped', 'Processing', 'Completed', 'In Transit'];
const SHIPPING_METHODS = ['Overnight Air', 'Standard Ground', 'Express Freight', 'Same-Day Courier'];
const SALES_REPS = ['Marcus Vance', 'Elena Rostova', 'Sarah Jenkins', 'David Chen', 'Amara Patel', 'Kenji Sato'];
const PROMOS = ['NONE', 'ENTERPRISE10', 'Q3DEAL', 'VOLUME20', 'NEWCLIENT'];
const RETURN_REASONS = ['Defective on Arrival', 'Incorrect Model Ordered', 'Client Project Cancelled', 'Late Delivery Discrepancy'];

export function generateSyntheticRecord(index: number, prng: DeterministicPRNG): SalesRecord {
  const txnNum = (100000 + index).toString();
  const product = prng.pick(PRODUCTS);
  const store = prng.pick(STORES);
  const firstName = prng.pick(FIRST_NAMES);
  const lastName = prng.pick(LAST_NAMES);

  const quantity = prng.intRange(1, 8);
  const unitPrice = product.price;
  const discountPct = prng.pick([0.0, 0.05, 0.1, 0.15, 0.2]);
  const gross = quantity * unitPrice;
  const salesAmount = Number((gross * (1 - discountPct)).toFixed(2));
  const costRatio = prng.floatRange(0.55, 0.72, 3);
  const costAmount = Number((salesAmount * costRatio).toFixed(2));
  const profit = Number((salesAmount - costAmount).toFixed(2));

  // Partition modulo 3:
  // 0 -> SQL_ONLY
  // 1 -> NOSQL_ONLY
  // 2 -> BOTH
  const mod = index % 3;
  const storage_location: StorageLocation = mod === 0 ? 'SQL_ONLY' : mod === 1 ? 'NOSQL_ONLY' : 'BOTH';

  const isReturn = prng.next() < 0.07;
  const returnFlag = isReturn ? 'Yes' : 'No';
  const returnReason = isReturn ? prng.pick(RETURN_REASONS) : 'None';

  const month = String(prng.intRange(1, 12)).padStart(2, '0');
  const day = String(prng.intRange(1, 28)).padStart(2, '0');
  const orderDate = `2024-${month}-${day}`;
  const orderTime = `${String(prng.intRange(8, 20)).padStart(2, '0')}:${String(prng.intRange(0, 59)).padStart(2, '0')}:${String(prng.intRange(0, 59)).padStart(2, '0')}`;

  return {
    Transaction_ID: `TXN-${txnNum}`,
    Order_ID: `ORD-2024-${(50000 + index).toString()}`,
    Customer_ID: `CUST-${(2000 + (index % 180)).toString()}`,
    Customer_Name: `${firstName} ${lastName}`,
    Customer_Age: prng.intRange(22, 68),
    Customer_Gender: prng.pick(['Female', 'Male', 'Non-Binary']),
    Customer_Segment: prng.pick(SEGMENTS),
    Order_Date: orderDate,
    Order_Time: orderTime,
    Sales_Channel: prng.pick(CHANNELS),
    Store_ID: store.id,
    Store_Name: store.name,
    Country: store.country,
    Region: store.region,
    City: store.city,
    Product_ID: product.id,
    Product_Name: product.name,
    Product_Category: product.category,
    Product_Subcategory: product.sub,
    Quantity: quantity,
    Unit_Price: unitPrice,
    Discount_Percentage: discountPct,
    Sales_Amount: salesAmount,
    Cost_Amount: costAmount,
    Profit: profit,
    Payment_Method: prng.pick(PAYMENT_METHODS),
    Order_Status: prng.pick(ORDER_STATUSES),
    Shipping_Method: prng.pick(SHIPPING_METHODS),
    Delivery_Days: prng.intRange(1, 7),
    Return_Flag: returnFlag,
    Return_Reason: returnReason,
    Sales_Representative: prng.pick(SALES_REPS),
    Promotion_Code: prng.pick(PROMOS),
    Customer_Rating: prng.pick([3.5, 4.0, 4.5, 5.0]),
    Inventory_Level: prng.intRange(15, 350),
    Order_Year: 2024,
    storage_location,
    version: 1,
    sync_status: 'SUCCESS_SYNCHRONIZED',
    last_replicated_at: new Date().toISOString(),
  };
}

export async function seedPartitionedDatabases(count = 900) {
  // Clear both stores
  await clearDatabases();

  const prng = new DeterministicPRNG(424242);
  const records: SalesRecord[] = [];

  for (let i = 0; i < count; i++) {
    records.push(generateSyntheticRecord(i, prng));
  }

  // Insert into SQLite
  const sqlInsertStmt = sqliteDb.prepare(`
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
  `);

  const insertSqlBatch = sqliteDb.transaction((sqlBatch: SalesRecord[]) => {
    for (const record of sqlBatch) {
      sqlInsertStmt.run(record);
    }
  });

  const sqlRecordsToInsert: SalesRecord[] = [];
  const nosqlRecordsToInsert: SalesRecord[] = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const mod = i % 3;

    if (mod === 0) {
      // SQL ONLY
      sqlRecordsToInsert.push(rec);
    } else if (mod === 1) {
      // NoSQL ONLY
      nosqlRecordsToInsert.push(rec);
    } else {
      // BOTH (mod === 2)
      sqlRecordsToInsert.push(rec);
      nosqlRecordsToInsert.push(rec);
    }
  }

  // Execute SQLite batch insert
  insertSqlBatch(sqlRecordsToInsert);

  // Execute NeDB insert batch
  await nosqlDb.insertAsync(nosqlRecordsToInsert);

  return {
    totalGenerated: count,
    sqlInserted: sqlRecordsToInsert.length,
    nosqlInserted: nosqlRecordsToInsert.length,
    sqlOnlyCount: count / 3,
    nosqlOnlyCount: count / 3,
    bothCount: count / 3,
  };
}
