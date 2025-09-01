import * as cron from 'node-cron';
import { PushSettings, PushData } from './push.service';
import { cacheService } from './cache.service';
import { logger } from '../utils/logger';
import { telegramBot } from '../bot';

/**
 * 推送调度服务
 * 负责定时获取和推送各种类型的推送内容
 */
export class PushSchedulerService {
  private isRunning = false;
  private scheduleTask?: cron.ScheduledTask;
  private readonly cachePrefix = 'push_scheduler';
  private readonly lastPushCacheKey = 'last_push_time';

  /**
   * 启动定时推送调度器
   * 测试环境：每1分钟执行一次
   * 生产环境：每20分钟执行一次
   */
  public start(): void {
    if (this.isRunning) {
      logger.warn('Push scheduler is already running');
      return;
    }

    // 测试环境1分钟，生产环境20分钟
    const cronPattern = process.env.NODE_ENV === 'production' ? '*/20 * * * *' : '* * * * *';
    
    logger.info('Starting push scheduler', {
      cronPattern,
      environment: process.env.NODE_ENV || 'development'
    });

    this.scheduleTask = cron.schedule(cronPattern, async () => {
      await this.executeScheduledPush();
    }, {
      scheduled: false, // 不自动启动
      timezone: 'Asia/Shanghai'
    });

    // 启动任务
    this.scheduleTask.start();
    this.isRunning = true;

    logger.info('Push scheduler started successfully');
  }

  /**
   * 停止定时推送调度器
   */
  public stop(): void {
    if (!this.isRunning) {
      logger.warn('Push scheduler is not running');
      return;
    }

    if (this.scheduleTask) {
      this.scheduleTask.stop();
      this.scheduleTask = undefined;
    }

    this.isRunning = false;
    logger.info('Push scheduler stopped');
  }

  /**
   * 手动执行一次推送任务（用于测试）
   */
  public async executeManualPush(): Promise<void> {
    logger.info('Executing manual push task');
    await this.executeScheduledPush();
  }

  /**
   * 执行定时推送任务
   */
  private async executeScheduledPush(): Promise<void> {
    const startTime = Date.now();
    const executionId = `push_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    try {
      logger.info(`Starting scheduled push execution [${executionId}]`, {
        executionId,
        timestamp: new Date().toISOString()
      });

      // 获取所有启用推送的用户（这里我们暂时使用一个简化的方法）
      const enabledUsers = await this.getEnabledPushUsers();
      
      if (enabledUsers.length === 0) {
        logger.info(`No users with push enabled [${executionId}]`, { executionId });
        return;
      }

      logger.info(`Found ${enabledUsers.length} users with push enabled [${executionId}]`, {
        userCount: enabledUsers.length,
        executionId
      });

      // 为每个用户推送消息
      let successCount = 0;
      let failureCount = 0;

      for (const user of enabledUsers) {
        try {
          await this.sendPushToUser(user.userId, user.settings, user.pushData);
          successCount++;
        } catch (error) {
          failureCount++;
          logger.error(`Failed to send push to user [${executionId}]`, {
            userId: parseInt(user.userId || '0'),
            error: (error as Error).message,
            executionId
          });
        }
      }

      // 更新最后推送时间
      await this.updateLastPushTime();

      const duration = Date.now() - startTime;
      logger.info(`Scheduled push execution completed [${executionId}]`, {
        executionId,
        duration,
        totalUsers: enabledUsers.length,
        successCount,
        failureCount
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Scheduled push execution failed [${executionId}]`, {
        executionId,
        duration,
        error: (error as Error).message,
        stack: (error as Error).stack
      });
    }
  }

  /**
   * 获取启用推送的用户列表
   * 注意：这是一个简化实现，实际应该从数据库或API获取
   */
  private async getEnabledPushUsers(): Promise<Array<{
    userId: string;
    settings: PushSettings;
    pushData?: PushData;
  }>> {
    try {
      // TODO: 实际实现应该调用后端API获取所有启用推送的用户
      // 目前返回空数组，因为我们还没有这个API
      
      // 这里可以添加一些测试用户进行测试
      const testUsers: string[] = []; // 可以添加测试用的telegram ID
      
      const enabledUsers: Array<{
        userId: string;
        settings: PushSettings;
        pushData?: PushData;
      }> = [];
      
      for (const userId of testUsers) {
        try {
          // 由于我们没有后端API获取所有用户，这里暂时跳过
          // 实际实现时需要调用类似 /api/users/push-enabled 的接口
          logger.debug('Processing test user for push', { userId: parseInt(userId || '0') });
        } catch (error) {
          logger.warn('Failed to process user for push', {
            userId: parseInt(userId || '0'),
            error: (error as Error).message
          });
        }
      }

      return enabledUsers;

    } catch (error) {
      logger.error('Failed to get enabled push users', {
        error: (error as Error).message
      });
      return [];
    }
  }

  /**
   * 向用户发送推送消息
   */
  private async sendPushToUser(
    userId: string,
    settings: PushSettings,
    pushData?: PushData
  ): Promise<void> {
    try {
      const bot = telegramBot.getBot();
      
      // 检查是否有新的推送内容
      if (!pushData || !this.hasNewPushContent(pushData)) {
        logger.debug('No new push content for user', { userId: parseInt(userId || '0') });
        return;
      }

      let messages: string[] = [];

      // 处理快讯推送
      if (settings.flash_enabled && pushData.flash_news && pushData.flash_news.length > 0) {
        for (const news of pushData.flash_news) {
          messages.push(this.formatFlashNewsMessage(news));
        }
      }

      // 处理鲸鱼动向推送
      if (settings.whale_enabled && pushData.whale_actions && pushData.whale_actions.length > 0) {
        for (const action of pushData.whale_actions) {
          messages.push(this.formatWhaleActionMessage(action));
        }
      }

      // 处理资金流向推送
      if (settings.fund_enabled && pushData.fund_flows && pushData.fund_flows.length > 0) {
        for (const flow of pushData.fund_flows) {
          messages.push(this.formatFundFlowMessage(flow));
        }
      }

      // 发送消息
      for (const message of messages) {
        await bot.telegram.sendMessage(parseInt(userId), message, {
          parse_mode: 'HTML'
        });

        // 添加短暂延迟避免触发Telegram API限制
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info('Push messages sent to user', {
        userId: parseInt(userId || '0'),
        messageCount: messages.length
      });

    } catch (error) {
      logger.error('Failed to send push message to user', {
        userId: parseInt(userId || '0'),
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * 检查是否有新的推送内容
   */
  private hasNewPushContent(pushData: PushData | undefined): boolean {
    if (!pushData) return false;
    
    // 简化的检查逻辑：只要有任何数据就认为是新的
    // 实际实现中应该检查时间戳或ID来判断是否为新内容
    const hasFlashNews = pushData.flash_news && pushData.flash_news.length > 0;
    const hasWhaleActions = pushData.whale_actions && pushData.whale_actions.length > 0;
    const hasFundFlows = pushData.fund_flows && pushData.fund_flows.length > 0;
    
    return !!(hasFlashNews || hasWhaleActions || hasFundFlows);
  }

  /**
   * 格式化快讯推送消息
   */
  private formatFlashNewsMessage(news: any): string {
    return `🚨 <b>【快讯】</b>\n\n` +
           `📰 ${news.title}\n` +
           `${news.content ? news.content + '\n' : ''}` +
           `⏰ ${this.formatTimestamp(news.timestamp)}`;
  }

  /**
   * 格式化鲸鱼动向推送消息
   */
  private formatWhaleActionMessage(action: any): string {
    return `🐋 <b>【鲸鱼动向】</b>\n\n` +
           `地址: <code>${action.address}</code>\n` +
           `操作: ${action.action}\n` +
           `金额: ${action.amount}\n` +
           `⏰ ${this.formatTimestamp(action.timestamp)}`;
  }

  /**
   * 格式化资金流向推送消息
   */
  private formatFundFlowMessage(flow: any): string {
    return `💰 <b>【资金流向】</b>\n\n` +
           `从: ${flow.from}\n` +
           `到: ${flow.to}\n` +
           `金额: ${flow.amount}\n` +
           `⏰ ${this.formatTimestamp(flow.timestamp)}`;
  }

  /**
   * 格式化时间戳
   */
  private formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return timestamp;
    }
  }

  /**
   * 更新最后推送时间
   */
  private async updateLastPushTime(): Promise<void> {
    try {
      const cacheKey = `${this.cachePrefix}:${this.lastPushCacheKey}`;
      const currentTime = new Date().toISOString();
      
      await cacheService.set(cacheKey, currentTime, 24 * 60 * 60); // 24小时缓存
      
      logger.debug('Updated last push time', { timestamp: currentTime });
    } catch (error) {
      logger.warn('Failed to update last push time', {
        error: (error as Error).message
      });
    }
  }

  /**
   * 获取最后推送时间
   */
  public async getLastPushTime(): Promise<string | null> {
    try {
      const cacheKey = `${this.cachePrefix}:${this.lastPushCacheKey}`;
      const result = await cacheService.get<string>(cacheKey);
      
      if (result.success && result.data) {
        return result.data;
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to get last push time', {
        error: (error as Error).message
      });
      return null;
    }
  }

  /**
   * 获取调度器状态
   */
  public getStatus(): {
    isRunning: boolean;
    cronPattern: string;
    environment: string;
  } {
    const cronPattern = process.env.NODE_ENV === 'production' ? '*/20 * * * *' : '* * * * *';
    
    return {
      isRunning: this.isRunning,
      cronPattern,
      environment: process.env.NODE_ENV || 'development'
    };
  }
}

// 导出单例
export const pushScheduler = new PushSchedulerService();
export default pushScheduler;