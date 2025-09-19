import { Context } from 'telegraf';
import { ExtendedContext } from '../index';
import { accountService } from '../../services/account.service';
import { messageFormatter } from '../utils/message.formatter';
import { logger } from '../../utils/logger';
import { DetailedError, ApiErrorCode, FormattedWalletBalance } from '../../types/api.types';
import { i18nService } from '../../services/i18n.service';

/**
 * WalletHandler - 处理/wallet命令
 * 查看用户钱包余额和账户信息
 */
export class WalletHandler {
  private readonly commandName = '/wallet';

  /**
   * 处理/wallet命令
   * @param ctx Telegram上下文
   * @param args 命令参数（此命令不需要参数）
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const telegramId = ctx.from?.id?.toString();
    const username = ctx.from?.username || 'Unknown';
    const requestId = `wallet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // 验证用户ID
      if (!telegramId) {
        const userInfoError = await ctx.__!('trading.userInfoError');
        throw this.createError(
          ApiErrorCode.INVALID_SYMBOL,
          'Unable to identify user',
          userInfoError
        );
      }

      // 记录请求开始
      logger.info(`Wallet command started [${requestId}]`, {
        telegramId,
        username,
        commandName: this.commandName,
        requestId
      });

      // 发送加载消息
      const loadingMessage = await ctx.__!('wallet.loading');
      const sentMessage = await ctx.reply(loadingMessage, { 
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      });

      try {
        // 获取用户语言偏好
        const userLanguage = await i18nService.getUserLanguage(parseInt(telegramId));
        
        // 调用账户服务获取余额
        const balance = await accountService.getAccountBalance(telegramId);
        
        // 获取风险警告
        const warnings = accountService.getBalanceWarnings(balance);
        
        // 格式化钱包余额消息
        const balanceMessage = await messageFormatter.formatWalletBalanceMessage(balance, warnings, userLanguage);
        
        // 更新消息内容
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          sentMessage.message_id,
          undefined,
          balanceMessage,
          { 
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true }
          }
        );

        const duration = Date.now() - startTime;
        logger.info(`Wallet command completed successfully [${requestId}] - ${duration}ms`, {
          telegramId,
          username,
          nativeBalance: balance.nativeBalance,
          tokenCount: balance.tokenBalances.length,
          totalUsdValue: balance.totalUsdValue,
          warningCount: warnings.length,
          duration,
          requestId
        });

        // 记录性能指标
        logger.logPerformance('wallet_success', duration, {
          telegramId,
          requestId
        });

      } catch (serviceError) {
        // 获取用户语言偏好（错误情况下也需要）
        let userLanguage = 'en';
        try {
          userLanguage = await i18nService.getUserLanguage(parseInt(telegramId));
        } catch (langError) {
          logger.warn('Failed to get user language for error message, using default', { telegramId });
        }
        
        // 处理服务层错误
        const detailedError = this.handleServiceError(serviceError);
        const errorMessage = await messageFormatter.formatWalletErrorMessage(detailedError, userLanguage);
        
        // 更新消息为错误内容
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          sentMessage.message_id,
          undefined,
          errorMessage,
          { 
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true }
          }
        );

        const duration = Date.now() - startTime;
        logger.error(`Wallet command failed [${requestId}] - ${duration}ms`, {
          telegramId,
          username,
          errorCode: detailedError.code,
          errorMessage: detailedError.message,
          duration,
          requestId
        });
      }

    } catch (error) {
      // 处理Handler级别的错误
      const duration = Date.now() - startTime;
      const detailedError = this.handleHandlerError(error);
      
      logger.error(`Wallet handler error [${requestId}] - ${duration}ms`, {
        telegramId,
        username,
        errorCode: detailedError.code,
        errorMessage: detailedError.message,
        duration,
        requestId
      });

      // 尝试发送错误消息
      try {
        // 获取用户语言偏好
        let userLanguage = 'en';
        try {
          userLanguage = await i18nService.getUserLanguage(parseInt(telegramId || '0'));
        } catch (langError) {
          logger.warn('Failed to get user language for error message, using default');
        }
        
        const errorMessage = await messageFormatter.formatWalletErrorMessage(detailedError, userLanguage);
        await ctx.reply(errorMessage, { 
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
      } catch (sendError) {
        logger.error('Failed to send wallet error message', {
          telegramId,
          sendError: (sendError as Error).message,
          requestId
        });
        
        // 最后的fallback - 发送简单错误消息
        try {
          const walletError = await ctx.__!('wallet.error');
          await ctx.reply(walletError);
        } catch (fallbackError) {
          logger.error('Failed to send fallback error message', {
            telegramId,
            fallbackError: (fallbackError as Error).message,
            requestId
          });
        }
      }
    }
  }

  /**
   * 处理服务层错误
   */
  private handleServiceError(error: any): DetailedError {
    // 如果已经是DetailedError，直接返回
    if (this.isDetailedError(error)) {
      return error as DetailedError;
    }

    // 转换为DetailedError
    return this.createError(
      ApiErrorCode.UNKNOWN_ERROR,
      error.message || 'Service error',
      'Wallet balance query failed, please try again later'
    );
  }

  /**
   * 处理Handler级别的错误
   */
  private handleHandlerError(error: any): DetailedError {
    // 处理Telegram API错误
    if (error.code === 429) {
      return this.createError(
        ApiErrorCode.RATE_LIMIT_EXCEEDED,
        'Telegram rate limit exceeded',
        'Too many requests, please try again later'
      );
    }

    if (error.code >= 400 && error.code < 500) {
      return this.createError(
        ApiErrorCode.INVALID_SYMBOL,
        error.message,
        'Invalid request parameters, please retry'
      );
    }

    // 默认错误处理
    return this.createError(
      ApiErrorCode.UNKNOWN_ERROR,
      error.message || 'Handler error',
      'System error, please try again later'
    );
  }

  /**
   * 创建DetailedError
   */
  private createError(
    code: ApiErrorCode,
    originalMessage: string,
    userFriendlyMessage: string,
    retryable: boolean = true
  ): DetailedError {
    return {
      code,
      message: userFriendlyMessage,
      statusCode: undefined,
      retryable,
      context: {
        endpoint: '/wallet',
        timestamp: new Date()
      }
    };
  }

  /**
   * 检查是否为DetailedError
   */
  private isDetailedError(error: any): boolean {
    return error && 
           typeof error.code === 'string' && 
           typeof error.message === 'string' && 
           typeof error.retryable === 'boolean';
  }

  /**
   * 获取命令使用说明
   */
  public getUsage(): string {
    return `
💰 <b>/wallet Command Usage</b>

<b>Function:</b>
View your wallet balance and account information

<b>Usage:</b>
<code>/wallet</code> - Display wallet balance details

<b>Information displayed:</b>
• Total assets and available balance
• Used margin and fund utilization
• Risk warnings and operational suggestions
• Last update time

<b>Notes:</b>
• Account initialization required first (<code>/start</code>)
• Data updates automatically every 10 seconds
• Please retry if any issues occur
    `.trim();
  }

  /**
   * 获取Handler统计信息
   */
  public getStats(): any {
    return {
      name: 'WalletHandler',
      command: this.commandName,
      version: '1.0.0',
      features: [
        'Account balance query',
        'Risk warnings',
        'Real-time balance updates',
        'Comprehensive error handling',
        'Performance logging'
      ],
      supportedArgs: [],
      requiresAuth: true
    };
  }

  /**
   * 健康检查
   */
  public async healthCheck(): Promise<boolean> {
    try {
      return await accountService.healthCheck();
    } catch (error) {
      logger.warn('WalletHandler health check failed', {
        error: (error as Error).message
      });
      return false;
    }
  }
}

// 导出单例实例
export const walletHandler = new WalletHandler();

// 默认导出
export default walletHandler;