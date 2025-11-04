export interface KnowledgeDocument {
  id: string;
  content: string;
  title?: string;
  category?: string;
  subcategory?: string;
  metadata: Record<string, any>;
  similarity: number;
  source: string;
}

export interface ConversationContext {
  conversationId: string;
  userId: string;
  userName: string;
  channelId: string;
  threadTs?: string;
  history: Message[];
}

export interface Message {
  id: string;
  sender: 'user' | 'bot' | 'system';
  content: string;
  timestamp: Date;
  confidence?: number;
}

export interface AIResponse {
  response: string;
  confidence: number;
  shouldEscalate: boolean;
  escalationReason?: string;
  responseTimeMs: number;
  sources: string[];
}

export interface AgentProfile {
  id: string;
  slackUserId: string;
  name: string;
  email?: string;
  totalQueries: number;
  lastActive: Date;
  preferences: Record<string, any>;
}

export interface SystemConfig {
  botName: string;
  responseDelayMin: number;
  responseDelayMax: number;
  confidenceThreshold: number;
  escalationThreshold: number;
  enableLearning: boolean;
  enableCache: boolean;
}
