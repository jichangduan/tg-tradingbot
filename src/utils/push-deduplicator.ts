import { cacheService } from '../services/cache.service';
import { logger } from './logger';

/**
 * 推送去重工具
 * 防止重复推送相同的内容给用户
 */
export class PushDeduplicator {
  private readonly cachePrefix = 'push_dedup';
  private readonly defaultTtl = 60 * 60; // 1小时TTL，防止同一小时内重复推送

  /**
   * 生成内容的唯一标识
   * @param content 推送内容数据
   * @returns 内容的哈希值
   */
  private generateContentHash(content: any): string {
    try {
      // 创建内容的简化版本用于去重
      const normalized = {
        type: content.type || 'unknown',
        // 对于快讯：标题+时间戳前缀
        title: content.title?.substring(0, 50),
        // 对于鲸鱼：地址+操作+金额前缀  
        address: content.address?.substring(0, 20),
        action: content.action?.substring(0, 20),
        amount: content.amount?.substring(0, 20),
        // 对于资金流：消息内容前缀
        message: content.message?.substring(0, 50),
        symbol: content.symbol,
        // 时间戳取到分钟级别
        timePrefix: content.timestamp?.substring(0, 16)
      };

      const contentStr = JSON.stringify(normalized);
      
      // 简单哈希算法
      let hash = 0;
      for (let i = 0; i < contentStr.length; i++) {
        const char = contentStr.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 转换为32位整数
      }
      
      return Math.abs(hash).toString(36);
    } catch (error) {
      logger.warn('Failed to generate content hash', { 
        errorMessage: (error as Error).message,
        content: typeof content === 'object' ? Object.keys(content) : content
      });
      return `fallback_${Date.now()}`;
    }
  }

  /**
   * 检查内容是否已经推送过
   * @param userId 用户ID
   * @param content 推送内容
   * @param contentType 内容类型
   * @returns 是否为重复内容
   */
  public async isDuplicate(
    userId: string, 
    content: any, 
    contentType: string
  ): Promise<boolean> {
    try {
      const contentHash = this.generateContentHash({
        ...content,
        type: contentType
      });
      
      const cacheKey = `${this.cachePrefix}:${userId}:${contentType}:${contentHash}`;
      
      const result = await cacheService.get(cacheKey);
      
      const isDup = result.success && !!result.data;
      
      if (isDup) {
        logger.debug('Duplicate content detected', {
          telegramId: parseInt(userId),
          contentType,
          contentHash,
          cacheKey
        });
      }
      
      return isDup;
    } catch (error) {
      logger.warn('Failed to check for duplicate content', {
        telegramId: parseInt(userId),
        contentType,
        errorMessage: (error as Error).message
      });
      return false; // 出错时不阻止推送
    }
  }

  /**
   * 标记内容为已推送
   * @param userId 用户ID
   * @param content 推送内容
   * @param contentType 内容类型
   */
  public async markAsPushed(
    userId: string, 
    content: any, 
    contentType: string
  ): Promise<void> {
    try {
      const contentHash = this.generateContentHash({
        ...content,
        type: contentType
      });
      
      const cacheKey = `${this.cachePrefix}:${userId}:${contentType}:${contentHash}`;
      
      await cacheService.set(cacheKey, {
        pushedAt: new Date().toISOString(),
        contentType,
        contentHash
      }, this.defaultTtl);
      
      logger.debug('Content marked as pushed', {
        telegramId: parseInt(userId),
        contentType,
        contentHash,
        cacheKey,
        ttlSeconds: this.defaultTtl
      });
    } catch (error) {
      logger.warn('Failed to mark content as pushed', {
        telegramId: parseInt(userId),
        contentType,
        errorMessage: (error as Error).message
      });
    }
  }

  /**
   * 批量过滤重复内容
   * @param userId 用户ID
   * @param items 待检查的内容数组
   * @param contentType 内容类型
   * @returns 过滤后的非重复内容数组
   */
  public async filterDuplicates<T>(
    userId: string,
    items: T[],
    contentType: string
  ): Promise<T[]> {
    if (!items || items.length === 0) {
      return [];
    }

    try {
      const filteredItems: T[] = [];
      
      for (const item of items) {
        const isDup = await this.isDuplicate(userId, item, contentType);
        if (!isDup) {
          filteredItems.push(item);
        }
      }

      logger.info('Content deduplication completed', {
        telegramId: parseInt(userId),
        contentType,
        originalCount: items.length,
        filteredCount: filteredItems.length,
        duplicatesRemoved: items.length - filteredItems.length
      });

      return filteredItems;
    } catch (error) {
      logger.error('Failed to filter duplicates', {
        telegramId: parseInt(userId),
        contentType,
        errorMessage: (error as Error).message,
        itemCount: items.length
      });
      return items; // 出错时返回原数组，不影响推送
    }
  }

  /**
   * 批量标记内容为已推送
   * @param userId 用户ID
   * @param items 已推送的内容数组
   * @param contentType 内容类型
   */
  public async markBatchAsPushed<T>(
    userId: string,
    items: T[],
    contentType: string
  ): Promise<void> {
    if (!items || items.length === 0) {
      return;
    }

    try {
      const markPromises = items.map(item => 
        this.markAsPushed(userId, item, contentType)
      );
      
      await Promise.all(markPromises);
      
      logger.debug('Batch marked as pushed', {
        telegramId: parseInt(userId),
        contentType,
        itemCount: items.length
      });
    } catch (error) {
      logger.warn('Failed to mark batch as pushed', {
        telegramId: parseInt(userId),
        contentType,
        itemCount: items.length,
        errorMessage: (error as Error).message
      });
    }
  }

  /**
   * 清除用户的去重缓存（调试用）
   * @param userId 用户ID
   * @param contentType 内容类型（可选，不提供则清除所有类型）
   */
  public async clearUserCache(
    userId: string, 
    contentType?: string
  ): Promise<void> {
    try {
      const pattern = contentType 
        ? `${this.cachePrefix}:${userId}:${contentType}:*`
        : `${this.cachePrefix}:${userId}:*`;
      
      const keys = await cacheService.getKeys(pattern);
      
      if (keys.length > 0) {
        await Promise.all(keys.map(key => cacheService.delete(key)));
        logger.info('User deduplication cache cleared', {
          telegramId: parseInt(userId),
          contentType,
          clearedKeysCount: keys.length
        });
      }
    } catch (error) {
      logger.warn('Failed to clear user deduplication cache', {
        telegramId: parseInt(userId),
        contentType,
        errorMessage: (error as Error).message
      });
    }
  }
}

// 导出单例
export const pushDeduplicator = new PushDeduplicator();
export default pushDeduplicator;