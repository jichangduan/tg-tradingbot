import { Context } from 'telegraf';
import { ExtendedContext } from '../bot/index';
import { ErrorClassifier, ErrorType, ErrorClassification } from './error-classifier';
import { formatErrorMessage, getShortErrorMessage, isUserFault } from './error-messages';
import { logger } from './logger';

/**
 * 错误处理上下文接口
 */
export interface ErrorContext {
  command?: string;
  symbol?: string;
  amount?: string;
  userId?: number;
  username?: string;
  requestId?: string;
  details?: string;
}

/**
 * 错误处理选项接口
 */
export interface ErrorHandlingOptions {
  shouldReply?: boolean;         // 是否发送回复消息（默认true）
  shouldLog?: boolean;           // 是否记录日志（默认true）
  shouldEditMessage?: boolean;   // 是否编辑现有消息（默认false）
  loadingMessageId?: number;     // 要编辑的消息ID
  customPrefix?: string;         // 自定义消息前缀
  includeRetryHint?: boolean;    // 是否包含重试提示（默认根据错误类型判断）
}

/**
 * 统一错误处理器类
 * 提供标准化的错误处理流程
 */
export class ErrorHandler {
  /**
   * 处理API错误
   */
  public static async handleApiError(
    ctx: ExtendedContext,
    error: any,
    context: ErrorContext,
    options: ErrorHandlingOptions = {}
  ): Promise<void> {
    const {
      shouldReply = true,
      shouldLog = true,
      shouldEditMessage = false,
      loadingMessageId,
      customPrefix,
      includeRetryHint
    } = options;

    try {
      // 分类错误
      const classification = ErrorClassifier.classifyApiError(error);
      
      // 记录日志
      if (shouldLog) {
        this.logError(classification, context);
      }

      // 生成用户友好的错误消息
      const userMessage = this.generateUserMessage(
        classification, 
        context, 
        customPrefix, 
        includeRetryHint
      );

      // 发送或编辑错误消息
      if (shouldReply) {
        if (shouldEditMessage && loadingMessageId) {
          await this.editErrorMessage(ctx, loadingMessageId, userMessage);
        } else {
          await this.sendErrorMessage(ctx, userMessage);
        }
      }

    } catch (handlingError) {
      // 错误处理过程中出现错误，记录并发送兜底消息
      logger.error('Error handling failed', {
        originalError: error.message,
        handlingError: (handlingError as Error).message,
        context,
        requestId: context.requestId
      });

      if (shouldReply) {
        await this.sendFallbackErrorMessage(ctx);
      }
    }
  }

  /**
   * 处理通用错误
   */
  public static async handleGenericError(
    ctx: ExtendedContext,
    error: Error | any,
    context: ErrorContext,
    options: ErrorHandlingOptions = {}
  ): Promise<void> {
    const {
      shouldReply = true,
      shouldLog = true,
      shouldEditMessage = false,
      loadingMessageId,
      customPrefix,
      includeRetryHint
    } = options;

    try {
      // 分类错误
      const classification = ErrorClassifier.classifyGenericError(error);
      
      // 记录日志
      if (shouldLog) {
        this.logError(classification, context);
      }

      // 生成用户友好的错误消息
      const userMessage = this.generateUserMessage(
        classification, 
        context, 
        customPrefix, 
        includeRetryHint
      );

      // 发送或编辑错误消息
      if (shouldReply) {
        if (shouldEditMessage && loadingMessageId) {
          await this.editErrorMessage(ctx, loadingMessageId, userMessage);
        } else {
          await this.sendErrorMessage(ctx, userMessage);
        }
      }

    } catch (handlingError) {
      // 错误处理过程中出现错误
      logger.error('Generic error handling failed', {
        originalError: error.message || error.toString(),
        handlingError: (handlingError as Error).message,
        context,
        requestId: context.requestId
      });

      if (shouldReply) {
        await this.sendFallbackErrorMessage(ctx);
      }
    }
  }

  /**
   * 快速处理交易相关错误
   */
  public static async handleTradingError(
    ctx: ExtendedContext,
    error: any,
    command: string,
    symbol?: string,
    amount?: string,
    loadingMessageId?: number
  ): Promise<void> {
    const context: ErrorContext = {
      command,
      symbol,
      amount,
      userId: ctx.from?.id,
      username: ctx.from?.username || 'unknown',
      requestId: ctx.requestId || 'unknown'
    };

    await this.handleApiError(ctx, error, context, {
      shouldEditMessage: !!loadingMessageId,
      loadingMessageId,
      includeRetryHint: true
    });
  }

  /**
   * 生成用户友好的错误消息
   */
  private static generateUserMessage(
    classification: ErrorClassification,
    context: ErrorContext,
    customPrefix?: string,
    includeRetryHint?: boolean
  ): string {
    let message = formatErrorMessage(classification.type, {
      symbol: context.symbol,
      amount: context.amount,
      command: context.command,
      details: context.details
    });

    // 添加自定义前缀
    if (customPrefix) {
      message = `${customPrefix}\n\n${message}`;
    }

    // 根据错误类型添加重试提示
    const shouldIncludeRetry = includeRetryHint !== undefined 
      ? includeRetryHint 
      : classification.isRetryable;

    if (shouldIncludeRetry) {
      message += '\n\n🔄 <i>This issue may be temporary, please try again later</i>';
    }

    return message;
  }

  /**
   * 发送错误消息
   */
  private static async sendErrorMessage(ctx: ExtendedContext, message: string): Promise<void> {
    try {
      await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (replyError) {
      logger.error('Failed to send error message', {
        replyError: (replyError as Error).message,
        userId: ctx.from?.id,
        requestId: ctx.requestId
      });
      
      // 尝试发送简化版本
      try {
        await ctx.reply('❌ System encountered an error, please try again later');
      } catch {
        // 最后的尝试也失败了，只能记录日志
        logger.error('Failed to send fallback error message', {
          userId: ctx.from?.id,
          requestId: ctx.requestId
        });
      }
    }
  }

  /**
   * 编辑错误消息
   */
  private static async editErrorMessage(
    ctx: ExtendedContext, 
    messageId: number, 
    message: string
  ): Promise<void> {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        messageId,
        undefined,
        message,
        { parse_mode: 'HTML' }
      );
    } catch (editError) {
      logger.error('Failed to edit error message', {
        editError: (editError as Error).message,
        messageId,
        userId: ctx.from?.id,
        requestId: ctx.requestId
      });
      
      // 编辑失败，尝试发送新消息
      await this.sendErrorMessage(ctx, message);
    }
  }

  /**
   * 发送兜底错误消息
   */
  private static async sendFallbackErrorMessage(ctx: ExtendedContext): Promise<void> {
    const fallbackMessage = 
      '❌ <b>System Error</b>\n\n' +
      'Sorry, the system encountered an unexpected error.\n\n' +
      '💡 <b>Please try:</b>\n' +
      '• Try again later\n' +
      '• Restart the conversation with <code>/start</code>\n' +
      '• Contact administrator for help\n\n' +
      '<i>Error has been logged, technical team will handle it as soon as possible</i>';

    try {
      await ctx.reply(fallbackMessage, { parse_mode: 'HTML' });
    } catch (fallbackError) {
      logger.error('Failed to send fallback error message', {
        fallbackError: (fallbackError as Error).message,
        userId: ctx.from?.id,
        requestId: ctx.requestId
      });
    }
  }

  /**
   * 记录错误日志
   */
  private static logError(classification: ErrorClassification, context: ErrorContext): void {
    const shortMessage = getShortErrorMessage(classification.type);
    const isUser = isUserFault(classification.type);
    
    const logLevel = this.getLogLevel(classification.severity, isUser);
    const logMethod = logger[logLevel as keyof typeof logger] as Function;

    logMethod.call(logger, `${context.command || 'Unknown'} command error [${context.requestId}]`, {
      errorType: classification.type,
      severity: classification.severity,
      httpStatus: classification.httpStatus,
      isRetryable: classification.isRetryable,
      isUserFault: isUser,
      shortMessage,
      originalError: classification.originalError.message || classification.originalError.toString(),
      context,
      stack: classification.originalError.stack
    });
  }

  /**
   * 根据错误严重程度和用户错误判断日志级别
   */
  private static getLogLevel(severity: string, isUser: boolean): string {
    if (isUser) {
      // 用户错误通常记录为info或warn
      return severity === 'high' || severity === 'critical' ? 'warn' : 'info';
    } else {
      // 系统错误记录为warn或error
      switch (severity) {
        case 'low':
          return 'warn';
        case 'medium':
          return 'warn';
        case 'high':
          return 'error';
        case 'critical':
          return 'error';
        default:
          return 'error';
      }
    }
  }

  /**
   * 检查错误是否应该重试
   */
  public static shouldRetryError(error: any): boolean {
    return ErrorClassifier.isRetryableError(error);
  }

  /**
   * 获取错误严重程度
   */
  public static getErrorSeverity(error: any): 'low' | 'medium' | 'high' | 'critical' {
    return ErrorClassifier.getErrorSeverity(error);
  }
}

/**
 * 便捷的错误处理函数
 */
export async function handleError(
  ctx: ExtendedContext,
  error: any,
  context: ErrorContext,
  options: ErrorHandlingOptions = {}
): Promise<void> {
  if (error.status || error.response) {
    // API错误
    await ErrorHandler.handleApiError(ctx, error, context, options);
  } else {
    // 通用错误
    await ErrorHandler.handleGenericError(ctx, error, context, options);
  }
}

/**
 * 便捷的交易错误处理函数
 */
export async function handleTradingError(
  ctx: ExtendedContext,
  error: any,
  command: string,
  symbol?: string,
  amount?: string,
  loadingMessageId?: number
): Promise<void> {
  await ErrorHandler.handleTradingError(ctx, error, command, symbol, amount, loadingMessageId);
}

// 导出默认类
export default ErrorHandler;