import * as dotenv from 'dotenv';
import { AIAgent } from '../src/ai/aiAgent';
import { initDatabase, pool } from '../src/database/db';
import { ConversationContext } from '../src/types';

dotenv.config();

async function testBot() {
  console.log('🧪 Testing ACA Support System...\n');

  try {
    // Initialize database
    await initDatabase();
    console.log('✅ Database connected\n');

    // Initialize AI agent
    const aiAgent = new AIAgent();
    console.log('✅ AI Agent initialized\n');

    // Test queries
    const testQueries = [
      "What is the commission rate for Blue Cross Blue Shield?",
      "How do I fix a HealthSherpa application that won't submit?",
      "When is the open enrollment period?",
      "What documents are needed for SEP qualification?",
      "How do I process a commission advance request?"
    ];

    // Create mock context
    const mockContext: ConversationContext = {
      conversationId: 'test-conversation',
      userId: 'test-user',
      userName: 'Test Agent',
      channelId: 'test-channel',
      history: []
    };

    // Run tests
    for (const query of testQueries) {
      console.log(`📝 Query: "${query}"`);
      console.log('-'.repeat(50));
      
      const response = await aiAgent.generateResponse(query, mockContext);
      
      console.log(`✅ Response (${(response.confidence * 100).toFixed(0)}% confidence):`);
      console.log(response.response);
      console.log(`⏱️ Response time: ${response.responseTimeMs}ms`);
      
      if (response.shouldEscalate) {
        console.log(`⚠️ Would escalate: ${response.escalationReason}`);
      }
      
      console.log('\n' + '='.repeat(70) + '\n');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await pool.end();
  }
}

testBot();
