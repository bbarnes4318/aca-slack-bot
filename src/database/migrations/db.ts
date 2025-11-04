import { Pool, Client, PoolConfig } from 'pg';
import { logger } from '../../utils/logger';

// SMART CONFIG: Checks for DATABASE_URL first (App Platform), 
// falls back to individual vars (local development)
function createPoolConfig(): PoolConfig {
  // App Platform provides DATABASE_URL
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      },
      max: parseInt(process.env.DB_POOL_SIZE || '20'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000
    };
  }
  
  // Local development or Droplet deployment
  return {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: parseInt(process.env.DB_POOL_SIZE || '20'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  };
}

// Create pool with smart config
export const pool = new Pool(createPoolConfig());

// Keep all your existing event handlers
pool.on('error', (err) => {
  logger.error('Unexpected database error:', err);
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});

// Keep your existing testConnection function - NO CHANGES
export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    logger.info('Database connection successful:', result.rows[0]);
    return true;
  } catch (error) {
    logger.error('Database connection failed:', error);
    return false;
  }
}

// Keep your existing initDatabase function - NO CHANGES
export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    // Test vector extension
    await client.query('SELECT vector_version()');
    logger.info('pgvector extension is ready');
    
    // Verify tables exist
    const tables = ['knowledge_base', 'conversations', 'messages', 'feedback'];
    for (const table of tables) {
      const result = await client.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        )`,
        [table]
      );
      
      if (!result.rows[0].exists) {
        throw new Error(`Table ${table} does not exist. Run npm run setup first.`);
      }
    }
    
    logger.info('All database tables verified');
  } finally {
    client.release();
  }
}
