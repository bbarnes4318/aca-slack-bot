import * as dotenv from 'dotenv';
import { SlackBot } from './bot/slackBot';
import { initDatabase, testConnection, pool } from './database/migrations/db';
import { logger } from './utils/logger';
import express from 'express';

const healthApp = express();
const PORT = process.env.PORT || 3000;

healthApp.get('/', (req, res) => {
  res.status(200).json({ 
    service: 'ACA Slack Bot',
    status: 'running',
    message: 'This service operates within Slack. Visit /health for health checks.',
    timestamp: new Date().toISOString()
  });
});

healthApp.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

healthApp.listen(PORT, () => {
  logger.info(`Health check server running on port ${PORT}`);
});

// Load environment variables
dotenv.config();

// Validate required environment variables
function validateEnvironment(): void {
  const required = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_APP_TOKEN',
    'OPENAI_API_KEY'
  ];

  // Database configuration: either DATABASE_URL OR individual DB variables
  const hasDatabaseUrl = !!process.env.DATABASE_URL;
  const hasIndividualDbVars = !!(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER && process.env.DB_PASSWORD);
  
  if (!hasDatabaseUrl && !hasIndividualDbVars) {
    throw new Error('Missing database configuration: either DATABASE_URL or all of DB_HOST, DB_NAME, DB_USER, DB_PASSWORD must be set');
  }

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

async function main() {
  try {
    logger.info('🚀 Starting ACA Support System...');
    
    // Validate environment
    validateEnvironment();
    logger.info('✅ Environment variables validated');
    
    // Test database connection
    const dbConnected = await testConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }
    
    // Initialize database
    await initDatabase();
    logger.info('✅ Database initialized');
    
    // Start Slack bot
    const bot = new SlackBot();
    await bot.start();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down gracefully...');
      await bot.stop();
      await pool.end();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down gracefully...');
      await bot.stop();
      await pool.end();
      process.exit(0);
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
    
  } catch (error) {
    logger.error('Fatal error during startup:', error);
    process.exit(1);
  }
}

// Start the application
main();
