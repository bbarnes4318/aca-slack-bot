import { Pool, Client, PoolConfig } from 'pg';
import { logger } from '../../utils/logger';
import { readFileSync } from 'fs';
import { join } from 'path';

// SMART CONFIG: Checks for DATABASE_URL first (App Platform), 
// falls back to individual vars (local development)
function createPoolConfig(): PoolConfig {
  // App Platform provides DATABASE_URL
  if (process.env.DATABASE_URL) {
    // Parse connection string to extract components
    const dbUrl = new URL(process.env.DATABASE_URL);
    
    // Build config with explicit SSL settings
    const config: PoolConfig = {
      host: dbUrl.hostname,
      port: parseInt(dbUrl.port || '5432'),
      database: dbUrl.pathname.slice(1), // Remove leading /
      user: dbUrl.username,
      password: dbUrl.password,
      ssl: {
        rejectUnauthorized: false
      },
      max: parseInt(process.env.DB_POOL_SIZE || '20'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    };
    
    return config;
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
    connectionTimeoutMillis: 10000,
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
    // Check and install vector extension if needed
    try {
      await client.query('SELECT vector_version()');
      logger.info('pgvector extension is ready');
    } catch (error: any) {
      if (error.code === '42883') {
        logger.info('pgvector extension not found - installing...');
        try {
          await client.query('CREATE EXTENSION IF NOT EXISTS vector');
          logger.info('pgvector extension installed successfully');
        } catch (installError: any) {
          logger.error('Failed to install pgvector extension:', installError);
          throw new Error('pgvector extension is required but could not be installed. Please install manually: CREATE EXTENSION vector;');
        }
      } else {
        throw error;
      }
    }
    
    // Verify tables exist, create if missing
    const tables = ['knowledge_base', 'conversations', 'messages', 'feedback'];
    const missingTables: string[] = [];
    
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
        missingTables.push(table);
      }
    }
    
    // Run migration if tables are missing
    if (missingTables.length > 0) {
      logger.info(`Missing tables detected: ${missingTables.join(', ')}. Running migration...`);
      try {
        const migrationSQL = readFileSync(
          join(__dirname, '001_initial_setup.sql'),
          'utf-8'
        );
        await client.query(migrationSQL);
        logger.info('Database migration completed successfully');
      } catch (migrationError: any) {
        logger.error('Failed to run migration:', migrationError);
        throw new Error(`Database tables are missing and migration failed: ${migrationError.message}`);
      }
    } else {
      logger.info('All database tables verified');
    }
  } finally {
    client.release();
  }
}
