import { sqliteDb, nosqlDb, SCHEMA_COLUMNS } from './db.ts';
import type {
  SalesRecord,
  RetryQueueItem,
  SyncStatus,
  StorageLocation,
  ProtocolStep,
  ChangedFieldDiff,
  ReplicationEvent,
  ReplicationResponse,
} from '../types/sales.ts';

let simulateReplicationFailure = false;

export class VersionConflictError extends Error {
  statusCode = 409;
  expectedVersion: number;
  actualVersion: number;

  constructor(transactionId: string, expectedVersion: number, actualVersion: number) {
    super(
      `Version conflict on ${transactionId}: expected v${expectedVersion}, but store currently holds v${actualVersion}. Reload the record and retry.`
    );
    this.name = 'VersionConflictError';
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class RecordNotFoundError extends Error {
  statusCode = 404;
  constructor(transactionId: string) {
    super(`Record ${transactionId} not found in SQLite or NeDB.`);
    this.name = 'RecordNotFoundError';
  }
}

export function setSimulateReplicationFailure(enabled: boolean) {
  simulateReplicationFailure = enabled;
  return simulateReplicationFailure;
}

export function getSimulateReplicationFailure() {
  return simulateReplicationFailure;
}

function stripInternalIds<T extends Record<string, any>>(doc: T): Omit<T, '_id' | 'storage_location' | 'in_sql' | 'in_nosql'> {
  const { _id, storage_location, in_sql, in_nosql, ...rest } = doc;
  return rest;
}

const META_FIELDS = new Set(['Transaction_ID', 'version', 'sync_status', 'last_replicated_at']);

function computeChangedFields(
  beforeRecord: Partial<SalesRecord>,
  afterRecord: SalesRecord,
  basePartition: StorageLocation,
  targetPartition: StorageLocation
): ChangedFieldDiff[] {
  const diffs: ChangedFieldDiff[] = [];

  if (basePartition !== targetPartition) {
    diffs.push({
      field: 'Partition',
      from: basePartition,
      to: targetPartition,
    });
  }

  for (const col of SCHEMA_COLUMNS) {
    if (META_FIELDS.has(col)) continue;
    const prevVal = (beforeRecord as Record<string, any>)[col];
    const nextVal = (afterRecord as Record<string, any>)[col];

    if (typeof nextVal === 'number' || typeof prevVal === 'number') {
      const nPrev = Number(prevVal ?? 0);
      const nNext = Number(nextVal ?? 0);
      if (Math.abs(nPrev - nNext) > 1e-6) {
        diffs.push({ field: col, from: nPrev, to: nNext });
      }
    } else {
      const sPrev = prevVal !== undefined && prevVal !== null ? String(prevVal) : '';
      const sNext = nextVal !== undefined && nextVal !== null ? String(nextVal) : '';
      if (sPrev !== sNext) {
        diffs.push({ field: col, from: sPrev, to: sNext });
      }
    }
  }

  return diffs;
}

function formatChangedFieldsText(diffs: ChangedFieldDiff[]): string {
  if (diffs.length === 0) return 'no field value changes';
  return diffs
    .slice(0, 6)
    .map((d) => `${d.field}: ${d.from} → ${d.to}`)
    .join(', ') + (diffs.length > 6 ? ` (+${diffs.length - 6} more)` : '');
}

export function logReplicationEvent(params: {
  transactionId: string;
  partition: StorageLocation;
  action: string;
  status: string;
  fromVersion: number;
  toVersion: number;
  changedFields?: ChangedFieldDiff[];
  syncSummary?: string;
  details: string;
}): ReplicationEvent {
  const event: ReplicationEvent = {
    eventId: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    transactionId: params.transactionId,
    partition: params.partition,
    action: params.action,
    status: params.status,
    fromVersion: params.fromVersion,
    toVersion: params.toVersion,
    changedFields: params.changedFields || [],
    syncSummary: params.syncSummary,
    details: params.details,
    timestamp: new Date().toISOString(),
  };

  sqliteDb
    .prepare(
      `INSERT INTO replication_events (
        event_id, transaction_id, partition, action, status, from_version, to_version, changed_fields, sync_summary, details, timestamp
      ) VALUES (
        @eventId, @transactionId, @partition, @action, @status, @fromVersion, @toVersion, @changedFieldsJson, @syncSummary, @details, @timestamp
      )`
    )
    .run({
      eventId: event.eventId,
      transactionId: event.transactionId,
      partition: event.partition,
      action: event.action,
      status: event.status,
      fromVersion: event.fromVersion,
      toVersion: event.toVersion,
      changedFieldsJson: JSON.stringify(event.changedFields || []),
      syncSummary: event.syncSummary || null,
      details: event.details,
      timestamp: event.timestamp,
    });

  return event;
}

export function getReplicationEvents(limit = 100): ReplicationEvent[] {
  const rows = sqliteDb
    .prepare(
      `SELECT
        event_id as eventId,
        transaction_id as transactionId,
        partition,
        action,
        status,
        from_version as fromVersion,
        to_version as toVersion,
        changed_fields as changedFieldsRaw,
        sync_summary as syncSummary,
        details,
        timestamp
      FROM replication_events
      ORDER BY timestamp DESC, rowid DESC
      LIMIT ?`
    )
    .all(limit) as Array<
    Omit<ReplicationEvent, 'changedFields'> & { changedFieldsRaw?: string | null }
  >;

  return rows.map((r) => {
    let parsedFields: ChangedFieldDiff[] = [];
    if (r.changedFieldsRaw) {
      try {
        parsedFields = JSON.parse(r.changedFieldsRaw);
      } catch {
        parsedFields = [];
      }
    }
    return {
      eventId: r.eventId,
      transactionId: r.transactionId,
      partition: r.partition,
      action: r.action,
      status: r.status,
      fromVersion: r.fromVersion,
      toVersion: r.toVersion,
      changedFields: parsedFields,
      syncSummary: r.syncSummary || undefined,
      details: r.details,
      timestamp: r.timestamp,
    };
  });
}

export function getReplicationEventsCount(): number {
  const row = sqliteDb
    .prepare('SELECT COUNT(*) as count FROM replication_events')
    .get() as { count: number };
  return row.count;
}

function upsertRetryQueueItem(item: RetryQueueItem) {
  sqliteDb
    .prepare(
      `INSERT INTO replication_queue (
        id, transaction_id, record_payload, previous_version, attempted_version,
        last_attempt_at, created_at, retry_count, error_message, status
      ) VALUES (
        @id, @transactionId, @recordPayload, @previousVersion, @attemptedVersion,
        @lastAttemptAt, @createdAt, @retryCount, @errorMessage, @status
      )
      ON CONFLICT(transaction_id) DO UPDATE SET
        record_payload = excluded.record_payload,
        previous_version = excluded.previous_version,
        attempted_version = excluded.attempted_version,
        last_attempt_at = excluded.last_attempt_at,
        retry_count = replication_queue.retry_count + 1,
        error_message = excluded.error_message,
        status = excluded.status`
    )
    .run({
      id: item.id,
      transactionId: item.transactionId,
      recordPayload: JSON.stringify(item.recordPayload),
      previousVersion: item.previousVersion,
      attemptedVersion: item.attemptedVersion,
      lastAttemptAt: item.lastAttemptAt,
      createdAt: item.createdAt || item.lastAttemptAt,
      retryCount: item.retryCount,
      errorMessage: item.errorMessage,
      status: item.status,
    });
}

function deleteRetryQueueItem(transactionId: string) {
  sqliteDb.prepare('DELETE FROM replication_queue WHERE transaction_id = ?').run(transactionId);
}

export function getRetryQueue(): RetryQueueItem[] {
  const rows = sqliteDb
    .prepare(
      `SELECT
        id,
        transaction_id as transactionId,
        record_payload as recordPayloadRaw,
        previous_version as previousVersion,
        attempted_version as attemptedVersion,
        last_attempt_at as lastAttemptAt,
        created_at as createdAt,
        retry_count as retryCount,
        error_message as errorMessage,
        status
      FROM replication_queue
      WHERE status = 'PENDING_RETRY'
      ORDER BY last_attempt_at DESC`
    )
    .all() as Array<
      Omit<RetryQueueItem, 'recordPayload'> & { recordPayloadRaw: string }
    >;

  return rows.map((r) => ({
    id: r.id,
    transactionId: r.transactionId,
    recordPayload: JSON.parse(r.recordPayloadRaw),
    previousVersion: r.previousVersion,
    attemptedVersion: r.attemptedVersion,
    lastAttemptAt: r.lastAttemptAt,
    createdAt: r.createdAt,
    retryCount: r.retryCount,
    errorMessage: r.errorMessage,
    status: r.status,
  }));
}

export function getRetryQueueCount(): number {
  const row = sqliteDb
    .prepare("SELECT COUNT(*) as count FROM replication_queue WHERE status = 'PENDING_RETRY'")
    .get() as { count: number };
  return row.count;
}

export interface ModifyOptions {
  expectedVersion?: number;
  promoteToBoth?: boolean;
  simulateFailure?: boolean;
}

export async function modifyAndReplicateRecord(
  transactionId: string,
  updatedFields: Partial<SalesRecord>,
  options: ModifyOptions = {}
): Promise<ReplicationResponse> {
  const steps: ProtocolStep[] = [];
  const tStart = Date.now();

  // Discover record in both stores
  const existingSql = sqliteDb
    .prepare('SELECT * FROM sales_records WHERE Transaction_ID = ?')
    .get(transactionId) as SalesRecord | undefined;
  const existingNoSql = (await nosqlDb.findOneAsync({ Transaction_ID: transactionId })) as
    | (SalesRecord & { _id?: string })
    | null;

  if (!existingSql && !existingNoSql) {
    throw new RecordNotFoundError(transactionId);
  }

  const basePartition: StorageLocation =
    existingSql && existingNoSql ? 'BOTH' : existingSql ? 'SQL_ONLY' : 'NOSQL_ONLY';

  const targetPartition: StorageLocation =
    options.promoteToBoth && basePartition !== 'BOTH' ? 'BOTH' : basePartition;

  // Primary source of truth: SQLite when present, otherwise NeDB
  const currentRecord = existingSql || stripInternalIds(existingNoSql!);
  const currentVersion = currentRecord.version || 1;

  // Step 1: Optimistic Version Guard
  const step1Start = Date.now();
  if (options.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
    steps.push({
      step: 1,
      name: 'Optimistic Version Guard',
      store: basePartition,
      status: 'failed',
      detail: `Rejected: expected v${options.expectedVersion}, found v${currentVersion}.`,
      durationMs: Date.now() - step1Start,
    });
    logReplicationEvent({
      transactionId,
      partition: basePartition,
      action: 'VERSION_CONFLICT',
      status: 'CONFLICT_REJECTED',
      fromVersion: options.expectedVersion,
      toVersion: currentVersion,
      details: `Optimistic lock failed (expected v${options.expectedVersion}, actual v${currentVersion})`,
    });
    throw new VersionConflictError(transactionId, options.expectedVersion, currentVersion);
  }

  const nextVersion = currentVersion + 1;
  const now = new Date().toISOString();

  steps.push({
    step: 1,
    name: 'Optimistic Version Guard',
    store: basePartition,
    status: 'completed',
    detail: `Verified v${currentVersion} -> advancing to v${nextVersion}.`,
    durationMs: Date.now() - step1Start,
  });

  // Merge updates cleanly (strip client-side metadata fields so they never pollute DB records)
  const sanitizedUpdates = stripInternalIds(updatedFields as Record<string, any>);
  const mergedRecord: SalesRecord = {
    ...(stripInternalIds(currentRecord) as SalesRecord),
    ...sanitizedUpdates,
    Transaction_ID: transactionId,
    version: nextVersion,
    last_replicated_at: now,
  };

  // Coerce numeric fields safely
  mergedRecord.Customer_Age = Number(mergedRecord.Customer_Age) || 0;
  mergedRecord.Quantity = Number(mergedRecord.Quantity) || 1;
  mergedRecord.Unit_Price = Number(mergedRecord.Unit_Price) || 0;
  mergedRecord.Discount_Percentage = Number(mergedRecord.Discount_Percentage) || 0;
  mergedRecord.Delivery_Days = Number(mergedRecord.Delivery_Days) || 1;
  mergedRecord.Customer_Rating = Number(mergedRecord.Customer_Rating) || 5;
  mergedRecord.Inventory_Level = Number(mergedRecord.Inventory_Level) || 0;
  mergedRecord.Order_Year = Number(mergedRecord.Order_Year) || 2024;

  // Re-calculate financials when quantity, price, or discount changed
  if (
    sanitizedUpdates.Quantity !== undefined ||
    sanitizedUpdates.Unit_Price !== undefined ||
    sanitizedUpdates.Discount_Percentage !== undefined
  ) {
    const gross = mergedRecord.Quantity * mergedRecord.Unit_Price;
    mergedRecord.Sales_Amount = Number((gross * (1 - mergedRecord.Discount_Percentage)).toFixed(2));
    mergedRecord.Cost_Amount = Number((mergedRecord.Sales_Amount * 0.65).toFixed(2));
    mergedRecord.Profit = Number((mergedRecord.Sales_Amount - mergedRecord.Cost_Amount).toFixed(2));
  } else {
    mergedRecord.Sales_Amount = Number(mergedRecord.Sales_Amount) || 0;
    mergedRecord.Cost_Amount = Number(mergedRecord.Cost_Amount) || 0;
    mergedRecord.Profit = Number(mergedRecord.Profit) || 0;
  }

  const changedFields = computeChangedFields(currentRecord, mergedRecord, basePartition, targetPartition);
  const changedSummary = formatChangedFieldsText(changedFields);

  // Case A: Isolated SQL_ONLY update
  if (targetPartition === 'SQL_ONLY') {
    const s2 = Date.now();
    mergedRecord.sync_status = 'NOT_APPLICABLE';
    upsertSqlRecord(mergedRecord);
    steps.push({
      step: 2,
      name: 'SQLite Primary Commit',
      store: 'SQLite',
      status: 'completed',
      detail: `Committed 36-field row at v${nextVersion}.`,
      durationMs: Date.now() - s2,
    });
    steps.push({
      step: 3,
      name: 'NoSQL Replica Push',
      store: 'NeDB',
      status: 'skipped',
      detail: 'Skipped: record is isolated to SQL_ONLY partition.',
      durationMs: 0,
    });
    steps.push({
      step: 4,
      name: 'Protocol Acknowledgement',
      store: 'Engine',
      status: 'completed',
      detail: `Direct SQL write completed in ${Date.now() - tStart}ms.`,
      durationMs: 0,
    });

    const event = logReplicationEvent({
      transactionId,
      partition: 'SQL_ONLY',
      action: 'DIRECT_SQL_UPDATE',
      status: 'NOT_APPLICABLE',
      fromVersion: currentVersion,
      toVersion: nextVersion,
      changedFields,
      syncSummary: 'SQLite Only · Isolated (NeDB N/A)',
      details: `Updated SQL_ONLY record (${changedSummary})`,
    });

    return {
      success: true,
      status: 'NOT_APPLICABLE',
      version: nextVersion,
      storageLocation: 'SQL_ONLY',
      message: `Updated SQL-only record ${transactionId} (v${nextVersion}).`,
      record: { ...mergedRecord, storage_location: 'SQL_ONLY', in_sql: true, in_nosql: false },
      steps,
      event,
    };
  }

  // Case B: Isolated NOSQL_ONLY update
  if (targetPartition === 'NOSQL_ONLY') {
    const s2 = Date.now();
    mergedRecord.sync_status = 'NOT_APPLICABLE';
    await nosqlDb.updateAsync(
      { Transaction_ID: transactionId },
      { $set: mergedRecord },
      { upsert: true }
    );
    steps.push({
      step: 2,
      name: 'NeDB Document Commit',
      store: 'NeDB',
      status: 'completed',
      detail: `Updated embedded JSON document at v${nextVersion}.`,
      durationMs: Date.now() - s2,
    });
    steps.push({
      step: 3,
      name: 'SQLite Primary Sync',
      store: 'SQLite',
      status: 'skipped',
      detail: 'Skipped: record is isolated to NOSQL_ONLY partition.',
      durationMs: 0,
    });
    steps.push({
      step: 4,
      name: 'Protocol Acknowledgement',
      store: 'Engine',
      status: 'completed',
      detail: `Direct NoSQL write completed in ${Date.now() - tStart}ms.`,
      durationMs: 0,
    });

    const event = logReplicationEvent({
      transactionId,
      partition: 'NOSQL_ONLY',
      action: 'DIRECT_NOSQL_UPDATE',
      status: 'NOT_APPLICABLE',
      fromVersion: currentVersion,
      toVersion: nextVersion,
      changedFields,
      syncSummary: 'NeDB Only · Isolated (SQLite N/A)',
      details: `Updated NOSQL_ONLY document (${changedSummary})`,
    });

    return {
      success: true,
      status: 'NOT_APPLICABLE',
      version: nextVersion,
      storageLocation: 'NOSQL_ONLY',
      message: `Updated NoSQL-only record ${transactionId} (v${nextVersion}).`,
      record: { ...mergedRecord, storage_location: 'NOSQL_ONLY', in_sql: false, in_nosql: true },
      steps,
      event,
    };
  }

  // Case C: Shared ('BOTH') or Promoted to 'BOTH' -> Two-Phase Versioned Async Replication Protocol
  const s2 = Date.now();
  mergedRecord.sync_status = 'REPLICATING';
  upsertSqlRecord(mergedRecord);
  steps.push({
    step: 2,
    name: basePartition !== 'BOTH' ? 'Primary Commit & Store Promotion' : 'SQLite Primary Commit',
    store: 'SQLite',
    status: 'completed',
    detail:
      basePartition !== 'BOTH'
        ? `Promoted ${basePartition} -> BOTH and committed v${nextVersion} to SQLite.`
        : `Committed primary update at v${nextVersion} (sync_status=REPLICATING).`,
    durationMs: Date.now() - s2,
  });

  const shouldFail = Boolean(options.simulateFailure) || simulateReplicationFailure;
  const s3 = Date.now();

  if (shouldFail) {
    const errorMsg = options.simulateFailure
      ? 'Replica offline simulation triggered for this commit.'
      : 'Network partition / replication timeout simulated for NoSQL node.';
    mergedRecord.sync_status = 'PENDING_RETRY';
    sqliteDb
      .prepare('UPDATE sales_records SET sync_status = ? WHERE Transaction_ID = ?')
      .run('PENDING_RETRY', transactionId);

    const retryItem: RetryQueueItem = {
      id: `retry_${transactionId}_${Date.now()}`,
      transactionId,
      recordPayload: mergedRecord,
      previousVersion: currentVersion,
      attemptedVersion: nextVersion,
      lastAttemptAt: now,
      createdAt: now,
      retryCount: 1,
      errorMessage: errorMsg,
      status: 'PENDING_RETRY',
    };
    upsertRetryQueueItem(retryItem);

    steps.push({
      step: 3,
      name: 'NeDB Replica Push',
      store: 'NeDB',
      status: 'failed',
      detail: errorMsg,
      durationMs: Date.now() - s3,
    });
    steps.push({
      step: 4,
      name: 'Persistent Queue Enqueue',
      store: 'replication_queue',
      status: 'pending',
      detail: `Persisted task for v${nextVersion} under PENDING_RETRY.`,
      durationMs: 1,
    });

    const event = logReplicationEvent({
      transactionId,
      partition: 'BOTH',
      action: basePartition !== 'BOTH' ? 'PROMOTE_REPLICATE_FAIL' : 'REPLICATE_TO_NOSQL',
      status: 'PENDING_RETRY',
      fromVersion: currentVersion,
      toVersion: nextVersion,
      changedFields,
      syncSummary: 'SQLite Committed · NeDB PENDING_RETRY',
      details: `${errorMsg} (${changedSummary})`,
    });

    return {
      success: false,
      status: 'PENDING_RETRY',
      version: nextVersion,
      storageLocation: 'BOTH',
      message: `Committed v${nextVersion} to SQLite, but NeDB replication failed. Task persisted in PENDING_RETRY queue.`,
      record: { ...mergedRecord, storage_location: 'BOTH', in_sql: true, in_nosql: Boolean(existingNoSql) },
      steps,
      event,
    };
  }

  try {
    await nosqlDb.updateAsync(
      { Transaction_ID: transactionId },
      { $set: { ...mergedRecord, sync_status: 'SUCCESS_SYNCHRONIZED' } },
      { upsert: true }
    );

    mergedRecord.sync_status = 'SUCCESS_SYNCHRONIZED';
    sqliteDb
      .prepare('UPDATE sales_records SET sync_status = ?, last_replicated_at = ? WHERE Transaction_ID = ?')
      .run('SUCCESS_SYNCHRONIZED', now, transactionId);

    deleteRetryQueueItem(transactionId);

    steps.push({
      step: 3,
      name: 'NeDB Replica Push',
      store: 'NeDB',
      status: 'completed',
      detail: `Replicated full 36-field document to NeDB at v${nextVersion}.`,
      durationMs: Date.now() - s3,
    });
    steps.push({
      step: 4,
      name: 'Protocol Acknowledgement',
      store: 'SQLite + NeDB',
      status: 'completed',
      detail: `Status marked SUCCESS_SYNCHRONIZED (${Date.now() - tStart}ms total).`,
      durationMs: 1,
    });

    const event = logReplicationEvent({
      transactionId,
      partition: 'BOTH',
      action: basePartition !== 'BOTH' ? 'PROMOTE_UPDATE' : 'UPDATE',
      status: 'SYNCED',
      fromVersion: currentVersion,
      toVersion: nextVersion,
      changedFields,
      syncSummary: 'SQLite ↔ NeDB · SYNCED',
      details:
        basePartition !== 'BOTH'
          ? `Promoted from ${basePartition} to BOTH and synchronized v${nextVersion} (${changedSummary})`
          : `Synchronized SQLite ↔ NeDB to v${nextVersion} (${changedSummary})`,
    });

    return {
      success: true,
      status: 'SUCCESS_SYNCHRONIZED',
      version: nextVersion,
      storageLocation: 'BOTH',
      message: `Committed to SQLite and replicated v${nextVersion} to NeDB (SUCCESS_SYNCHRONIZED).`,
      record: { ...mergedRecord, storage_location: 'BOTH', in_sql: true, in_nosql: true },
      steps,
      event,
    };
  } catch (err: any) {
    const errorMsg = err.message || 'Unknown NeDB replication error';
    mergedRecord.sync_status = 'PENDING_RETRY';
    sqliteDb
      .prepare('UPDATE sales_records SET sync_status = ? WHERE Transaction_ID = ?')
      .run('PENDING_RETRY', transactionId);

    upsertRetryQueueItem({
      id: `retry_${transactionId}_${Date.now()}`,
      transactionId,
      recordPayload: mergedRecord,
      previousVersion: currentVersion,
      attemptedVersion: nextVersion,
      lastAttemptAt: now,
      createdAt: now,
      retryCount: 1,
      errorMessage: errorMsg,
      status: 'PENDING_RETRY',
    });

    steps.push({
      step: 3,
      name: 'NeDB Replica Push',
      store: 'NeDB',
      status: 'failed',
      detail: errorMsg,
      durationMs: Date.now() - s3,
    });
    steps.push({
      step: 4,
      name: 'Persistent Queue Enqueue',
      store: 'replication_queue',
      status: 'pending',
      detail: `Queued v${nextVersion} under PENDING_RETRY.`,
      durationMs: 1,
    });

    const event = logReplicationEvent({
      transactionId,
      partition: 'BOTH',
      action: 'REPLICATE_TO_NOSQL',
      status: 'PENDING_RETRY',
      fromVersion: currentVersion,
      toVersion: nextVersion,
      changedFields,
      syncSummary: 'SQLite Committed · NeDB PENDING_RETRY',
      details: `${errorMsg} (${changedSummary})`,
    });

    return {
      success: false,
      status: 'PENDING_RETRY',
      version: nextVersion,
      storageLocation: 'BOTH',
      message: `Replication to NeDB failed. Persisted under PENDING_RETRY: ${errorMsg}`,
      record: { ...mergedRecord, storage_location: 'BOTH', in_sql: true, in_nosql: Boolean(existingNoSql) },
      steps,
      event,
    };
  }
}

// Backward-compatible alias for existing callers/tests
export async function replicateSharedRecord(
  transactionId: string,
  updatedFields: Partial<SalesRecord>,
  options: ModifyOptions = {}
) {
  return modifyAndReplicateRecord(transactionId, updatedFields, options);
}

export async function processRetryItem(transactionId: string): Promise<{
  success: boolean;
  status: SyncStatus;
  message: string;
}> {
  const row = sqliteDb
    .prepare(
      `SELECT
        id,
        transaction_id as transactionId,
        record_payload as recordPayloadRaw,
        previous_version as previousVersion,
        attempted_version as attemptedVersion,
        retry_count as retryCount
      FROM replication_queue
      WHERE transaction_id = ?`
    )
    .get(transactionId) as
    | {
        id: string;
        transactionId: string;
        recordPayloadRaw: string;
        previousVersion: number;
        attemptedVersion: number;
        retryCount: number;
      }
    | undefined;

  if (!row) {
    return {
      success: false,
      status: 'NOT_APPLICABLE',
      message: `No pending retry found for ${transactionId}`,
    };
  }

  const now = new Date().toISOString();

  if (simulateReplicationFailure) {
    sqliteDb
      .prepare(
        'UPDATE replication_queue SET retry_count = retry_count + 1, last_attempt_at = ? WHERE transaction_id = ?'
      )
      .run(now, transactionId);

    logReplicationEvent({
      transactionId,
      partition: 'BOTH',
      action: 'RETRY_ATTEMPT_FAILED',
      status: 'PENDING_RETRY',
      fromVersion: row.previousVersion,
      toVersion: row.attemptedVersion,
      syncSummary: 'SQLite Committed · NeDB PENDING_RETRY',
      details: `Retry attempt #${row.retryCount + 1} failed while simulated failure is active.`,
    });

    return {
      success: false,
      status: 'PENDING_RETRY',
      message: 'Retry attempt failed because simulated failure is still active.',
    };
  }

  try {
    const payload = stripInternalIds(JSON.parse(row.recordPayloadRaw));
    const record: SalesRecord = {
      ...(payload as SalesRecord),
      sync_status: 'SUCCESS_SYNCHRONIZED',
      last_replicated_at: now,
    };

    await nosqlDb.updateAsync(
      { Transaction_ID: transactionId },
      { $set: record },
      { upsert: true }
    );

    sqliteDb
      .prepare('UPDATE sales_records SET sync_status = ?, last_replicated_at = ? WHERE Transaction_ID = ?')
      .run('SUCCESS_SYNCHRONIZED', now, transactionId);

    deleteRetryQueueItem(transactionId);

    logReplicationEvent({
      transactionId,
      partition: 'BOTH',
      action: 'RETRY_SYNC',
      status: 'SYNCED',
      fromVersion: row.previousVersion,
      toVersion: row.attemptedVersion,
      syncSummary: 'SQLite ↔ NeDB · SYNCED',
      details: `Recovered and synchronized v${row.attemptedVersion} to NeDB after ${row.retryCount} attempt(s).`,
    });

    return {
      success: true,
      status: 'SUCCESS_SYNCHRONIZED',
      message: `Successfully synchronized ${transactionId} (v${row.attemptedVersion}) to NeDB.`,
    };
  } catch (err: any) {
    sqliteDb
      .prepare(
        'UPDATE replication_queue SET retry_count = retry_count + 1, last_attempt_at = ?, error_message = ? WHERE transaction_id = ?'
      )
      .run(now, err.message || 'Retry failed', transactionId);

    logReplicationEvent({
      transactionId,
      partition: 'BOTH',
      action: 'RETRY_ATTEMPT_FAILED',
      status: 'PENDING_RETRY',
      fromVersion: row.previousVersion,
      toVersion: row.attemptedVersion,
      syncSummary: 'SQLite Committed · NeDB PENDING_RETRY',
      details: err.message || 'Retry failed',
    });

    return {
      success: false,
      status: 'PENDING_RETRY',
      message: `Retry failed: ${err.message}`,
    };
  }
}

export async function processAllRetries(): Promise<{
  processedCount: number;
  successCount: number;
  failureCount: number;
}> {
  const items = getRetryQueue();
  let successCount = 0;
  let failureCount = 0;

  for (const item of items) {
    const res = await processRetryItem(item.transactionId);
    if (res.success) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  return {
    processedCount: items.length,
    successCount,
    failureCount,
  };
}

export function discardRetryItem(transactionId: string): boolean {
  const existing = sqliteDb
    .prepare('SELECT previous_version, attempted_version FROM replication_queue WHERE transaction_id = ?')
    .get(transactionId) as { previous_version: number; attempted_version: number } | undefined;

  if (!existing) return false;

  deleteRetryQueueItem(transactionId);
  logReplicationEvent({
    transactionId,
    partition: 'BOTH',
    action: 'RETRY_DISCARDED',
    status: 'DISCARDED',
    fromVersion: existing.previous_version,
    toVersion: existing.attempted_version,
    details: 'Pending replication task manually discarded from queue.',
  });
  return true;
}

let workerTimer: NodeJS.Timeout | null = null;
export function startBackgroundReplicationWorker(intervalMs = 30000) {
  if (workerTimer) return;
  workerTimer = setInterval(async () => {
    if (simulateReplicationFailure) return;
    const cutoff = new Date(Date.now() - 15000).toISOString();
    const staleItems = sqliteDb
      .prepare(
        "SELECT transaction_id as transactionId FROM replication_queue WHERE status = 'PENDING_RETRY' AND retry_count < 5 AND last_attempt_at < ?"
      )
      .all(cutoff) as Array<{ transactionId: string }>;

    for (const item of staleItems) {
      await processRetryItem(item.transactionId);
    }
  }, intervalMs);
  workerTimer.unref();
}

function upsertSqlRecord(record: SalesRecord) {
  const stmt = sqliteDb.prepare(`
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
    ON CONFLICT(Transaction_ID) DO UPDATE SET
      Order_ID = excluded.Order_ID,
      Customer_ID = excluded.Customer_ID,
      Customer_Name = excluded.Customer_Name,
      Customer_Age = excluded.Customer_Age,
      Customer_Gender = excluded.Customer_Gender,
      Customer_Segment = excluded.Customer_Segment,
      Order_Date = excluded.Order_Date,
      Order_Time = excluded.Order_Time,
      Sales_Channel = excluded.Sales_Channel,
      Store_ID = excluded.Store_ID,
      Store_Name = excluded.Store_Name,
      Country = excluded.Country,
      Region = excluded.Region,
      City = excluded.City,
      Product_ID = excluded.Product_ID,
      Product_Name = excluded.Product_Name,
      Product_Category = excluded.Product_Category,
      Product_Subcategory = excluded.Product_Subcategory,
      Quantity = excluded.Quantity,
      Unit_Price = excluded.Unit_Price,
      Discount_Percentage = excluded.Discount_Percentage,
      Sales_Amount = excluded.Sales_Amount,
      Cost_Amount = excluded.Cost_Amount,
      Profit = excluded.Profit,
      Payment_Method = excluded.Payment_Method,
      Order_Status = excluded.Order_Status,
      Shipping_Method = excluded.Shipping_Method,
      Delivery_Days = excluded.Delivery_Days,
      Return_Flag = excluded.Return_Flag,
      Return_Reason = excluded.Return_Reason,
      Sales_Representative = excluded.Sales_Representative,
      Promotion_Code = excluded.Promotion_Code,
      Customer_Rating = excluded.Customer_Rating,
      Inventory_Level = excluded.Inventory_Level,
      Order_Year = excluded.Order_Year,
      version = excluded.version,
      sync_status = excluded.sync_status,
      last_replicated_at = excluded.last_replicated_at
  `);
  stmt.run(record);
}
