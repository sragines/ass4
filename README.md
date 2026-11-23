# Sales Ledger — Dual-Database Federated Data & Replication Console

**Sales Ledger** is a full-stack web application built for a distributed data systems assignment demonstrating heterogeneous storage across a relational **SQL** database (**SQLite**) and a document **NoSQL** database (**NeDB**). It implements deterministic 1/3 + 1/3 + 1/3 data partitioning, federated & store-specific search with deduplication, full 36-field record creation and editing, and a versioned cross-database replication protocol with an auditable **Replication Protocol Log**.

---

## 1. Assignment Overview

The original assignment explores how an enterprise sales ledger operates when records are split across relational and document storage engines rather than a single database:

- **Partitioned Storage**: Maintain distinct SQL-only, NoSQL-only, and shared (replicated) subsets under a unified 36-column sales schema.
- **Scoped & Federated Querying**: Query SQL alone, NoSQL alone, or both simultaneously while deduplicating overlapping records.
- **Record Fulfillment & Updates**: Create new records targeting a specific store (`SQL_ONLY`, `NOSQL_ONLY`, or `BOTH`) and modify existing records in-place.
- **Versioned Replication**: Synchronize updates on shared records across both engines with monotonic version numbers (`v1 → v2`), conflict/retry handling, and an inspectable synchronization log.

---

## 2. Dual-Database Architecture & `1/3 + 1/3 + 1/3` Partitioning

The backend (`Express` + `TypeScript` in `server.ts`) runs two embedded storage engines side-by-side under `data/`:

| Engine | Role | Driver | Storage File | Seeded Count |
| :--- | :--- | :--- | :--- | :--- |
| **SQLite** | Relational SQL store | `better-sqlite3` (WAL mode) | `data/sales.sqlite` | **600 records** (`300` SQL-only + `300` Shared) |
| **NeDB** | Document NoSQL store | `@seald-io/nedb` | `data/sales.db` | **600 records** (`300` NoSQL-only + `300` Shared) |
| **Federated Total** | Deduplicated logical ledger | Union by `Transaction_ID` | Both engines | **900 unique records** |

### Deterministic Partitioning (`index % 3`)

During seeding (`src/server/seed.ts`), each generated record `i` (`0..899`) is assigned a storage partition using `i % 3`:

- **`i % 3 === 0` → `SQL_ONLY` (300 records)**: Written exclusively to `sales_records` in SQLite.
- **`i % 3 === 1` → `NOSQL_ONLY` (300 records)**: Written exclusively to the NeDB datastore (`sales.db`).
- **`i % 3 === 2` → `BOTH` (300 records)**: Written identically to **both** SQLite and NeDB as replicated shared records.

The three compact dashboard metric cards align directly with these counts (`SQL (SQLite)`, `NoSQL (NeDB)`, and `Total Unique Records`) and recalculate live whenever records are fulfilled or promoted.

---

## 3. Why 900 Records Matching `sales_data_dictionary.csv` Are Generated on Startup

On server startup (`server.ts`), the app checks `data/sales.sqlite` and automatically invokes `seedPartitionedDatabases(900)` whenever the database is empty (or fails schema/integrity checks):

1. **Zero-Config Evaluation**: Evaluators can clone and start the app immediately without manually importing external CSV files or running separate seed scripts.
2. **Exact 36-Field Schema Parity**: Every record strictly conforms to all 36 fields defined in `sales_data_dictionary.csv` (`Transaction_ID`, `Order_ID`, `Customer_ID`, `Customer_Name`, `Customer_Age`, `Customer_Gender`, `Customer_Segment`, `Order_Date`, `Order_Time`, `Sales_Channel`, `Store_ID`, `Store_Name`, `Country`, `Region`, `City`, `Product_ID`, `Product_Name`, `Product_Category`, `Product_Subcategory`, `Quantity`, `Unit_Price`, `Discount_Percentage`, `Sales_Amount`, `Cost_Amount`, `Profit`, `Payment_Method`, `Order_Status`, `Shipping_Method`, `Delivery_Days`, `Return_Flag`, `Return_Reason`, `Sales_Representative`, `Promotion_Code`, `Customer_Rating`, `Inventory_Level`, `Order_Year`), plus replication metadata (`version`, `sync_status`, `last_replicated_at`).
3. **Deterministic Reproducibility & Referential Consistency**: Using a deterministic Linear Congruential Generator (PRNG), startup seeding produces reproducible records (`TXN-100000` through `TXN-100899`) across 4 clean product categories (`Electronics`, `Furniture`, `Office Supplies`, `Accessories` — 13 products) and a strict 1-to-1 store-to-city mapping (14 stores across 12 cities) so dropdown catalogs and totals remain consistent on every fresh run.

---

## 4. Core Features

### Search, Filtering & Sorting (`GET /api/records`)
- **Three Search Scopes**:
  - **All / Federated**: Queries both SQLite and NeDB and deduplicates shared `BOTH` records by `Transaction_ID` (900 unique records initially).
  - **SQL Only (SQLite)**: Queries only `data/sales.sqlite` (600 records initially).
  - **NoSQL Only (NeDB)**: Queries only `data/sales.db` (600 records initially).
- **Filtering & Column Sorting**: Real-time text search (Transaction ID, Customer, Product, City, Store), `Product_Category` and `Order_Status` dropdown filters, pagination (25 rows/page), and clickable ascending/descending sorting on `Transaction ID`, `Date & Channel`, `Customer`, `Qty & Amount`, `Order Status`, and `Partition & Sync`.

### Record Creation & Modification
- **Fulfill New Sales Record (`POST /api/records`)**:
  - **Dynamic Product Catalog (`GET /api/products`)**: Selecting a product auto-populates `Product_ID`, `Product_Category`, `Product_Subcategory`, and default `Unit_Price`.
  - **Bidirectionally Linked City & Store Selection (`GET /api/stores`)**: Selecting a `City` filters `Store Name` to valid stores in that city (with an `All Cities` reset option); selecting a `Store Name` locks in its matching `City`, `Store_ID`, `Region`, and `Country`.
  - **Transparent Net Sales Calculation**: Explicit `Quantity`, `Unit Price ($)`, and `Discount (%)` (`0%`–`20%`) controls compute `Net Sales = Quantity × Unit Price × (1 - Discount%)` live.
  - **Target Partition**: Choose `BOTH`, `SQL_ONLY`, or `NOSQL_ONLY` at creation time.
- **Edit & Replicate (`PUT /api/records/:id`) + Dual-Store Inspector (`GET /api/records/:id`)**:
  - Inspect any record side-by-side (`SQLite` row vs. `NeDB` document) to verify payload and version parity.
  - Edit any of the 36 business fields in the modal and submit updates with optimistic version checking (`expectedVersion`).

### Versioned Replication & Protocol Log
- **Versioned Synchronization**: Every update increments `version` (`v1 → v2`, `v2 → v3`, etc.) and updates `last_replicated_at`. Updating a `BOTH` record synchronizes both SQLite and NeDB and prevents stale concurrent writes (`409 VersionConflictError`).
- **Retry Queue Resilience**: When simulated or transient replication failures occur on the secondary store, failed sync payloads are queued in `replication_queue` (`PENDING_RETRY`) and reconciled by the background replication worker (`src/server/replication.ts`).
- **Replication Protocol Log (`Replication Log` Drawer)**: Whenever a shared `BOTH` record is created (`INSERT`) or updated (`UPDATE`), an audit entry is persisted to `replication_events` (SQLite) and streamed into the **Replication Protocol Log** drawer—displaying `Transaction_ID`, action badge, version bump (`v1 → v2`), changed field diffs, timestamp, and `SYNCED` status.

---

## 5. Local Setup & Running the App

### Prerequisites
- **Node.js** `v18+` (includes `npm`)

### Installation & Development Server

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the full-stack server (Express API + Vite frontend on port 3000):**
   ```bash
   npm run dev
   ```

3. **Open the application:**
   Navigate to [http://localhost:3000](http://localhost:3000). On first boot, the server creates `data/sales.sqlite` and `data/sales.db` and seeds all 900 partitioned records automatically.

### Additional Scripts

```bash
# Run automated dual-database partitioning, deduplication, and replication tests
npm test

# Type-check TypeScript across frontend and backend
npm run lint

# Build the production frontend bundle into dist/
npm run build

# Run in production mode (serves built dist/ via server.ts)
NODE_ENV=production npm start
```
