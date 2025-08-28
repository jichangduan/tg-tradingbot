import { Telegraf, Context } from 'telegraf';
import type { Update } from 'telegraf/typings/core/types/typegram';
import { logger } from '../utils/logger';
import { config } from '../config';
import { cacheService } from '../services/cache.service';
import { apiService } from '../services/api.service';
import { registerCommands } from './handlers';

/**
 * 扩展的Telegram Context，添加自定义属性
 */
export interface ExtendedContext extends Context<Update> {
  startTime?: number;
  requestId?: string;
}

/**
 * TGBot主类
 * 负责Bot的初始化、启动、停止和基础功能管理
 */
export class TelegramBot {
  private bot: Telegraf<ExtendedContext>;
  private isRunning: boolean = false;

  constructor() {
    this.bot = new Telegraf<ExtendedContext>(config.telegram.botToken);
    this.setupBot();
  }

  /**
   * 配置Bot的基础设置
   */
  private setupBot(): void {
    // 设置全局中间件
    this.setupMiddleware();
    
    // 注册命令处理器
    registerCommands(this.bot);
    
    // 设置错误处理
    this.setupErrorHandling();
    
    // 设置优雅退出
    this.setupGracefulShutdown();

    logger.info('TGBot setup completed');
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    // 请求ID和时间戳中间件
    this.bot.use(async (ctx, next) => {
      ctx.requestId = this.generateRequestId();
      ctx.startTime = Date.now();
      
      // 记录请求开始
      logger.info(`Request started [${ctx.requestId}]`, {
        requestId: ctx.requestId,
        userId: ctx.from?.id,
        username: ctx.from?.username,
        chatId: ctx.chat?.id,
        messageText: ctx.message && 'text' in ctx.message ? ctx.message.text : undefined
      });

      try {
        await next();
      } finally {
        // 记录请求完成
        const duration = Date.now() - (ctx.startTime || 0);
        logger.info(`Request completed [${ctx.requestId}] - ${duration}ms`, {
          requestId: ctx.requestId,
          duration,
          userId: ctx.from?.id
        });
      }
    });

    // 用户认证和授权中间件（如果需要）
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      const username = ctx.from?.username;
      
      if (!userId) {
        logger.warn('Request without valid user ID', { requestId: ctx.requestId });
        await ctx.reply('❌ 无法识别用户身份，请重新启动对话');
        return;
      }

      // 记录用户活动
      logger.debug('User activity', {
        userId,
        username,
        requestId: ctx.requestId
      });

      await next();
    });

    // 速率限制中间件（简单实现）
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId) {
        await next();
        return;
      }

      // 这里可以实现更复杂的速率限制逻辑
      // 目前只是记录，实际限制可以基于Redis实现
      
      await next();
    });
  }

  /**
   * 设置错误处理
   */
  private setupErrorHandling(): void {
    this.bot.catch(async (err, ctx) => {
      const error = err as Error;
      const requestId = ctx.requestId || 'unknown';
      const duration = Date.now() - (ctx.startTime || Date.now());

      logger.error(`Bot error [${requestId}]`, {
        error: error.message,
        stack: error.stack,
        requestId,
        duration,
        userId: ctx.from?.id,
        username: ctx.from?.username,
        chatId: ctx.chat?.id
      });

      // 发送用户友好的错误消息
      try {
        await ctx.reply('❌ 系统错误，请稍后重试\n\n如果问题持续存在，请联系管理员');
      } catch (replyError) {
        logger.error(`Failed to send error reply [${requestId}]`, {
          error: (replyError as Error).message,
          requestId
        });
      }
    });

    // 处理未捕获的Promise拒绝
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      logger.error('Unhandled Promise Rejection', {
        reason: reason?.toString() || reason,
        stack: reason?.stack,
        promise: promise.toString()
      });
    });

    // 处理未捕获的异常
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught Exception', {
        error: error.message,
        stack: error.stack
      });
      
      // 优雅关闭
      this.stop().finally(() => {
        process.exit(1);
      });
    });
  }

  /**
   * 设置优雅退出
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  /**
   * 生成请求ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 启动Bot
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }

    try {
      // 初始化依赖服务
      await this.initializeServices();

      // 启动Bot
      await this.bot.launch({
        dropPendingUpdates: true // 清除启动前的pending更新
      });

      this.isRunning = true;
      
      // 获取Bot信息
      const botInfo = await this.bot.telegram.getMe();
      
      logger.info('✅ TGBot started successfully', {
        botId: botInfo.id,
        botUsername: botInfo.username,
        botName: botInfo.first_name
      });

      // 发送启动通知给管理员（如果配置了）
      if (config.telegram.adminChatId) {
        try {
          await this.bot.telegram.sendMessage(
            config.telegram.adminChatId,
            `🤖 <b>AIW3 TGBot 已启动</b>\n\n` +
            `⚡ Bot ID: ${botInfo.id}\n` +
            `👤 用户名: @${botInfo.username}\n` +
            `🕐 启动时间: ${new Date().toLocaleString('zh-CN')}\n\n` +
            `✅ 所有系统正常运行`,
            { parse_mode: 'HTML' }
          );
        } catch (notifyError) {
          logger.warn('Failed to send startup notification', {
            error: (notifyError as Error).message
          });
        }
      }

    } catch (error) {
      this.isRunning = false;
      logger.error('❌ Failed to start TGBot', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      throw error;
    }
  }

  /**
   * 初始化依赖服务
   */
  private async initializeServices(): Promise<void> {
    logger.info('Initializing services...');

    // 初始化缓存服务
    try {
      await cacheService.connect();
      logger.info('✅ Cache service initialized');
    } catch (error) {
      logger.warn('⚠️ Cache service initialization failed, running without cache', {
        error: (error as Error).message
      });
      // 缓存服务失败不影响Bot启动，但会影响性能
    }

    // 检查API服务健康状况
    try {
      const apiHealthy = await apiService.healthCheck();
      if (apiHealthy) {
        logger.info('✅ API service is healthy');
      } else {
        logger.warn('⚠️ API service health check failed');
      }
    } catch (error) {
      logger.warn('⚠️ API service health check error', {
        error: (error as Error).message
      });
    }
  }

  /**
   * 停止Bot
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.warn('Bot is not running');
      return;
    }

    logger.info('Stopping TGBot...');

    try {
      // 发送停止通知给管理员
      if (config.telegram.adminChatId) {
        try {
          await this.bot.telegram.sendMessage(
            config.telegram.adminChatId,
            `🛑 <b>AIW3 TGBot 正在关闭</b>\n\n` +
            `🕐 停止时间: ${new Date().toLocaleString('zh-CN')}\n` +
            `💾 正在保存数据和清理资源...`,
            { parse_mode: 'HTML' }
          );
        } catch (notifyError) {
          logger.warn('Failed to send shutdown notification', {
            error: (notifyError as Error).message
          });
        }
      }

      // 停止Bot
      this.bot.stop('SIGINT');
      this.isRunning = false;

      // 关闭依赖服务
      await this.cleanupServices();

      logger.info('✅ TGBot stopped successfully');

    } catch (error) {
      logger.error('❌ Error during TGBot shutdown', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      throw error;
    }
  }

  /**
   * 清理依赖服务
   */
  private async cleanupServices(): Promise<void> {
    logger.info('Cleaning up services...');

    // 断开缓存服务连接
    try {
      await cacheService.disconnect();
      logger.info('✅ Cache service disconnected');
    } catch (error) {
      logger.warn('⚠️ Error disconnecting cache service', {
        error: (error as Error).message
      });
    }

    // API服务不需要显式清理，axios会自动处理
    logger.info('✅ All services cleaned up');
  }

  /**
   * 重启Bot
   */
  public async restart(): Promise<void> {
    logger.info('Restarting TGBot...');
    await this.stop();
    await this.start();
  }

  /**
   * 获取Bot实例（用于特殊情况的直接访问）
   */
  public getBot(): Telegraf<ExtendedContext> {
    return this.bot;
  }

  /**
   * 获取Bot运行状态
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * 获取Bot信息
   */
  public async getBotInfo() {
    try {
      const botInfo = await this.bot.telegram.getMe();
      const services = {
        api: await apiService.healthCheck(),
        cache: await cacheService.healthCheck()
      };

      return {
        bot: {
          id: botInfo.id,
          username: botInfo.username,
          name: botInfo.first_name,
          isRunning: this.isRunning
        },
        services,
        config: {
          env: config.env.nodeEnv,
          cacheTTL: config.cache.tokenPriceTTL,
          apiTimeout: config.api.timeout
        }
      };
    } catch (error) {
      logger.error('Failed to get bot info', { error: (error as Error).message });
      throw error;
    }
  }
}

// 导出单例实例
export const telegramBot = new TelegramBot();

// 默认导出
export default telegramBot;