/**
 * Jest测试环境设置
 * 在所有测试运行前执行的全局配置
 */

// 设置测试环境变量
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // 测试时减少日志输出

// Mock环境变量
process.env.TELEGRAM_BOT_TOKEN = 'test_bot_token_123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZ';
process.env.API_BASE_URL = 'https://test-api.aiw3.com';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';

// 设置全局测试超时
jest.setTimeout(30000);

// 全局错误处理
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Mock console方法（减少测试时的噪音）
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

beforeEach(() => {
  // 只在需要时取消注释这些行
  // console.error = jest.fn();
  // console.warn = jest.fn();
  // console.log = jest.fn();
});

afterEach(() => {
  // 恢复原始console方法
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
  console.log = originalConsoleLog;
});

// 全局测试工具函数
declare global {
  var createMockContext: () => any;
  var createMockTokenData: () => any;
  var sleep: (ms: number) => Promise<void>;
}

// 创建模拟Telegram Context的辅助函数
global.createMockContext = () => ({
  from: {
    id: 123456789,
    username: 'testuser',
    first_name: 'Test',
    last_name: 'User'
  },
  chat: {
    id: 987654321,
    type: 'private'
  },
  message: {
    message_id: 1001,
    text: '/test',
    date: Math.floor(Date.now() / 1000)
  },
  reply: jest.fn().mockResolvedValue({ message_id: 1002 }),
  telegram: {
    editMessageText: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue({ message_id: 1003 })
  },
  requestId: 'test_req_123',
  startTime: Date.now()
});

// 创建模拟代币数据的辅助函数
global.createMockTokenData = () => ({
  symbol: 'BTC',
  name: 'Bitcoin',
  price: 50000,
  change24h: 2.5,
  volume24h: 1000000000,
  marketCap: 950000000000,
  high24h: 51000,
  low24h: 49000,
  supply: {
    circulating: 19500000,
    total: 21000000,
    max: 21000000
  },
  updatedAt: new Date(),
  source: 'aiw3_api',
  isCached: false
});

// 延迟函数（用于异步测试）
global.sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mock外部依赖
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    setEx: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    keys: jest.fn(),
    flushDb: jest.fn(),
    ping: jest.fn(),
    info: jest.fn(),
    isReady: true
  }))
}));

// Mock Winston日志
jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    silly: jest.fn()
  })),
  format: {
    combine: jest.fn(),
    timestamp: jest.fn(),
    errors: jest.fn(),
    json: jest.fn(),
    prettyPrint: jest.fn(),
    colorize: jest.fn(),
    printf: jest.fn()
  },
  transports: {
    Console: jest.fn(),
    File: jest.fn()
  },
  addColors: jest.fn()
}));

// 导出测试工具
export const testUtils = {
  createMockContext: global.createMockContext,
  createMockTokenData: global.createMockTokenData,
  sleep: global.sleep
};