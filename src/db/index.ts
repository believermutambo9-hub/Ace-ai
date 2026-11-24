import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

// Add global connection pool caching to persist across hot-reloads
declare global {
  var _postgresPool: Pool | undefined;
}

// Function to create or retrieve the connection pool.
export const createPool = () => {
  if (!global._postgresPool) {
    // If SQL_HOST and SQL_USER are present (e.g. Cloud SQL unix socket or host parameters),
    // use discrete parameters as it avoids URL encoding issues with special characters.
    if (process.env.SQL_HOST && process.env.SQL_USER) {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      });
    } else if (process.env.DATABASE_URL) {
      global._postgresPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
        ssl:
          process.env.DATABASE_URL.includes('sslmode=disable')
            ? false
            : process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
            ? false
            : { rejectUnauthorized: false },
      });
    } else {
      global._postgresPool = new Pool({
        host: process.env.SQL_HOST || 'localhost',
        user: process.env.SQL_USER || 'postgres',
        password: process.env.SQL_PASSWORD || '',
        database: process.env.SQL_DB_NAME || 'postgres',
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 15000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      });
    }

    // Handle idle connection closures without bubbling false alarm error logs.
    // In Cloud SQL and serverless environments, idle TCP sockets are routinely closed by cloud proxies.
    // The pg pool automatically evicts terminated clients from the pool and opens fresh ones when needed.
    global._postgresPool.on('error', (err: any) => {
      const isIdleDisconnect =
        err?.message?.includes('Connection terminated unexpectedly') ||
        err?.code === 'ECONNRESET' ||
        err?.code === '57P01' ||
        err?.message?.includes('closed') ||
        err?.message?.includes('socket') ||
        err?.message?.includes('timeout');

      if (isIdleDisconnect) {
        // Discarded gracefully by pg pool without affecting active queries
        console.debug?.('[SQL Pool] Idle connection refreshed by pool:', err?.message || err);
      } else {
        console.warn('[SQL Pool] Notice on pool client:', err?.message || err);
      }
    });
  }
  return global._postgresPool;
};

// Create or retrieve the pool instance.
export const pool = createPool();

// Initialize Drizzle with the pool and schema.
export const db = drizzle(pool, { schema });
