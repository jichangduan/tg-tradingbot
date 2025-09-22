import dotenv from 'dotenv';
import path from 'path';

// 统一环境管理: APP_ENV -> NODE_ENV
if (process.env.APP_ENV) {
  process.env.NODE_ENV = process.env.APP_ENV;
}

// 加载环境变量
dotenv.config({
  path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'development'}`)
});

// 如果没有找到环境特定的配置文件，尝试加载默认的 .env 文件
if (!process.env.TELEGRAM_BOT_TOKEN) {
  dotenv.config();
}

/**
 * 根据环境获取默认API URL
 */
function getDefaultApiUrl(): string {
  const nodeEnv = process.env.NODE_ENV || 'development';
  switch (nodeEnv) {
    case 'production':
      return 'https://api.aiw3.ai';
    case 'test':
      return 'https://api-test1.aiw3.ai';
    case 'development':
    default:
      return 'https://api-test1.aiw3.ai';
  }
}

/**
 * 根据环境获取默认Hyperliquid API URL
 */
function getDefaultHyperliquidUrl(): string {
  const nodeEnv = process.env.NODE_ENV || 'development';
  switch (nodeEnv) {
    case 'production':
      return 'https://api.hyperliquid.xyz';
    case 'test':
    case 'development':
    default:
      return 'https://api-ui.hyperliquid-testnet.xyz';
  }
}

/**
 * 根据环境获取默认机器人用户名
 */
function getDefaultBotUsername(): string {
  const nodeEnv = process.env.NODE_ENV || 'development';
  switch (nodeEnv) {
    case 'production':
      return 'aiw3_tradebot';
    case 'test':
    case 'development':
    default:
      return 'yuze_trading_bot';
  }
}

/**
 * 应用配置管理
 * 统一管理所有环境变量和配置项
 */
export const config = {
  // 环境配置
  env: {
    nodeEnv: process.env.NODE_ENV || 'development',
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.NODE_ENV === 'test'
  },

  // Telegram Bot配置
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN!,
    botUsername: process.env.TELEGRAM_BOT_USERNAME || getDefaultBotUsername(),
    webhookUrl: process.env.WEBHOOK_URL,
    adminChatId: process.env.ADMIN_CHAT_ID
  },

  // API配置
  api: {
    baseUrl: process.env.API_BASE_URL || getDefaultApiUrl(),
    apiKey: process.env.API_KEY,
    timeout: parseInt(process.env.API_TIMEOUT || '10000'),
    retryAttempts: parseInt(process.env.API_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.API_RETRY_DELAY || '1000')
  },

  // Hyperliquid配置
  hyperliquid: {
    apiUrl: process.env.HYPERLIQUID_API_URL || getDefaultHyperliquidUrl(),
    timeout: parseInt(process.env.HYPERLIQUID_TIMEOUT || '10000'),
    isMainnet: process.env.NODE_ENV === 'production'
  },

  // Redis缓存配置
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
    connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || '10000'),
    commandTimeout: parseInt(process.env.REDIS_COMMAND_TIMEOUT || '5000')
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'warn', // 生产环境默认warn级别
    file: process.env.LOG_FILE || './logs/tgbot.log',
    maxSize: process.env.LOG_MAX_SIZE || '10m',
    maxFiles: parseInt(process.env.LOG_MAX_FILES || '5'),
    datePattern: process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD'
  },

  // 缓存配置
  cache: {
    tokenPriceTTL: parseInt(process.env.CACHE_TOKEN_PRICE_TTL || '300'), // 5分钟
    defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL || '600') // 10分钟
  },

  // 应用配置
  app: {
    port: parseInt(process.env.PORT || '3000'),
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '30000'),
    maxRequestsPerMinute: parseInt(process.env.MAX_REQUESTS_PER_MINUTE || '100')
  },

  // 推送配置
  push: {
    intervalMinutes: parseInt(process.env.PUSH_INTERVAL_MINUTES || '20'), // 生产环境20分钟
    maxRetries: parseInt(process.env.PUSH_MAX_RETRIES || '3'),
    batchSize: parseInt(process.env.PUSH_BATCH_SIZE || '50'),
    enableScheduler: process.env.PUSH_SCHEDULER_ENABLED !== 'false', // 默认启用
    timezone: process.env.PUSH_TIMEZONE || 'Asia/Shanghai'
  },

  // 交易配置
  trading: {
    defaultAmount: process.env.TRADING_DEFAULT_AMOUNT || '10' // 默认交易金额 (USDC)
  }
};

/**
 * 验证必需的环境变量
 */
const requiredEnvVars: Array<keyof typeof process.env> = [
  'TELEGRAM_BOT_TOKEN'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

/**
 * 验证配置项的有效性
 */
export function validateConfig(): void {
  // 验证 Telegram Bot Token 格式
  if (!config.telegram.botToken.match(/^\d+:[A-Za-z0-9_-]+$/)) {
    throw new Error('Invalid TELEGRAM_BOT_TOKEN format');
  }

  // 验证 API 配置
  if (!config.api.baseUrl.startsWith('http')) {
    throw new Error('API_BASE_URL must start with http:// or https://');
  }

  // 验证 Redis 端口
  if (config.redis.port < 1 || config.redis.port > 65535) {
    throw new Error('Invalid REDIS_PORT: must be between 1 and 65535');
  }

  // 验证日志级别
  const validLogLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
  if (!validLogLevels.includes(config.logging.level)) {
    throw new Error(`Invalid LOG_LEVEL: must be one of ${validLogLevels.join(', ')}`);
  }
}

/**
 * 记录配置信息（用于调试）
 */
export function logConfigInfo(): void {
  console.log('🔧 Configuration Info:');
  console.log(`   Environment: ${config.env.nodeEnv}`);
  console.log(`   Bot Username: ${config.telegram.botUsername}`);
  console.log(`   API Base URL: ${config.api.baseUrl}`);
  console.log(`   Hyperliquid URL: ${config.hyperliquid.apiUrl}`);
  console.log(`   Log Level: ${config.logging.level}`);
  
  // 检查是否使用了 fallback 值
  const envBotUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (!envBotUsername) {
    console.log(`   ⚠️  Bot username using fallback (TELEGRAM_BOT_USERNAME not set)`);
  }
}

// 在非测试环境下验证配置
if (!config.env.isTest) {
  validateConfig();
}

export default config;
