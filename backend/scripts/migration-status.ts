import '../src/env.js';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const { rows } = await pool.query<{ present: string | null }>("SELECT to_regclass('drizzle.__drizzle_migrations')::text AS present");
  if (!rows[0]?.present) {
    console.log('Nenhuma migração aplicada (ledger ainda não existe).');
  } else {
    const result = await pool.query<{ count: string; latest: string | null }>(
      'SELECT count(*)::text AS count, max(created_at)::text AS latest FROM drizzle.__drizzle_migrations',
    );
    console.log(`Migrações aplicadas: ${result.rows[0]?.count ?? '0'}; timestamp mais recente: ${result.rows[0]?.latest ?? 'n/a'}`);
  }
} finally {
  await pool.end();
}
