import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function fixColumns() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Add ALL missing columns
    console.log('🔧 Adding missing columns...');
    
    const columnsToAdd = [
      'ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS subcategory VARCHAR(100)',
      'ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS source_type VARCHAR(50)',
      'ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS importance_score FLOAT DEFAULT 0.5',
      'ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0',
      'ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS last_accessed TIMESTAMP',
      'ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()'
    ];
    
    for (const query of columnsToAdd) {
      try {
        await client.query(query);
        console.log(`✅ ${query.split(' ')[5]} added`);
      } catch (err: any) {
        if (err.message.includes('already exists')) {
          console.log(`⚠️  Column already exists, skipping...`);
        } else {
          console.error(`❌ Error: ${err.message}`);
        }
      }
    }
    
    console.log('✅ All columns added successfully');
    await client.end();
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixColumns();
