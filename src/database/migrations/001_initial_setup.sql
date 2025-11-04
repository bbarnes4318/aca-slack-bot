-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create enum types
CREATE TYPE conversation_status AS ENUM ('active', 'resolved', 'escalated', 'archived');
CREATE TYPE message_sender AS ENUM ('user', 'bot', 'system');

-- Knowledge base table
CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    content TEXT NOT NULL,
    title VARCHAR(500),
    category VARCHAR(100),
    subcategory VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    embedding vector(1536),
    source VARCHAR(255),
    source_type VARCHAR(50),
    importance_score FLOAT DEFAULT 0.5,
    usage_count INTEGER DEFAULT 0,
    last_accessed TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    slack_user_id VARCHAR(50) NOT NULL,
    slack_user_name VARCHAR(255),
    slack_channel_id VARCHAR(50),
    slack_thread_ts VARCHAR(50),
    status conversation_status DEFAULT 'active',
    escalated BOOLEAN DEFAULT FALSE,
    escalation_reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    INDEX idx_user_id (slack_user_id),
    INDEX idx_channel_id (slack_channel_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at DESC)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    sender message_sender NOT NULL,
    content TEXT NOT NULL,
    confidence_score FLOAT,
    response_time_ms INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_conversation_id (conversation_id),
    INDEX idx_created_at (created_at DESC)
);

-- User feedback table
CREATE TABLE IF NOT EXISTS feedback (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    slack_user_id VARCHAR(50),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    helpful BOOLEAN,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Agent profiles table (for tracking agent interactions)
CREATE TABLE IF NOT EXISTS agent_profiles (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    slack_user_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255),
    total_queries INTEGER DEFAULT 0,
    last_active TIMESTAMP,
    preferences JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- System metrics table
CREATE TABLE IF NOT EXISTS system_metrics (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    metric_name VARCHAR(100),
    metric_value FLOAT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Escalation queue table
CREATE TABLE IF NOT EXISTS escalation_queue (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id),
    priority INTEGER DEFAULT 5,
    reason TEXT,
    assigned_to VARCHAR(50),
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_kb_embedding ON knowledge_base USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_kb_category ON knowledge_base(category, subcategory);
CREATE INDEX idx_kb_content_trgm ON knowledge_base USING gin (content gin_trgm_ops);
CREATE INDEX idx_kb_metadata ON knowledge_base USING gin (metadata);
CREATE INDEX idx_conversations_user_time ON conversations(slack_user_id, created_at DESC);
CREATE INDEX idx_messages_conversation_time ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_feedback_user ON feedback(slack_user_id);

-- Create views for analytics
CREATE OR REPLACE VIEW daily_metrics AS
SELECT 
    DATE(created_at) as date,
    COUNT(DISTINCT slack_user_id) as unique_users,
    COUNT(*) as total_conversations,
    AVG(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolution_rate,
    COUNT(CASE WHEN escalated = true THEN 1 END) as escalations
FROM conversations
GROUP BY DATE(created_at);

CREATE OR REPLACE VIEW agent_activity AS
SELECT 
    ap.name,
    ap.slack_user_id,
    ap.total_queries,
    COUNT(c.id) as recent_queries,
    AVG(m.confidence_score) as avg_confidence,
    ap.last_active
FROM agent_profiles ap
LEFT JOIN conversations c ON c.slack_user_id = ap.slack_user_id 
    AND c.created_at > NOW() - INTERVAL '7 days'
LEFT JOIN messages m ON m.conversation_id = c.id
GROUP BY ap.id;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_knowledge_base_updated_at BEFORE UPDATE ON knowledge_base
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agent_profiles_updated_at BEFORE UPDATE ON agent_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
