import { OpenAI } from 'openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { DatabaseQueries } from '../database/queries';
import { logger } from '../utils/logger';
import { cacheManager } from '../utils/cache';
import { Helpers } from '../utils/helpers';
import { CONSTANTS } from '../config/constants';
import { AIResponse, KnowledgeDocument, ConversationContext } from '../types';

export class AIAgent {
  private openai: OpenAI;
  private embeddings: OpenAIEmbeddings;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY!,
      organization: process.env.OPENAI_ORG_ID
    });

    this.embeddings = new OpenAIEmbeddings({
      openAIApiKey: process.env.OPENAI_API_KEY!,
      modelName: "text-embedding-3-large"
    });
  }

  async generateResponse(
    query: string,
    context: ConversationContext
  ): Promise<AIResponse> {
    const startTime = Date.now();
    
    try {
      // Check cache first
      const cacheKey = `response:${Buffer.from(query).toString('base64')}`;
      const cachedResponse = cacheManager.get<AIResponse>(cacheKey);
      if (cachedResponse) {
        logger.info('Returning cached response');
        return { ...cachedResponse, responseTimeMs: Date.now() - startTime };
      }

      // Get relevant documents
      const documents = await this.searchKnowledgeBase(query);
      
      // Get conversation history
      const history = await DatabaseQueries.getConversationHistory(context.userId, 5);
      
      // Check for escalation triggers
      const escalationCheck = this.checkEscalation(query);
      
      // Generate system prompt
      const systemPrompt = this.buildSystemPrompt(documents, history);
      
      // Generate response
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: query }
        ],
        temperature: 0.7,
        max_tokens: 800,
        presence_penalty: 0.3,
        frequency_penalty: 0.3
      });

      const responseText = completion.choices[0].message.content || 
        "I'm having trouble generating a response. Please try again or contact support directly.";

      // Calculate confidence
      const confidence = this.calculateConfidence(documents, query, responseText);
      
      // Build response object
      const response: AIResponse = {
        response: this.enhanceResponse(responseText, confidence),
        confidence,
        shouldEscalate: escalationCheck.shouldEscalate || confidence < 0.6,
        escalationReason: escalationCheck.reason,
        responseTimeMs: Date.now() - startTime,
        sources: documents.map(d => d.source)
      };

      // Cache successful responses
      if (confidence > 0.7) {
        cacheManager.set(cacheKey, response, 3600);
      }

      // Log metrics
      logger.info('AI Response generated', {
        userId: context.userId,
        confidence,
        responseTime: response.responseTimeMs,
        escalated: response.shouldEscalate
      });

      return response;

    } catch (error) {
      logger.error('Error generating AI response:', error);
      
      return {
        response: this.getFallbackResponse(),
        confidence: 0,
        shouldEscalate: true,
        escalationReason: 'AI generation error',
        responseTimeMs: Date.now() - startTime,
        sources: []
      };
    }
  }

  private async searchKnowledgeBase(query: string): Promise<KnowledgeDocument[]> {
    try {
      // Generate embedding for query
      const embedding = await this.embeddings.embedQuery(query);
      
      // Search database
      const results = await DatabaseQueries.searchKnowledgeBase(
        embedding,
        8,
        0.65
      );
      
      return results as KnowledgeDocument[];
    } catch (error) {
      logger.error('Knowledge base search error:', error);
      return [];
    }
  }

  private buildSystemPrompt(documents: KnowledgeDocument[], history: any[]): string {
    const docContext = documents
      .map(d => `[${d.category || 'General'}] ${d.content}`)
      .join('\n\n');

    const historyContext = history
      .slice(-3)
      .map(h => `${h.sender}: ${Helpers.truncateString(h.content, 100)}`)
      .join('\n');

    return `You are the ACA Agency Support System, an advanced AI assistant helping licensed insurance agents with their daily work.

IDENTITY & TONE:
- You are a highly knowledgeable support system, not pretending to be human
- Be professional, helpful, and efficient
- Respond conversationally but clearly as an AI assistant
- Use "I" when referring to yourself as the support system
- Be confident in your responses when you have the information

YOUR CAPABILITIES:
- Instant access to all agency documentation and procedures
- Complete knowledge of HealthSherpa platform operations
- Detailed understanding of carrier requirements and commissions
- Current ACA regulations and compliance requirements
- Troubleshooting guides for common issues

RESPONSE GUIDELINES:
1. Be direct and specific - agents are busy and need quick answers
2. For HealthSherpa issues, provide exact click-by-click steps
3. Include specific percentages, dates, and figures when available
4. Break complex procedures into numbered steps
5. If you're not certain about something, say so clearly
6. For compliance or legal matters, always recommend verification with management

CURRENT CONTEXT:
Date/Time: ${Helpers.formatTimestamp(new Date())}
Business Hours: ${Helpers.isBusinessHours() ? 'Yes' : 'No (after hours)'}

RECENT CONVERSATION:
${historyContext || 'No recent history'}

RELEVANT KNOWLEDGE BASE:
${docContext || 'No specific documentation found for this query.'}

IMPORTANT REMINDERS:
- Open Enrollment Period: November 1 - January 15
- Special Enrollment Period: Qualifying events only
- Always verify client eligibility before enrollment
- Commission advances require management approval for amounts over $500

Remember: Provide immediate, actionable information that helps agents serve their clients efficiently.`;
  }

  private calculateConfidence(
    documents: KnowledgeDocument[],
    query: string,
    response: string
  ): number {
    let confidence = 0.5; // Base confidence

    // Boost for relevant documents
    if (documents.length > 0) {
      const avgSimilarity = documents.reduce((sum, d) => sum + d.similarity, 0) / documents.length;
      confidence += avgSimilarity * 0.3;
    }

    // Boost for specific keywords in query
    const specificKeywords = ['how to', 'what is', 'when', 'commission', 'healthsherpa'];
    const hasSpecificKeyword = specificKeywords.some(kw => query.toLowerCase().includes(kw));
    if (hasSpecificKeyword) confidence += 0.1;

    // Reduce confidence for vague queries
    if (query.length < 20) confidence -= 0.1;

    // Boost for response that includes specific numbers or dates
    const hasSpecifics = /\d+%|\$\d+|\d{1,2}\/\d{1,2}/.test(response);
    if (hasSpecifics) confidence += 0.1;

    return Math.min(Math.max(confidence, 0), 1);
  }

  private checkEscalation(query: string): { shouldEscalate: boolean; reason?: string } {
    const lowerQuery = query.toLowerCase();
    
    for (const keyword of CONSTANTS.ESCALATION_KEYWORDS) {
      if (lowerQuery.includes(keyword.toLowerCase())) {
        return {
          shouldEscalate: true,
          reason: `Contains escalation keyword: ${keyword}`
        };
      }
    }

    // Check for high dollar amounts
    const dollarMatch = query.match(/\$(\d{1,3},?\d{3,}|\d{4,})/);
    if (dollarMatch) {
      const amount = parseInt(dollarMatch[1].replace(/,/g, ''));
      if (amount > 5000) {
        return {
          shouldEscalate: true,
          reason: `High dollar amount: $${amount}`
        };
      }
    }

    return { shouldEscalate: false };
  }

  private enhanceResponse(response: string, confidence: number): string {
    let enhanced = response;

    // Add confidence indicator for low confidence responses
    if (confidence < 0.7) {
      enhanced += `\n\n*Note: I'm ${Math.round(confidence * 100)}% confident in this response. For critical matters, please verify with management.*`;
    }

    // Add helpful context for business hours
    if (!Helpers.isBusinessHours() && response.includes('contact') || response.includes('reach out')) {
      enhanced += '\n\n*Current time is outside regular business hours (8 AM - 6 PM EST). For urgent matters, use the emergency contact protocol.*';
    }

    return enhanced;
  }

  private getFallbackResponse(): string {
    return `I'm experiencing a technical issue accessing that information right now. 

For immediate assistance, please:
1. Check the agency knowledge base directly
2. Contact your direct supervisor
3. Post in the #support channel for peer assistance

I apologize for the inconvenience. This issue has been logged for review.`;
  }

  async processQuickCommand(command: string, args: string): Promise<string> {
    const commands: Record<string, (args: string) => Promise<string>> = {
      'commission': async (carrier) => {
        const carrierUpper = carrier.toUpperCase();
        const carrierInfo = CONSTANTS.CARRIERS[carrierUpper];
        
        if (carrierInfo) {
          return `**${carrierInfo.name} Commission Structure:**
• Commission Rate: ${carrierInfo.commission}
• Payment Schedule: ${carrierInfo.payment}
• Advance Available: Yes (management approval required for >$500)
• Chargeback Period: 90 days
• Bonus Eligibility: 20+ policies per month`;
        }
        
        return `Please specify a valid carrier. Available: ${Object.keys(CONSTANTS.CARRIERS).join(', ')}`;
      },
      
      'healthsherpa': async (issue) => {
        return `**HealthSherpa Troubleshooting:**

For "${issue}", try these steps:
1. Clear browser cache and cookies
2. Use Chrome or Firefox (not Safari)
3. Disable browser extensions
4. Check client's SEP qualification
5. Verify all required documents are uploaded

If the issue persists, note the error message and application ID for tech support.`;
      },
      
      'enrollment': async (type) => {
        const currentDate = new Date();
        const currentYear = currentDate.getFullYear();
        
        return `**Enrollment Periods for ${currentYear}:**

**Open Enrollment Period (OEP):**
• Dates: November 1, ${currentYear} - January 15, ${currentYear + 1}
• Coverage Start: January 1 (if enrolled by Dec 15)

**Special Enrollment Period (SEP):**
• 60 days from qualifying event
• Common qualifying events:
  - Loss of coverage
  - Marriage/Divorce
  - Birth/Adoption
  - Move to new coverage area
  - Income change affecting subsidies

Always verify documentation before submitting SEP applications.`;
      }
    };

    const handler = commands[command.toLowerCase()];
    if (handler) {
      return await handler(args);
    }
    
    return `Unknown command: ${command}. Available commands: ${Object.keys(commands).join(', ')}`;
  }
}
