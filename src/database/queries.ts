import { pool } from './db';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export class DatabaseQueries {
  // Knowledge Base Queries
  static async searchKnowledgeBase(embedding: number[], limit: number = 5, threshold: number = 0.7) {
    const query = `
      SELECT 
        id,
        content,
        title,
        category,
        subcategory,
        metadata,
        source,
        1 - (embedding <=> $1::vector) as similarity
      FROM knowledge_base
      WHERE 1 - (embedding <=> $1::vector) > $2
      ORDER BY embedding <=> $1::vector
      LIMIT $3
    `;
    
    const result = await pool.query(query, [JSON.stringify(embedding), threshold, limit]);
    
    // Update usage count for retrieved documents
    if (result.rows.length > 0) {
      const ids = result.rows.map(r => r.id);
      await pool.query(
        `UPDATE knowledge_base 
         SET usage_count = usage_count + 1, 
             last_accessed = NOW() 
         WHERE id = ANY($1::uuid[])`,
        [ids]
      );
    }
    
    return result.rows;
  }

  static async insertKnowledgeBase(data: {
    content: string;
    title?: string;
    category?: string;
    subcategory?: string;
    metadata?: any;
    embedding: number[];
    source: string;
    source_type: string;
  }) {
    const query = `
      INSERT INTO knowledge_base 
        (content, title, category, subcategory, metadata, embedding, source, source_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;
    
    const result = await pool.query(query, [
      data.content,
      data.title,
      data.category,
      data.subcategory,
      JSON.stringify(data.metadata || {}),
      JSON.stringify(data.embedding),
      data.source,
      data.source_type
    ]);
    
    return result.rows[0].id;
  }

  // Conversation Management
  static async createConversation(userId: string, userName: string, channelId: string, threadTs?: string) {
    const query = `
      INSERT INTO conversations 
        (slack_user_id, slack_user_name, slack_channel_id, slack_thread_ts)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `;
    
    const result = await pool.query(query, [userId, userName, channelId, threadTs]);
    return result.rows[0].id;
  }

  static async getOrCreateConversation(userId: string, userName: string, channelId: string, threadTs?: string) {
    // Try to find existing active conversation
    let query = `
      SELECT id FROM conversations 
      WHERE slack_user_id = $1 
        AND slack_channel_id = $2 
        AND status = 'active'
    `;
    
    const params = [userId, channelId];
    
    if (threadTs) {
      query += ' AND slack_thread_ts = $3';
      params.push(threadTs);
    }
    
    query += ' ORDER BY created_at DESC LIMIT 1';
    
    let result = await pool.query(query, params);
    
    if (result.rows.length > 0) {
      return result.rows[0].id;
    }
    
    // Create new conversation
    return await this.createConversation(userId, userName, channelId, threadTs);
  }

  static async addMessage(conversationId: string, sender: 'user' | 'bot', content: string, confidence?: number, responseTimeMs?: number) {
    const query = `
      INSERT INTO messages 
        (conversation_id, sender, content, confidence_score, response_time_ms)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    
    const result = await pool.query(query, [
      conversationId,
      sender,
      content,
      confidence,
      responseTimeMs
    ]);
    
    return result.rows[0].id;
  }

  static async getConversationHistory(userId: string, limit: number = 10) {
    const query = `
      SELECT 
        c.id,
        c.created_at,
        m.sender,
        m.content,
        m.confidence_score
      FROM conversations c
      JOIN messages m ON m.conversation_id = c.id
      WHERE c.slack_user_id = $1
      ORDER BY m.created_at DESC
      LIMIT $2
    `;
    
    const result = await pool.query(query, [userId, limit]);
    return result.rows.reverse();
  }

  // User Profile Management
  static async updateAgentProfile(userId: string, name: string, email?: string) {
    const query = `
      INSERT INTO agent_profiles (slack_user_id, name, email, total_queries, last_active)
      VALUES ($1, $2, $3, 1, NOW())
      ON CONFLICT (slack_user_id) 
      DO UPDATE SET 
        name = EXCLUDED.name,
        email = COALESCE(EXCLUDED.email, agent_profiles.email),
        total_queries = agent_profiles.total_queries + 1,
        last_active = NOW()
      RETURNING *
    `;
    
    const result = await pool.query(query, [userId, name, email]);
    return result.rows[0];
  }

  static async getAgentProfile(userId: string) {
    const query = 'SELECT * FROM agent_profiles WHERE slack_user_id = $1';
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }

  // Escalation Management
  static async createEscalation(conversationId: string, reason: string, priority: number = 5) {
    const query = `
      INSERT INTO escalation_queue (conversation_id, reason, priority)
      VALUES ($1, $2, $3)
      RETURNING id
    `;
    
    const result = await pool.query(query, [conversationId, reason, priority]);
    
    // Update conversation status
    await pool.query(
      `UPDATE conversations 
       SET escalated = true, 
           escalation_reason = $1,
           status = 'escalated'
       WHERE id = $2`,
      [reason, conversationId]
    );
    
    return result.rows[0].id;
  }

  // Feedback Management
  static async saveFeedback(messageId: string, userId: string, rating?: number, comment?: string, helpful?: boolean) {
    const query = `
      INSERT INTO feedback (message_id, slack_user_id, rating, comment, helpful)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    
    const result = await pool.query(query, [messageId, userId, rating, comment, helpful]);
    return result.rows[0].id;
  }

  // Analytics
  static async getSystemMetrics(days: number = 7) {
    const query = `
      SELECT 
        COUNT(DISTINCT c.slack_user_id) as unique_users,
        COUNT(DISTINCT c.id) as total_conversations,
        COUNT(m.id) as total_messages,
        AVG(m.confidence_score) as avg_confidence,
        COUNT(CASE WHEN c.escalated THEN 1 END) as escalations,
        AVG(m.response_time_ms) as avg_response_time
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.created_at > NOW() - INTERVAL '${days} days'
    `;
    
    const result = await pool.query(query);
    return result.rows[0];
  }
}
