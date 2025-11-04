import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function recreateTable() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Drop and recreate
    await client.query(`DROP TABLE IF EXISTS knowledge_base CASCADE`);
    
    await client.query(`
      CREATE TABLE knowledge_base (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        title VARCHAR(500),
        category VARCHAR(100),
        metadata JSONB DEFAULT '{}',
        embedding vector(3072),  -- Changed to 3072
        source VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    console.log('✅ Table recreated with 3072 dimension vectors');
    await client.end();
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

recreateTable();
