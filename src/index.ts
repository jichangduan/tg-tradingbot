import { telegramBot } from './bot';
import { setBotCommands } from './bot/handlers';
import { logger } from './utils/logger';
import { config } from './config';

/**
 * AIW3 TGBot 应用入口
 * 负责启动和管理整个Bot应用
 */

/**
 * 应用启动函数
 */
async function startApplication(): Promise<void> {
  logger.info('🚀 Starting AIW3 TGBot Application...');
  
  try {
    // 记录启动配置
    logger.info('Application configuration:', {
      nodeEnv: config.env.nodeEnv,
      apiBaseUrl: config.api.baseUrl,
      redisHost: config.redis.host,
      redisPort: config.redis.port,
      logLevel: config.logging.level,
      cacheTTL: config.cache.tokenPriceTTL
    });

    // 启动TGBot
    logger.info('Initializing Telegram Bot...');
    await telegramBot.start();

    // 设置Bot命令菜单
    logger.info('Setting up bot commands menu...');
    await setBotCommands(telegramBot.getBot());

    // 获取Bot信息并记录
    const botInfo = await telegramBot.getBotInfo();
    logger.info('✅ AIW3 TGBot Application started successfully', {
      botId: botInfo.bot.id,
      botUsername: botInfo.bot.username,
      isRunning: botInfo.bot.isRunning,
      services: botInfo.services,
      config: botInfo.config
    });

    // 在生产环境中记录重要的启动信息
    if (config.env.isProduction) {
      logger.info('🌟 Production deployment successful', {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: config.env.nodeEnv,
        features: [
          'Price queries with /price command',
          'Real-time cryptocurrency data',
          'Redis caching for performance',
          'Comprehensive error handling',
          'Structured logging'
        ]
      });
    }
    // 健康检查服务由 main() 提前启动，避免外部依赖阻塞时无响应

  } catch (error) {
    logger.error('❌ Failed to start AIW3 TGBot Application', {
      error: (error as Error).message,
      stack: (error as Error).stack
    });
    
    // 确保清理资源
    try {
      await telegramBot.stop();
    } catch (cleanupError) {
      logger.error('Error during cleanup', {
        error: (cleanupError as Error).message
      });
    }
    
    process.exit(1);
  }
}

/**
 * 应用关闭函数
 */
async function stopApplication(): Promise<void> {
  logger.info('🛑 Stopping AIW3 TGBot Application...');
  
  try {
    await telegramBot.stop();
    logger.info('✅ AIW3 TGBot Application stopped gracefully');
  } catch (error) {
    logger.error('❌ Error stopping application', {
      error: (error as Error).message
    });
  }
}

/**
 * 设置健康检查服务器（可选）
 */
function setupHealthCheckServer(): void {
  if (!config.app.port) return;

  const express = require('express');
  const app = express();

  // 健康检查端点
  app.get('/health', async (req: any, res: any) => {
    try {
      // 尝试获取Bot信息，失败时返回降级状态
      const isRunning = telegramBot.isActive();
      let bot: any = { isRunning };
      let services: any = undefined;
      try {
        const botInfo = await telegramBot.getBotInfo();
        bot = botInfo.bot;
        services = botInfo.services;
      } catch (_) {
        // ignore, keep minimal info
      }

      const status = isRunning ? 'healthy' : 'degraded';
      res.status(isRunning ? 200 : 503).json({
        status,
        timestamp: new Date().toISOString(),
        bot,
        services,
        uptime: process.uptime()
      });
    } catch (error) {
      res.status(500).json({
        status: 'unavailable',
        timestamp: new Date().toISOString(),
        error: (error as Error).message,
        uptime: process.uptime()
      });
    }
  });

  // 基础信息端点
  app.get('/', (req: any, res: any) => {
    res.json({
      name: 'AIW3 TGBot',
      version: '1.0.0',
      description: 'Telegram Bot for AIW3 cryptocurrency price queries',
      status: telegramBot.isActive() ? 'running' : 'stopped',
      endpoints: [
        'GET /health - Health check',
        'GET / - Basic information'
      ]
    });
  });

  const server = app.listen(config.app.port, () => {
    logger.info(`Health check server started on port ${config.app.port}`);
  });

  // 优雅关闭健康检查服务器
  const originalStop = stopApplication;
  module.exports.stopApplication = async function() {
    server.close();
    await originalStop();
  };
}

/**
 * 处理未捕获的异常和拒绝
 */
function setupGlobalErrorHandlers(): void {
  // 处理未捕获的Promise拒绝
  process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
    logger.error('Unhandled Promise Rejection at:', {
      promise: promise.toString(),
      reason: reason?.toString() || reason,
      stack: reason?.stack
    });
    
    // 在生产环境中，可以考虑重启应用
    if (config.env.isProduction) {
      logger.error('Critical error in production, shutting down...');
      stopApplication().finally(() => process.exit(1));
    }
  });

  // 处理未捕获的异常
  process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught Exception:', {
      error: error.message,
      stack: error.stack
    });
    
    // 立即停止应用
    stopApplication().finally(() => process.exit(1));
  });

  // 处理优雅退出信号
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await stopApplication();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await stopApplication();
    process.exit(0);
  });
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  // 设置全局错误处理
  setupGlobalErrorHandlers();
  
  // 提前启动健康检查服务，确保即使外部依赖不可用也能响应
  if (config.app.enableHealth && config.app.port) {
    setupHealthCheckServer();
  }
  
  // 验证配置
  try {
    logger.info('Validating configuration...');
    // config模块在加载时已经验证了配置
    logger.info('✅ Configuration validation passed');
  } catch (configError) {
    logger.error('❌ Configuration validation failed', {
      error: (configError as Error).message
    });
    process.exit(1);
  }
  
  // 启动应用
  await startApplication();
}

// 如果直接运行此文件，启动应用
if (require.main === module) {
  main().catch((error) => {
    logger.error('❌ Application startup failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  });
}

// 导出用于测试
export { startApplication, stopApplication };
export default { startApplication, stopApplication };
