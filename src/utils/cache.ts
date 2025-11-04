import NodeCache from 'node-cache';
import { logger } from './logger';

class CacheManager {
  private cache: NodeCache;
  private enabled: boolean;

  constructor() {
    this.enabled = process.env.ENABLE_CACHE === 'true';
    this.cache = new NodeCache({
      stdTTL: parseInt(process.env.CACHE_TTL || '3600'),
      checkperiod: parseInt(process.env.CACHE_CHECK_PERIOD || '600'),
      useClones: false
    });

    this.cache.on('set', (key) => {
      logger.debug(`Cache SET: ${key}`);
    });

    this.cache.on('expired', (key) => {
      logger.debug(`Cache EXPIRED: ${key}`);
    });
  }

  get<T>(key: string): T | undefined {
    if (!this.enabled) return undefined;
    
    const value = this.cache.get<T>(key);
    if (value) {
      logger.debug(`Cache HIT: ${key}`);
    } else {
      logger.debug(`Cache MISS: ${key}`);
    }
    return value;
  }

  set<T>(key: string, value: T, ttl?: number): boolean {
    if (!this.enabled) return false;
    return this.cache.set(key, value, ttl || 0);
  }

  del(key: string): number {
    if (!this.enabled) return 0;
    return this.cache.del(key);
  }

  flush(): void {
    this.cache.flushAll();
    logger.info('Cache flushed');
  }

  getStats() {
    return this.cache.getStats();
  }
}

export const cacheManager = new CacheManager();
