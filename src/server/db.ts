import Database from 'better-sqlite3';
import Datastore from '@seald-io/nedb';
import fs from 'fs';
import path from 'path';
import type { SalesRecord } from '../types/sales.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const SQLITE_FILE = path.join(DATA_DIR, 'sales.sqlite');
const NEDB_FILE = path.join(DATA_DIR, 'sales.db');

export const sqliteDb = new Database(SQLITE_FILE);
sqliteDb.pragma('journal_mode = WAL');

// Initialize 36-field SQLite schema + persistent replication queue & event log
sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS sales_records (
    Transaction_ID TEXT PRIMARY KEY,
    Order_ID TEXT,
    Customer_ID TEXT,
    Customer_Name TEXT,
    Customer_Age INTEGER,
    Customer_Gender TEXT,
    Customer_Segment TEXT,
    Order_Date TEXT,
    Order_Time TEXT,
    Sales_Channel TEXT,
    Store_ID TEXT,
    Store_Name TEXT,
    Country TEXT,
    Region TEXT,
    City TEXT,
    Product_ID TEXT,
    Product_Name TEXT,
    Product_Category TEXT,
    Product_Subcategory TEXT,
    Quantity INTEGER,
    Unit_Price REAL,
    Discount_Percentage REAL,
    Sales_Amount REAL,
    Cost_Amount REAL,
    Profit REAL,
    Payment_Method TEXT,
    Order_Status TEXT,
    Shipping_Method TEXT,
    Delivery_Days INTEGER,
    Return_Flag TEXT,
    Return_Reason TEXT,
    Sales_Representative TEXT,
    Promotion_Code TEXT,
    Customer_Rating REAL,
    Inventory_Level INTEGER,
    Order_Year INTEGER,
    version INTEGER DEFAULT 1,
    sync_status TEXT DEFAULT 'SUCCESS_SYNCHRONIZED',
    last_replicated_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sales_category ON sales_records (Product_Category);
  CREATE INDEX IF NOT EXISTS idx_sales_status ON sales_records (Order_Status);
  CREATE INDEX IF NOT EXISTS idx_sales_year ON sales_records (Order_Year);

  CREATE TABLE IF NOT EXISTS replication_queue (
    id TEXT PRIMARY KEY,
    transaction_id TEXT UNIQUE NOT NULL,
    record_payload TEXT NOT NULL,
    previous_version INTEGER NOT NULL,
    attempted_version INTEGER NOT NULL,
    last_attempt_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    retry_count INTEGER DEFAULT 1,
    error_message TEXT,
    status TEXT DEFAULT 'PENDING_RETRY'
  );

  CREATE TABLE IF NOT EXISTS replication_events (
    event_id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    partition TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    from_version INTEGER NOT NULL,
    to_version INTEGER NOT NULL,
    changed_fields TEXT,
    sync_summary TEXT,
    details TEXT,
    timestamp TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rep_events_ts ON replication_events (timestamp DESC);
`);

// Safe migration for pre-existing data/sales.sqlite files
const eventCols = sqliteDb.prepare('PRAGMA table_info(replication_events)').all() as Array<{ name: string }>;
const eventColNames = new Set(eventCols.map((c) => c.name));
if (!eventColNames.has('changed_fields')) {
  sqliteDb.exec('ALTER TABLE replication_events ADD COLUMN changed_fields TEXT');
}
if (!eventColNames.has('sync_summary')) {
  sqliteDb.exec('ALTER TABLE replication_events ADD COLUMN sync_summary TEXT');
}

export const nosqlDb = new Datastore<SalesRecord>({
  filename: NEDB_FILE,
  autoload: true,
});

export const SCHEMA_COLUMNS = [
  'Transaction_ID',
  'Order_ID',
  'Customer_ID',
  'Customer_Name',
  'Customer_Age',
  'Customer_Gender',
  'Customer_Segment',
  'Order_Date',
  'Order_Time',
  'Sales_Channel',
  'Store_ID',
  'Store_Name',
  'Country',
  'Region',
  'City',
  'Product_ID',
  'Product_Name',
  'Product_Category',
  'Product_Subcategory',
  'Quantity',
  'Unit_Price',
  'Discount_Percentage',
  'Sales_Amount',
  'Cost_Amount',
  'Profit',
  'Payment_Method',
  'Order_Status',
  'Shipping_Method',
  'Delivery_Days',
  'Return_Flag',
  'Return_Reason',
  'Sales_Representative',
  'Promotion_Code',
  'Customer_Rating',
  'Inventory_Level',
  'Order_Year',
  'version',
  'sync_status',
  'last_replicated_at',
] as const;

export function clearDatabases() {
  sqliteDb.prepare('DELETE FROM sales_records').run();
  sqliteDb.prepare('DELETE FROM replication_queue').run();
  sqliteDb.prepare('DELETE FROM replication_events').run();
  return nosqlDb.removeAsync({}, { multi: true });
}
