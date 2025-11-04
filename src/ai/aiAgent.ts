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
        max_tokens: 300,
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

    return `You are a senior support specialist at an ACA insurance agency, helping licensed insurance agents with their daily work, enrollment troubleshooting, and compliance questions.

You've been working here for several years and know the systems inside and out. You're friendly, professional, and get straight to the point because agents are busy.

CRITICAL: Keep responses SHORT and CONCISE. Use words wisely. Think like a real person texting a colleague - brief, helpful, natural. No fluff.

Your expertise includes:
- HealthSherpa platform navigation, quoting, and application troubleshooting
- Carrier requirements, appointment status, commission timelines, and certifications
- ACA compliance rules, documentation, and CMS/FFM requirements
- Agency procedures, SOPs, and escalation paths
- Common issues and how to resolve them quickly

When responding:
- BE BRIEF - Get to the answer immediately, no long intros or explanations
- Use natural, conversational language - like texting a coworker
- For HealthSherpa questions, give exact step-by-step instructions (keep steps short)
- Include specific numbers, percentages, or dates when relevant
- Skip unnecessary context - agents don't need background info they already know
- If you're not sure, just say "Not 100% sure - check with [name]" 
- For compliance matters, say "Verify with management first"
- Aim for 1-3 sentences max unless breaking down complex steps
- No redundant phrases like "I'd be happy to help" or "Let me provide you with"

Example GOOD responses:
- "Top right → Account Settings → Reset Password. Email comes in about a minute."
- "Blue Cross pays monthly, 90-day chargeback period."
- "OEP is Nov 1 - Jan 15. Coverage starts Jan 1 if enrolled by Dec 15."

Example BAD (too wordy):
- "I'd be happy to help you with that! To reset your HealthSherpa password, you'll want to navigate to the top right corner of the screen where you'll find the Account Settings option. Once you click on that, you should see a Reset Password button..."


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

    // Add helpful context for business hours
    if (!Helpers.isBusinessHours() && (response.includes('contact') || response.includes('reach out'))) {
      enhanced += '\n\n*Note: We\'re currently outside regular business hours (8 AM - 6 PM EST). For urgent matters, use the emergency contact protocol.*';
    }

    return enhanced;
  }

  private getFallbackResponse(): string {
    return `I'm having trouble pulling up that information right now. 

For immediate help:
1. Check the agency knowledge base directly
2. Contact your direct supervisor
3. Post in the #support channel for peer assistance

Sorry about that — I'll make sure this gets looked into.`;
  }

  async processQuickCommand(command: string, args: string): Promise<string> {
    const commands: Record<string, (args: string) => Promise<string>> = {
      'commission': async (carrier) => {
        const carrierUpper = carrier.toUpperCase();
        const carrierInfo = CONSTANTS.CARRIERS[carrierUpper as keyof typeof CONSTANTS.CARRIERS];
        
        if (carrierInfo) {
          return `*${carrierInfo.name} Commission Structure:*
• Commission Rate: ${carrierInfo.commission}
• Payment Schedule: ${carrierInfo.payment}
• Advance Available: Yes (management approval required for >$500)
• Chargeback Period: 90 days
• Bonus Eligibility: 20+ policies per month`;
        }
        
        return `Please specify a valid carrier. Available: ${Object.keys(CONSTANTS.CARRIERS).join(', ')}`;
      },
      
      'healthsherpa': async (issue) => {
        return `*HealthSherpa Troubleshooting:*

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
        
        return `*Enrollment Periods for ${currentYear}:*

*Open Enrollment Period (OEP):*
• Dates: November 1, ${currentYear} - January 15, ${currentYear + 1}
• Coverage Start: January 1 (if enrolled by Dec 15)

*Special Enrollment Period (SEP):*
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
