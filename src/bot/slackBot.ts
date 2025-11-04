import { App, LogLevel, Block, KnownBlock } from '@slack/bolt';
import { AIAgent } from '../ai/aiAgent';
import { DatabaseQueries } from '../database/queries';
import { logger } from '../utils/logger';
import { Helpers } from '../utils/helpers';
import { CONSTANTS } from '../config/constants';
import { ConversationContext } from '../types';
import { RateLimiterMemory } from 'rate-limiter-flexible';

export class SlackBot {
  private app: App;
  private aiAgent: AIAgent;
  private rateLimiter: RateLimiterMemory;
  private processingMessages: Set<string> = new Set();

  constructor() {
    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      appToken: process.env.SLACK_APP_TOKEN!,
      socketMode: true,
      logLevel: process.env.NODE_ENV === 'production' ? LogLevel.ERROR : LogLevel.INFO,
      customRoutes: [
        {
          path: '/health',
          method: ['GET'],
          handler: (req, res) => {
            res.writeHead(200);
            res.end('OK');
          }
        }
      ]
    });

    this.aiAgent = new AIAgent();
    
    this.rateLimiter = new RateLimiterMemory({
      points: parseInt(process.env.RATE_LIMIT_POINTS || '100'),
      duration: parseInt(process.env.RATE_LIMIT_DURATION || '60')
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Handle direct messages and mentions
    this.app.message(async ({ message, say, client }) => {
      // Type guard
      if (!('text' in message) || !('user' in message)) return;
      if (message.subtype === 'bot_message') return;
      if (!message.text) return;
      
      const messageKey = `${message.channel}-${message.ts}`;
      
      // Prevent duplicate processing
      if (this.processingMessages.has(messageKey)) return;
      this.processingMessages.add(messageKey);

      try {
        // Rate limiting
        await this.rateLimiter.consume(message.user);
        
        // Get user information
        const userInfo = await client.users.info({ user: message.user });
        const userName = userInfo.user?.real_name || userInfo.user?.name || 'Agent';
        
        // Update agent profile
        await DatabaseQueries.updateAgentProfile(
          message.user,
          userName,
          userInfo.user?.profile?.email
        );

        // Get thread_ts if it exists
        const threadTs = 'thread_ts' in message ? message.thread_ts : undefined;

        // Create conversation context
        const conversationId = await DatabaseQueries.getOrCreateConversation(
          message.user,
          userName,
          message.channel,
          threadTs
        );

        const context: ConversationContext = {
          conversationId,
          userId: message.user,
          userName,
          channelId: message.channel,
          threadTs: threadTs,
          history: []
        };

        // Log user message
        await DatabaseQueries.addMessage(
          conversationId,
          'user',
          message.text
        );

        // Show typing indicator
        const typingMessage = await this.showTypingIndicator(client, message.channel, threadTs || message.ts);

        // Generate AI response
        const startTime = Date.now();
        const aiResponse = await this.aiAgent.generateResponse(message.text, context);
        
        // Add natural delay
        const delay = Helpers.getRandomDelay();
        await Helpers.sleep(Math.max(0, delay - (Date.now() - startTime)));

        // Delete typing indicator
        if (typingMessage) {
          await this.removeTypingIndicator(client, message.channel, typingMessage.ts);
        }

        // Send response
        const sentMessage = await say({
          text: aiResponse.response,
          thread_ts: threadTs || message.ts,
          blocks: this.formatResponseBlocks(aiResponse.response, aiResponse.confidence)
        });

        // Log bot response
        const messageId = await DatabaseQueries.addMessage(
          conversationId,
          'bot',
          aiResponse.response,
          aiResponse.confidence,
          aiResponse.responseTimeMs
        );

        // Handle escalation if needed
        if (aiResponse.shouldEscalate) {
          await this.handleEscalation(
            context,
            message.text,
            aiResponse
          );
        }

        // Add feedback buttons for learning
        if (process.env.ENABLE_FEEDBACK_COLLECTION === 'true' && sentMessage.ts) {
          await this.addFeedbackButtons(client, message.channel, sentMessage.ts, messageId);
        }

      } catch (error: any) {
        const threadTs = 'thread_ts' in message ? message.thread_ts : undefined;
        if (error?.remainingPoints !== undefined) {
          await say({
            text: "⚠️ You're sending messages too quickly. Please wait a moment before trying again.",
            thread_ts: threadTs || message.ts
          });
        } else {
          logger.error('Error handling message:', error);
          await say({
            text: this.getErrorResponse(),
            thread_ts: threadTs || message.ts
          });
        }
      } finally {
        this.processingMessages.delete(messageKey);
      }
    });

    // Handle app mentions
    this.app.event('app_mention', async ({ event, say, client }) => {
      try {
        const cleanText = Helpers.removeMentions(event.text);
        
        // Get user info
        const userInfo = await client.users.info({ user: event.user });
        const userName = userInfo.user?.real_name || 'Agent';
        
        const threadTs = 'thread_ts' in event ? event.thread_ts : undefined;
        
        // Create context
        const conversationId = await DatabaseQueries.getOrCreateConversation(
          event.user,
          userName,
          event.channel,
          threadTs
        );

        const context: ConversationContext = {
          conversationId,
          userId: event.user,
          userName,
          channelId: event.channel,
          threadTs: threadTs,
          history: []
        };

        // Generate and send response
        const aiResponse = await this.aiAgent.generateResponse(cleanText, context);
        
        await say({
          text: aiResponse.response,
          thread_ts: threadTs || event.ts,
          blocks: this.formatResponseBlocks(aiResponse.response, aiResponse.confidence)
        });
        
      } catch (error) {
        logger.error('Error handling app mention:', error);
        const threadTs = 'thread_ts' in event ? event.thread_ts : undefined;
        await say({
          text: this.getErrorResponse(),
          thread_ts: threadTs || event.ts
        });
      }
    });

    // Slash commands
    this.setupSlashCommands();
    
    // Interactive components (buttons, selects, etc.)
    this.setupInteractiveComponents();
  }

  private setupSlashCommands() {
    // Commission lookup command
    this.app.command('/commission', async ({ command, ack, respond }) => {
      await ack();
      
      const response = await this.aiAgent.processQuickCommand('commission', command.text);
      await respond({
        response_type: 'ephemeral',
        text: response
      });
    });

    // HealthSherpa help command
    this.app.command('/healthsherpa', async ({ command, ack, respond }) => {
      await ack();
      
      const response = await this.aiAgent.processQuickCommand('healthsherpa', command.text);
      await respond({
        response_type: 'ephemeral',
        text: response
      });
    });

    // Enrollment info command
    this.app.command('/enrollment', async ({ command, ack, respond }) => {
      await ack();
      
      const response = await this.aiAgent.processQuickCommand('enrollment', command.text);
      await respond({
        response_type: 'ephemeral',
        text: response
      });
    });

    // Support feedback command
    this.app.command('/support-feedback', async ({ command, ack, respond }) => {
      await ack();
      
      await DatabaseQueries.saveFeedback(
        '', // No specific message
        command.user_id,
        undefined,
        command.text,
        undefined
      );
      
      await respond({
        response_type: 'ephemeral',
        text: '✅ Thank you for your feedback! We continuously improve based on your input.'
      });
    });

    // System status command (admin only)
    this.app.command('/support-status', async ({ command, ack, respond, client }) => {
      await ack();
      
      // Check if user is admin
      const userInfo = await client.users.info({ user: command.user_id });
      if (!userInfo.user?.is_admin && !userInfo.user?.is_owner) {
        await respond({
          response_type: 'ephemeral',
          text: '❌ This command is restricted to administrators.'
        });
        return;
      }

      const metrics = await DatabaseQueries.getSystemMetrics(7);
      
      await respond({
        response_type: 'ephemeral',
        text: `**System Status (Last 7 Days)**
• Active Users: ${metrics.unique_users}
• Total Conversations: ${metrics.total_conversations}
• Messages Processed: ${metrics.total_messages}
• Average Confidence: ${(metrics.avg_confidence * 100).toFixed(1)}%
• Escalations: ${metrics.escalations}
• Avg Response Time: ${Math.round(metrics.avg_response_time)}ms`
      });
    });
  }

  private setupInteractiveComponents() {
    // Handle feedback buttons
    this.app.action('feedback_helpful', async ({ action, ack, client, body }) => {
      await ack();
      
      if (!('value' in action) || !action.value) return;
      if (!('message' in body) || !body.message) return;
      if (!body.channel || !('id' in body.channel)) return;
      
      await DatabaseQueries.saveFeedback(
        action.value,
        body.user.id,
        undefined,
        undefined,
        true
      );

      const message = body.message as any;
      await client.chat.update({
        channel: body.channel.id,
        ts: message.ts,
        text: message.text || '',
        blocks: [
          ...(message.blocks || []).slice(0, -1),
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '_✅ Thanks for your feedback!_'
            }
          }
        ]
      });
    });

    this.app.action('feedback_not_helpful', async ({ action, ack, client, body }) => {
      await ack();
      
      if (!('value' in action) || !action.value) return;
      if (!('message' in body) || !body.message) return;
      if (!body.channel || !('id' in body.channel)) return;
      
      await DatabaseQueries.saveFeedback(
        action.value,
        body.user.id,
        undefined,
        undefined,
        false
      );

      // Create escalation for review
      const conversationId = action.value.split(':')[0];
      await DatabaseQueries.createEscalation(
        conversationId,
        'Negative feedback received',
        3
      );

      const message = body.message as any;
      await client.chat.update({
        channel: body.channel.id,
        ts: message.ts,
        text: message.text || '',
        blocks: [
          ...(message.blocks || []).slice(0, -1),
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '_Thanks for your feedback. A team member will review this conversation._'
            }
          }
        ]
      });
    });
  }

  private async showTypingIndicator(
    client: any,
    channel: string,
    thread_ts: string
  ): Promise<any> {
    try {
      const thinkingMessage = CONSTANTS.THINKING_MESSAGES[
        Math.floor(Math.random() * CONSTANTS.THINKING_MESSAGES.length)
      ];
      
      return await client.chat.postMessage({
        channel,
        text: thinkingMessage,
        thread_ts
      });
    } catch (error) {
      logger.error('Error showing typing indicator:', error);
      return null;
    }
  }

  private async removeTypingIndicator(
    client: any,
    channel: string,
    ts: string
  ): Promise<void> {
    try {
      await client.chat.delete({
        channel,
        ts
      });
    } catch (error) {
      // Silently ignore - message might already be gone
    }
  }

  private formatResponseBlocks(response: string, confidence: number): (Block | KnownBlock)[] {
    const blocks: (Block | KnownBlock)[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: response
        }
      }
    ];

    // Add confidence indicator if low
    if (confidence < 0.7) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_Confidence: ${(confidence * 100).toFixed(0)}%_`
          }
        ]
      });
    }

    return blocks;
  }

  private async addFeedbackButtons(
    client: any,
    channel: string,
    ts: string,
    messageId: string
  ): Promise<void> {
    try {
      await Helpers.sleep(2000); // Wait before adding feedback buttons
      
      const message = await client.conversations.history({
        channel,
        latest: ts,
        limit: 1,
        inclusive: true
      });

      if (message.messages && message.messages.length > 0) {
        const originalMessage = message.messages[0];
        
        await client.chat.update({
          channel,
          ts,
          text: originalMessage.text || '',
          blocks: [
            ...(originalMessage.blocks || []),
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '👍 Helpful'
                  },
                  style: 'primary',
                  action_id: 'feedback_helpful',
                  value: messageId
                },
                {
                  type: 'button',
                  text: {
                    type: 'plain_text',
                    text: '👎 Not Helpful'
                  },
                  action_id: 'feedback_not_helpful',
                  value: messageId
                }
              ]
            }
          ]
        });
      }
    } catch (error) {
      logger.error('Error adding feedback buttons:', error);
    }
  }

  private async handleEscalation(
    context: ConversationContext,
    originalMessage: string,
    aiResponse: any
  ): Promise<void> {
    try {
      // Create escalation record
      await DatabaseQueries.createEscalation(
        context.conversationId,
        aiResponse.escalationReason || 'Automatic escalation',
        aiResponse.escalationReason?.includes('legal') ? 1 : 5
      );

      // Notify management channel
      const managementChannel = process.env.MANAGEMENT_CHANNEL_ID;
      if (!managementChannel) return;

      await this.app.client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN!,
        channel: managementChannel,
        text: '🚨 Support Escalation Required',
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '🚨 Support Escalation Required'
            }
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Agent:*\n<@${context.userId}>`
              },
              {
                type: 'mrkdwn',
                text: `*Channel:*\n<#${context.channelId}>`
              },
              {
                type: 'mrkdwn',
                text: `*Reason:*\n${aiResponse.escalationReason || 'Low confidence response'}`
              },
              {
                type: 'mrkdwn',
                text: `*Confidence:*\n${(aiResponse.confidence * 100).toFixed(0)}%`
              }
            ]
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Original Query:*\n${Helpers.truncateString(originalMessage, 500)}`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*AI Response:*\n${Helpers.truncateString(aiResponse.response, 500)}`
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'View Thread'
                },
                style: 'primary',
                url: `slack://channel?id=${context.channelId}&thread_ts=${context.threadTs || ''}&team=${process.env.SLACK_TEAM_ID}`
              },
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Take Over'
                },
                style: 'danger',
                action_id: 'take_over_conversation',
                value: context.conversationId
              }
            ]
          }
        ]
      });

      logger.info('Escalation created', {
        conversationId: context.conversationId,
        userId: context.userId,
        reason: aiResponse.escalationReason
      });

    } catch (error) {
      logger.error('Error handling escalation:', error);
    }
  }

  private getErrorResponse(): string {
    return `I apologize, but I'm experiencing technical difficulties right now.

**What you can do:**
• Try rephrasing your question
• Use one of our quick commands (/commission, /healthsherpa, /enrollment)
• Contact your supervisor directly for urgent matters
• Check the #support channel for similar issues

This error has been logged and our team will investigate.`;
  }

  async start(): Promise<void> {
    await this.app.start();
    logger.info('⚡️ ACA Support System is running!');
    
    // Send startup notification to management
    if (process.env.MANAGEMENT_CHANNEL_ID) {
      await this.app.client.chat.postMessage({
        token: process.env.SLACK_BOT_TOKEN!,
        channel: process.env.MANAGEMENT_CHANNEL_ID,
        text: `✅ ACA Support System started successfully at ${Helpers.formatTimestamp(new Date())}`
      });
    }
  }

  async stop(): Promise<void> {
    await this.app.stop();
    logger.info('ACA Support System stopped');
  }
}
