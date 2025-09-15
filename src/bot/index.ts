import { Telegraf, Context } from 'telegraf';
import type { Update } from 'telegraf/typings/core/types/typegram';
import { logger } from '../utils/logger';
import { config } from '../config';
import { cacheService } from '../services/cache.service';
import { apiService } from '../services/api.service';
import { registerCommands } from './handlers';
import { groupAutoBindingService } from '../services/group-auto-binding.service';

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
    
    // 设置群组事件监听
    this.setupGroupEventHandlers();
    
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

    // 群组命令拦截中间件 - 处理需要跳转到私聊的命令
    this.bot.use(async (ctx, next) => {
      const isGroup = ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup';
      const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      const requestId = ctx.requestId || 'unknown';
      const userId = ctx.from?.id;
      const chatId = ctx.chat?.id;
      
      // 详细记录群组命令检测情况
      if (messageText?.startsWith('/')) {
        logger.info(`Command detected [${requestId}]`, {
          command: messageText,
          isGroup,
          chatType: ctx.chat?.type,
          chatId,
          userId,
          requestId
        });
      }
      
      if (isGroup && messageText?.startsWith('/')) {
        const parts = messageText.trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);
        
        // 需要跳转到私聊的命令列表（保持公共命令在群组正常执行）
        const redirectCommands = ['/start', '/long', '/short', '/close', '/positions', '/wallet', '/pnl', '/push'];
        
        if (redirectCommands.includes(command)) {
          logger.warn(`SENSITIVE COMMAND IN GROUP DETECTED [${requestId}]`, {
            command,
            args,
            chatId,
            userId,
            chatType: ctx.chat?.type,
            isRedirectRequired: true,
            requestId
          });
          
          try {
            // 动态导入处理函数避免循环依赖
            const { handleGroupCommandRedirect } = await import('./handlers/group-redirect.handler');
            await handleGroupCommandRedirect(ctx, command, args);
            
            logger.info(`Group redirect successful [${requestId}]`, {
              command,
              userId,
              requestId
            });
            
            return; // 停止继续处理，不执行命令
            
          } catch (importError) {
            logger.error(`CRITICAL: Group redirect handler failed [${requestId}]`, {
              error: (importError as Error).message,
              stack: (importError as Error).stack,
              command,
              userId,
              chatId,
              requestId
            });
            
            // 如果导入失败，发送强制重定向消息，绝不允许在群组执行敏感命令
            try {
              const botUsername = config.telegram.botUsername || 'yuze_trading_bot';
              const fallbackMessage = 
                `🔒 <b>Private ${command.replace('/', '').toUpperCase()} Required</b>\n\n` +
                `pvp.trade\n` +
                `This command contains sensitive information and must be used in private chat.\n\n` +
                `👉 Click here to continue: https://t.me/${botUsername}\n\n` +
                `⚠️ <i>For security reasons, wallet and trading commands are not available in groups.</i>`;
              
              await ctx.reply(fallbackMessage, { parse_mode: 'HTML' });
              
              logger.info(`Fallback redirect message sent [${requestId}]`, {
                command,
                userId,
                requestId
              });
              
            } catch (fallbackError) {
              logger.error(`CRITICAL: Fallback redirect also failed [${requestId}]`, {
                error: (fallbackError as Error).message,
                command,
                userId,
                requestId
              });
            }
            
            // 无论如何都要阻止命令继续执行
            return;
          }
        }
      }
      
      // 只有非敏感命令或私聊命令才能继续执行
      await next();
    });

    // 群组自动绑定中间件
    this.bot.use(async (ctx, next) => {
      // 先执行命令，不阻塞用户体验
      await next();
      
      // 异步处理群组自动绑定
      // 只在群组环境下且命令成功执行后尝试绑定
      if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
        // 异步执行绑定逻辑，不等待结果，不影响用户体验
        groupAutoBindingService.tryAutoBindGroup(ctx).catch(error => {
          // 绑定失败不影响正常功能，只记录调试日志
          logger.debug('群组自动绑定失败（不影响正常使用）', {
            userId: ctx.from?.id,
            chatId: ctx.chat?.id,
            error: error.message,
            requestId: ctx.requestId
          });
        });
      }
    });
  }

  /**
   * 设置群组事件处理器
   */
  private setupGroupEventHandlers(): void {
    // 监听机器人被添加或移除的事件
    this.bot.on('my_chat_member', async (ctx) => {
      try {
        const chatMember = ctx.myChatMember;
        const chat = ctx.chat;
        const requestId = ctx.requestId || 'unknown';
        
        // 只处理群组和超级群组
        if (chat.type !== 'group' && chat.type !== 'supergroup') {
          return;
        }
        
        const chatId = chat.id.toString();
        const oldStatus = chatMember.old_chat_member.status;
        const newStatus = chatMember.new_chat_member.status;
        
        logger.info(`[${requestId}] Bot chat member status changed`, {
          chatId,
          chatType: chat.type,
          chatTitle: chat.title,
          oldStatus,
          newStatus,
          requestId
        });
        
        // 动态导入pushScheduler以避免循环依赖
        const { pushScheduler } = await import('../services/push-scheduler.service');
        
        // 机器人被添加到群组
        if ((oldStatus === 'left' || oldStatus === 'kicked') && 
            (newStatus === 'member' || newStatus === 'administrator')) {
          
          logger.info(`[${requestId}] Bot added to group`, {
            chatId,
            chatTitle: chat.title,
            requestId
          });
          
          // 添加群组到推送跟踪
          pushScheduler.addBotGroup(chatId);
          
          // 可选：发送欢迎消息
          try {
            await ctx.reply(
              '👋 <b>AIW3 Trading Bot 已加入群组！</b>\n\n' +
              '🔔 群组推送将根据群主的个人推送设置进行推送\n' +
              '⚙️ 群主可以通过私聊机器人使用 /push 命令调整推送设置\n\n' +
              '💡 发送 /help 查看所有可用命令',
              { parse_mode: 'HTML' }
            );
          } catch (welcomeError) {
            logger.warn(`[${requestId}] Failed to send welcome message to group`, {
              chatId,
              error: (welcomeError as Error).message,
              requestId
            });
          }
        }
        
        // 机器人被移除出群组
        else if ((oldStatus === 'member' || oldStatus === 'administrator') && 
                 (newStatus === 'left' || newStatus === 'kicked')) {
          
          logger.info(`[${requestId}] Bot removed from group`, {
            chatId,
            chatTitle: chat.title,
            requestId
          });
          
          // 从推送跟踪中移除群组
          pushScheduler.removeBotGroup(chatId);
        }
        
      } catch (error) {
        logger.error('Error handling group member change', {
          error: (error as Error).message,
          stack: (error as Error).stack,
          requestId: ctx.requestId
        });
      }
    });
    
    logger.debug('Group event handlers setup completed');
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
      logger.info('🔧 Starting Bot initialization process...');
      
      // 初始化依赖服务
      logger.info('📋 Step 1: Initializing dependency services...');
      await this.initializeServices();
      logger.info('✅ Step 1 completed: All services initialized');

      // 启动Bot
      logger.info('🚀 Step 2: Launching Telegram Bot connection...');
      logger.debug('Bot launch configuration', {
        dropPendingUpdates: true,
        botToken: config.telegram.botToken.substring(0, 10) + '...'
      });
      
      await this.bot.launch({
        dropPendingUpdates: true // 清除启动前的pending更新
      });
      logger.info('✅ Step 2 completed: Bot launched successfully');

      this.isRunning = true;
      logger.info('🔄 Bot status updated to running');
      
      // 获取Bot信息
      logger.info('📡 Step 3: Retrieving Bot information from Telegram...');
      const botInfo = await this.bot.telegram.getMe();
      logger.info('✅ Step 3 completed: Bot information retrieved');
      
      logger.info('🎉 TGBot started successfully', {
        botId: botInfo.id,
        botUsername: botInfo.username,
        botName: botInfo.first_name,
        canJoinGroups: botInfo.can_join_groups,
        canReadAllGroupMessages: botInfo.can_read_all_group_messages
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
      const err = error as Error;
      
      logger.error('💥 CRITICAL: TGBot startup failed', {
        error: err.message,
        stack: err.stack,
        name: err.name,
        cause: (err as any).cause,
        code: (err as any).code
      });

      // 详细分析失败原因
      if (err.message.includes('401')) {
        logger.error('🔐 Authentication Error: Invalid TELEGRAM_BOT_TOKEN', {
          tokenPrefix: config.telegram.botToken.substring(0, 10),
          suggestion: 'Please check if the bot token is valid and active'
        });
      } else if (err.message.includes('network') || err.message.includes('ENOTFOUND')) {
        logger.error('🌐 Network Error: Cannot connect to Telegram servers', {
          suggestion: 'Please check network connectivity and DNS resolution'
        });
      } else if (err.message.includes('timeout')) {
        logger.error('⏰ Timeout Error: Connection to Telegram timed out', {
          suggestion: 'Network may be slow or Telegram services may be down'
        });
      } else {
        logger.error('❓ Unknown Error during Bot startup', {
          errorDetails: JSON.stringify(err, Object.getOwnPropertyNames(err))
        });
      }
      
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
    // Return true if bot is set up (more reliable than launch status)
    return !!this.bot;
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