export type StorageLocation = 'SQL_ONLY' | 'NOSQL_ONLY' | 'BOTH';
export type SyncStatus = 'SUCCESS_SYNCHRONIZED' | 'PENDING_RETRY' | 'REPLICATING' | 'NOT_APPLICABLE';
export type SortField =
  | 'Transaction_ID'
  | 'Partition_Sync'
  | 'Order_Date'
  | 'Customer_Name'
  | 'Sales_Amount'
  | 'Order_Status';
export type SortDirection = 'asc' | 'desc';

export interface SalesRecord {
  // 36 Schema Fields matching sales_data_dictionary.csv
  Transaction_ID: string;
  Order_ID: string;
  Customer_ID: string;
  Customer_Name: string;
  Customer_Age: number;
  Customer_Gender: string;
  Customer_Segment: string;
  Order_Date: string;
  Order_Time: string;
  Sales_Channel: string;
  Store_ID: string;
  Store_Name: string;
  Country: string;
  Region: string;
  City: string;
  Product_ID: string;
  Product_Name: string;
  Product_Category: string;
  Product_Subcategory: string;
  Quantity: number;
  Unit_Price: number;
  Discount_Percentage: number;
  Sales_Amount: number;
  Cost_Amount: number;
  Profit: number;
  Payment_Method: string;
  Order_Status: string;
  Shipping_Method: string;
  Delivery_Days: number;
  Return_Flag: string;
  Return_Reason: string;
  Sales_Representative: string;
  Promotion_Code: string;
  Customer_Rating: number;
  Inventory_Level: number;
  Order_Year: number;

  // Replication & Partitioning Metadata
  storage_location?: StorageLocation;
  version?: number;
  sync_status?: SyncStatus;
  last_replicated_at?: string;
  in_sql?: boolean;
  in_nosql?: boolean;
}

export interface ProductCatalogItem {
  Product_ID: string;
  Product_Name: string;
  Product_Category: string;
  Product_Subcategory: string;
  Unit_Price: number;
}

export interface StoreCityOption {
  Store_ID: string;
  Store_Name: string;
  City: string;
  Region: string;
  Country: string;
}

export interface DatabaseMetrics {
  totalSql: number;
  totalNosql: number;
  sqlOnly: number;
  nosqlOnly: number;
  sharedBoth: number;
  totalUnique: number;
  pendingRetries: number;
  eventsCount?: number;
  failureSimulation: boolean;
}

export interface RetryQueueItem {
  id: string;
  transactionId: string;
  recordPayload: Partial<SalesRecord>;
  previousVersion: number;
  attemptedVersion: number;
  lastAttemptAt: string;
  createdAt?: string;
  retryCount: number;
  errorMessage: string;
  status: 'PENDING_RETRY' | 'FAILED_PERMANENT';
}

export interface ProtocolStep {
  step: number;
  name: string;
  store: string;
  status: 'completed' | 'failed' | 'skipped' | 'pending';
  detail: string;
  durationMs: number;
}

export interface ChangedFieldDiff {
  field: string;
  from: string | number;
  to: string | number;
}

export interface ReplicationEvent {
  eventId: string;
  transactionId: string;
  partition: StorageLocation;
  action: string;
  status: string;
  fromVersion: number;
  toVersion: number;
  changedFields?: ChangedFieldDiff[];
  syncSummary?: string;
  details: string;
  timestamp: string;
}

export interface ReplicationResponse {
  success: boolean;
  status: SyncStatus;
  version: number;
  storageLocation: StorageLocation;
  message: string;
  record: SalesRecord;
  steps: ProtocolStep[];
  event?: ReplicationEvent;
}

export interface TestResultItem {
  name: string;
  description: string;
  passed: boolean;
  expected: any;
  actual: any;
  durationMs: number;
  error?: string;
}

export interface TestSuiteReport {
  timestamp: string;
  passedCount: number;
  failedCount: number;
  totalCount: number;
  durationMs: number;
  allPassed: boolean;
  tests: TestResultItem[];
}
