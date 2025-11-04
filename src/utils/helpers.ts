import crypto from 'crypto';
import moment from 'moment-timezone';

export class Helpers {
  static generateId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  static async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static getRandomDelay(): number {
    const min = parseInt(process.env.RESPONSE_DELAY_MIN || '500');
    const max = parseInt(process.env.RESPONSE_DELAY_MAX || '2000');
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  static truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  static formatTimestamp(date: Date, timezone: string = 'America/New_York'): string {
    return moment(date).tz(timezone).format('MMM DD, YYYY h:mm A z');
  }

  static extractMentions(text: string): string[] {
    const mentionRegex = /<@([A-Z0-9]+)>/g;
    const mentions: string[] = [];
    let match;
    
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }
    
    return mentions;
  }

  static removeMentions(text: string): string {
    return text.replace(/<@[A-Z0-9]+>/g, '').trim();
  }

  static isBusinessHours(): boolean {
    const now = moment().tz('America/New_York');
    const hour = now.hour();
    const day = now.day();
    
    // Monday-Friday, 8 AM - 6 PM EST
    return day >= 1 && day <= 5 && hour >= 8 && hour < 18;
  }

  static sanitizeForSlack(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  static parseSlackTimestamp(ts: string): Date {
    const timestamp = parseFloat(ts);
    return new Date(timestamp * 1000);
  }
}
