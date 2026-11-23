import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './src/server/api.ts';
import { sqliteDb } from './src/server/db.ts';
import { seedPartitionedDatabases } from './src/server/seed.ts';
import { startBackgroundReplicationWorker } from './src/server/replication.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Auto-seed initial 900 records if database is fresh or contains legacy overlapping categories
  try {
    const row = sqliteDb.prepare('SELECT COUNT(*) as count FROM sales_records').get() as { count: number };
    const legacyRow = sqliteDb
      .prepare(
        "SELECT COUNT(*) as count FROM sales_records WHERE Product_Category IN ('Technology', 'Consumer Electronics', 'Industrial Equipment')"
      )
      .get() as { count: number };

    const mismatchRow = sqliteDb
      .prepare(
        'SELECT COUNT(*) as count FROM (SELECT Store_Name FROM sales_records GROUP BY Store_Name HAVING COUNT(DISTINCT City) > 1)'
      )
      .get() as { count: number };

    if (row.count === 0 || legacyRow.count > 0 || mismatchRow.count > 0) {
      console.log('Initializing databases with 900 partitioned synthetic sales records (4 clean categories, strict store-city mapping)...');
      await seedPartitionedDatabases(900);
      console.log('Seeding completed: 600 SQLite records, 600 NeDB records, 300 shared.');
    } else {
      console.log(`Database already initialized with ${row.count} SQLite records.`);
    }
  } catch (err) {
    console.warn('Initial seed check error, attempting seed:', err);
    await seedPartitionedDatabases(900);
  }

  startBackgroundReplicationWorker();

  // Mount API endpoints
  app.use('/api', apiRouter);

  // Vite middleware in dev or static files in production
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 DataMesh Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup failure:', err);
  process.exit(1);
});
