import winston from 'winston';
import path from 'path';
import { config } from '../config';

/**
 * 日志级别定义
 */
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6
};

/**
 * 日志颜色配置
 */
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'blue',
  silly: 'gray'
};

// 设置Winston颜色
winston.addColors(logColors);

/**
 * 自定义日志格式
 */
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

/**
 * 控制台日志格式 (仅开发环境)
 */
const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    
    // 如果有额外的元数据，格式化输出
    if (Object.keys(meta).length > 0) {
      msg += '\n' + JSON.stringify(meta, null, 2);
    }
    
    return msg;
  })
);

/**
 * 创建日志传输器列表
 */
const transports: winston.transport[] = [];

// 文件日志传输器
if (config.logging.file) {
  // 确保日志目录存在
  const logDir = path.dirname(config.logging.file);
  
  // 错误日志文件
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      format: logFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    })
  );

  // 组合日志文件
  transports.push(
    new winston.transports.File({
      filename: config.logging.file,
      format: logFormat,
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true
    })
  );
}

// 控制台日志传输器 (开发环境)
if (config.env.isDevelopment || config.env.isTest) {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: config.logging.level
    })
  );
}

/**
 * 创建Winston Logger实例
 */
const winstonLogger = winston.createLogger({
  levels: logLevels,
  level: config.logging.level,
  format: logFormat,
  defaultMeta: {
    service: 'aiw3-tgbot',
    version: '1.0.0',
    environment: config.env.nodeEnv
  },
  transports,
  // 异常处理
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(path.dirname(config.logging.file), 'exceptions.log'),
      format: logFormat
    })
  ],
  // 拒绝处理
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(path.dirname(config.logging.file), 'rejections.log'),
      format: logFormat
    })
  ],
  // 当捕获异常时退出进程
  exitOnError: false
});

/**
 * 扩展日志方法，添加上下文信息
 */
interface LogContext {
  userId?: number;
  username?: string;
  command?: string;
  duration?: number;
  [key: string]: any;
}

/**
 * 增强的日志记录器
 */
class EnhancedLogger {
  private baseLogger: winston.Logger;

  constructor(baseLogger: winston.Logger) {
    this.baseLogger = baseLogger;
  }

  /**
   * 记录错误日志
   */
  error(message: string, meta?: LogContext): void {
    this.baseLogger.error(message, meta);
  }

  /**
   * 记录警告日志
   */
  warn(message: string, meta?: LogContext): void {
    this.baseLogger.warn(message, meta);
  }

  /**
   * 记录信息日志
   */
  info(message: string, meta?: LogContext): void {
    this.baseLogger.info(message, meta);
  }

  /**
   * 记录HTTP日志
   */
  http(message: string, meta?: LogContext): void {
    this.baseLogger.http(message, meta);
  }

  /**
   * 记录详细日志
   */
  verbose(message: string, meta?: LogContext): void {
    this.baseLogger.verbose(message, meta);
  }

  /**
   * 记录调试日志
   */
  debug(message: string, meta?: LogContext): void {
    this.baseLogger.debug(message, meta);
  }

  /**
   * 记录命令执行日志
   */
  logCommand(command: string, userId: number, username: string, args: string[], duration?: number): void {
    this.info(`Command executed: ${command}`, {
      userId,
      username,
      command,
      args,
      duration
    });
  }

  /**
   * 记录API调用日志
   */
  logApiCall(method: string, url: string, duration: number, statusCode?: number, error?: string): void {
    const level = error ? 'error' : 'http';
    const message = `API ${method} ${url} - ${duration}ms`;
    
    this.baseLogger.log(level, message, {
      type: 'api_call',
      method,
      url,
      duration,
      statusCode,
      error
    });
  }

  /**
   * 记录缓存操作日志
   */
  logCache(operation: 'hit' | 'miss' | 'set' | 'delete', key: string, ttl?: number): void {
    this.debug(`Cache ${operation}: ${key}`, {
      type: 'cache_operation',
      operation,
      key,
      ttl
    });
  }

  /**
   * 记录性能日志
   */
  logPerformance(operation: string, duration: number, meta?: LogContext): void {
    this.info(`Performance: ${operation} took ${duration}ms`, {
      type: 'performance',
      operation,
      duration,
      ...meta
    });
  }

  /**
   * 创建子日志记录器（带固定上下文）
   */
  child(defaultMeta: LogContext): EnhancedLogger {
    const childLogger = this.baseLogger.child(defaultMeta);
    return new EnhancedLogger(childLogger);
  }
}

// 确保日志目录存在
if (config.logging.file && !config.env.isTest) {
  const fs = require('fs');
  const logDir = path.dirname(config.logging.file);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

// 导出增强的日志记录器实例
export const logger = new EnhancedLogger(winstonLogger);

// 导出默认日志记录器（向后兼容）
export default logger;