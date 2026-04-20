import { Pool } from 'pg';

const globalForPg = globalThis as unknown as { pool?: Pool };

export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://lookout:lookout@localhost:5434/lookout',
    max: 5,
  });

if (process.env.NODE_ENV !== 'production') globalForPg.pool = pool;

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}
