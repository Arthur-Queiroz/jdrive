import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type AppDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString, max: Number(process.env.DB_POOL_SIZE ?? 5), idleTimeoutMillis: 30_000 });
  const lockPool = new pg.Pool({ connectionString, max: 1, idleTimeoutMillis: 30_000 });
  return { db: drizzle(pool, { schema }), pool, lockPool };
}
