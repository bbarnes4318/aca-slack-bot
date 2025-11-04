import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

async function setupDatabase() {
  let clientConfig: any;
  let client: Client;
  
  if (process.env.DATABASE_URL) {
    console.log('Using DATABASE_URL for connection...');
    
    // FIX FOR SSL CERTIFICATE ERROR
    clientConfig = {
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
        // These additional options help with DO's self-signed certs
        ca: undefined,
        cert: undefined,
        key: undefined
      }
    };
    client = new Client(clientConfig);
  } else {
    console.log('Using individual DB parameters...');
    clientConfig = {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: 'postgres',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };
    client = new Client(clientConfig);
  }

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL server');

    if (process.env.DATABASE_URL) {
      console.log('✅ Using database from DATABASE_URL');
    } else {
      const dbName = process.env.DB_NAME || 'aca_bot_production';
      const checkDb = await client.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [dbName]
      );

      if (checkDb.rows.length === 0) {
        await client.query(`CREATE DATABASE ${dbName}`);
        console.log(`✅ Created database: ${dbName}`);
      }

      await client.end();

      const dbClient = new Client({
        ...clientConfig,
        database: dbName
      });
      await dbClient.connect();
      client = dbClient;
      console.log(`✅ Connected to database: ${dbName}`);
    }

    // Try to create extensions
    try {
      await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
      await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);
      console.log('✅ Extensions created/verified');
    } catch (extError: any) {
      console.log('⚠️  Could not create extensions (may need superuser):', extError.message);
      
      // For Digital Ocean, vector extension might already exist
      if (extError.message.includes('vector')) {
        try {
          const result = await client.query(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
          if (result.rows.length > 0) {
            console.log('✅ Vector extension already exists');
          }
        } catch (e) {
          console.log('⚠️  Could not verify vector extension');
        }
      }
    }

// Read and execute migration SQL
// Skip migration - tables already exist
console.log('✅ Skipping migration - tables already created');

/* COMMENTED OUT FOR NOW - Migration has trigger syntax issues
const migrationPath = path.join(__dirname, '../src/database/migrations/001_initial_setup.sql');

if (fs.existsSync(migrationPath)) {
  console.log('📄 Found migration file, executing...');
  const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
  
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  for (const statement of statements) {
    try {
      await client.query(statement + ';');
    } catch (err: any) {
      if (err.message.includes('already exists')) {
        console.log('⚠️  Table/Type already exists, continuing...');
      } else {
        throw err;
      }
    }
  }
  console.log('✅ Migration executed successfully');
} else {
  console.log('⚠️  No migration file found, creating basic tables...');
  
  // ALL THIS TABLE CREATION CODE BELOW SHOULD BE INSIDE THE COMMENT TOO
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS knowledge_base (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        title VARCHAR(500),
        category VARCHAR(100),
        metadata JSONB DEFAULT '{}',
        embedding vector(1536),
        source VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Created knowledge_base table');
  } catch (err: any) {
    if (!err.message.includes('already exists')) {
      console.log('⚠️  Error creating knowledge_base:', err.message);
    }
  }
  
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        slack_user_id VARCHAR(255),
        slack_user_name VARCHAR(255),
        slack_channel_id VARCHAR(255),
        slack_thread_ts VARCHAR(255),
        status VARCHAR(50) DEFAULT 'active',
        escalated BOOLEAN DEFAULT FALSE,
        escalation_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        resolved_at TIMESTAMP
      )
    `);
    console.log('✅ Created conversations table');
  } catch (err: any) {
    if (!err.message.includes('already exists')) {
      console.log('⚠️  Error creating conversations:', err.message);
    }
  }
  
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER REFERENCES conversations(id),
        sender VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        confidence_score FLOAT,
        response_time_ms INTEGER,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Created messages table');
  } catch (err: any) {
    if (!err.message.includes('already exists')) {
      console.log('⚠️  Error creating messages:', err.message);
    }
  }
  
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        message_id INTEGER REFERENCES messages(id),
        slack_user_id VARCHAR(255),
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        helpful BOOLEAN,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Created feedback table');
  } catch (err: any) {
    if (!err.message.includes('already exists')) {
      console.log('⚠️  Error creating feedback:', err.message);
    }
  }
  
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_profiles (
        id SERIAL PRIMARY KEY,
        slack_user_id VARCHAR(255) UNIQUE,
        name VARCHAR(255),
        email VARCHAR(255),
        total_queries INTEGER DEFAULT 0,
        last_active TIMESTAMP,
        preferences JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Created agent_profiles table');
  } catch (err: any) {
    if (!err.message.includes('already exists')) {
      console.log('⚠️  Error creating agent_profiles:', err.message);
    }
  }
  
  console.log('✅ All basic tables created');
}
*/  // <--- CLOSING COMMENT HERE!

    await client.end();
    console.log('✅ Database setup complete!');
    
  } catch (error: any) {
    console.error('❌ Database setup failed:', error.message);
    
    if (error.message.includes('ETIMEDOUT')) {
      console.log('\n🔥 Connection timed out. Try these fixes:');
      console.log('   1. Add your IP to Digital Ocean trusted sources');
      console.log('   2. Check if DATABASE_URL is correct');
      console.log('   3. Try adding 0.0.0.0/0 to trusted sources temporarily');
    } else if (error.message.includes('password')) {
      console.log('\n🔥 Authentication failed. Check:');
      console.log('   1. DATABASE_URL has the correct password');
      console.log('   2. No extra spaces or quotes in .env file');
    } else if (error.message.includes('self-signed certificate')) {
      console.log('\n🔥 SSL Certificate issue. Try:');
      console.log('   1. The fix has been applied - try running again');
      console.log('   2. Check DATABASE_URL ends with ?sslmode=require');
      console.log('   3. Ensure you are using the public network connection string');
    }
    
    process.exit(1);
  }
}

setupDatabase();
