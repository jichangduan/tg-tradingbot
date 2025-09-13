import { Context } from 'telegraf';
import { apiService } from '../../services/api.service';
import { userService } from '../../services/user.service';
import { getUserAccessToken, getUserDataAndToken } from '../../utils/auth';
import { logger } from '../../utils/logger';
import { handleTradingError } from '../../utils/error-handler';
import { ExtendedContext } from '../index';

/**
 * Close command handler
 * Handles /close <symbol> [percentage] command
 * Supports full position and partial position closing
 */
export class CloseHandler {
  /**
   * Handle /close command
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('close', userId!, username, args);

      // Parameter validation
      if (args.length === 0) {
        await ctx.reply(
          '❌ <b>Insufficient Parameters</b>\n\n' +
          'Correct Format:\n' +
          '• <code>/close &lt;symbol&gt;</code> - Close full position\n' +
          '• <code>/close &lt;symbol&gt; &lt;percentage&gt;</code> - Close partial position\n\n' +
          '<b>Examples:</b>\n' +
          '• <code>/close BTC</code> - Close all BTC positions\n' +
          '• <code>/close ETH 50%</code> - Close 50% of ETH position\n' +
          '• <code>/close SOL 0.5</code> - Close specific amount',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const symbol = args[0];
      const closeAmount = args[1] || '100%'; // Default full position close

      // Basic validation
      if (!symbol) {
        await ctx.reply(
          '❌ Please provide the token symbol to close\n\n' +
          'Format: <code>/close &lt;symbol&gt; [percentage]</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Validate close amount format
      const { isValid, amount, isPercentage, errorMsg } = this.validateCloseAmount(closeAmount);
      if (!isValid) {
        await ctx.reply(
          `❌ <b>Invalid Close Amount Format</b>\n\n` +
          `Input Value: <code>${closeAmount}</code>\n` +
          `Error: ${errorMsg}\n\n` +
          '<b>Supported Formats:</b>\n' +
          '• Percentage: <code>50%</code>, <code>100%</code>\n' +
          '• Decimal: <code>0.5</code>, <code>1.0</code>\n' +
          '• Integer: <code>1</code>, <code>10</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // Send processing message
      const loadingMessage = await ctx.reply(
        `🔄 <b>Processing close position...</b>\n\n` +
        `Symbol: <code>${symbol.toUpperCase()}</code>\n` +
        `Close ${isPercentage ? 'Percentage' : 'Amount'}: <code>${closeAmount}</code>\n` +
        `Order Type: ${closeAmount === '100%' ? 'Full Position Close' : 'Partial Position Close'}`,
        { parse_mode: 'HTML' }
      );

      // Get user data and access token (single call)
      const { userData, accessToken: initialAccessToken } = await getUserDataAndToken(userId!.toString(), {
        username,
        first_name: ctx.from?.first_name,
        last_name: ctx.from?.last_name
      });

      // Prepare close data (moved outside try block for retry use)
      // Fix: Format parameters according to backend API expectations - add internal userId
      const closeData = {
        userId: userData.userId,                              // ✅ Use internal user ID
        symbol: symbol.toUpperCase(),
        // If percentage, send original user input (includes %); if amount, send amount string
        percentage: isPercentage ? closeAmount : amount.toString(),
        orderType: 'market'
      };

      try {
        // Use already obtained access token
        const accessToken = initialAccessToken;

        // Call close position API
        logger.info(`Close position API call attempt [${requestId}]`, {
          userId,
          username,
          symbol: symbol.toUpperCase(),
          closeData,
          hasAccessToken: !!accessToken,
          tokenLength: accessToken?.length,
          isPercentage,
          requestId
        });

        const result = await apiService.postWithAuth(
          '/api/tgbot/trading/close',
          accessToken,
          closeData
        );

        // Edit message to show success result
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMessage.message_id,
          undefined,
          `✅ <b>Position Close Order Submitted Successfully</b>\n\n` +
          `Symbol: <code>${symbol.toUpperCase()}</code>\n` +
          `Close ${isPercentage ? 'Percentage' : 'Amount'}: <code>${closeAmount}</code>\n` +
          `Order Type: ${closeAmount === '100%' ? 'Full Position Close' : 'Partial Position Close'}\n\n` +
          `<i>Close order is being processed, please wait...</i>\n\n` +
          `💡 Use <code>/positions</code> to check updated position status`,
          { parse_mode: 'HTML' }
        );

        // Send additional success notification after a brief delay
        setTimeout(async () => {
          try {
            await ctx.reply(
              `🎉 <b>POSITION CLOSE COMPLETED!</b> 🎉\n\n` +
              `✅ Your ${symbol.toUpperCase()} position has been successfully closed\n` +
              `📊 Close amount: <code>${closeAmount}</code>\n\n` +
              `💡 <b>Next Steps:</b>\n` +
              `• Check <code>/wallet</code> for updated balance\n` +
              `• View <code>/positions</code> for remaining positions\n` +
              `• Use <code>/pnl</code> to see your trading performance`,
              { parse_mode: 'HTML' }
            );
          } catch (notificationError) {
            logger.warn('Failed to send close success notification', {
              userId,
              symbol,
              error: (notificationError as Error).message
            });
          }
        }, 2000); // 2 second delay to allow processing

        const duration = Date.now() - startTime;
        logger.info(`Close position success [${requestId}]`, {
          symbol: symbol.toUpperCase(),
          closeAmount,
          isPercentage,
          userId,
          username,
          duration,
          durationMs: `${duration}ms`,
          apiResult: result,
          requestId
        });
        
        logger.logPerformance('close_position_success', duration, {
          symbol,
          closeAmount,
          isPercentage,
          userId,
          username,
          requestId
        });

      } catch (apiError: any) {
        // Use new unified error handling system
        if (apiError.status === 401) {
          // 401 error: attempt token refresh and retry
          logger.warn(`Close position 401 error, attempting token refresh [${requestId}]`, {
            userId,
            username,
            symbol: symbol.toUpperCase(),
            closeAmount,
            isPercentage,
            closeData,
            originalError: apiError.message,
            errorStatus: apiError.status,
            errorResponse: apiError.response?.data,
            requestId
          });

          try {
            // Get new access token
            const newAccessToken = await getUserAccessToken(userId!.toString(), {
              username,
              first_name: ctx.from?.first_name,
              last_name: ctx.from?.last_name
            });

            logger.info(`Token refreshed, retrying close position [${requestId}]`, {
              userId,
              symbol,
              hasNewToken: !!newAccessToken,
              requestId
            });

            // Retry API call with new token
            const retryResult = await apiService.postWithAuth(
              '/api/tgbot/trading/close',
              newAccessToken,
              closeData
            );

            // Retry successful, show success message
            await ctx.telegram.editMessageText(
              ctx.chat?.id,
              loadingMessage.message_id,
              undefined,
              `✅ <b>Position Close Order Submitted Successfully</b>\n\n` +
              `Symbol: <code>${symbol.toUpperCase()}</code>\n` +
              `Close ${isPercentage ? 'Percentage' : 'Amount'}: <code>${closeAmount}</code>\n` +
              `Order Type: ${closeAmount === '100%' ? 'Full Position Close' : 'Partial Position Close'}\n\n` +
              `<i>Close order is being processed, please wait...</i>\n\n` +
              `💡 Use <code>/positions</code> to check updated position status`,
              { parse_mode: 'HTML' }
            );

            // Send additional success notification after a brief delay
            setTimeout(async () => {
              try {
                await ctx.reply(
                  `🎉 <b>POSITION CLOSE COMPLETED!</b> 🎉\n\n` +
                  `✅ Your ${symbol.toUpperCase()} position has been successfully closed\n` +
                  `📊 Close amount: <code>${closeAmount}</code>\n\n` +
                  `💡 <b>Next Steps:</b>\n` +
                  `• Check <code>/wallet</code> for updated balance\n` +
                  `• View <code>/positions</code> for remaining positions\n` +
                  `• Use <code>/pnl</code> to see your trading performance`,
                  { parse_mode: 'HTML' }
                );
              } catch (notificationError) {
                logger.warn('Failed to send close success notification (retry)', {
                  userId,
                  symbol,
                  error: (notificationError as Error).message
                });
              }
            }, 2000); // 2 second delay to allow processing

            logger.info(`Close position retry success after 401 [${requestId}]`, {
              userId,
              username,
              symbol: symbol.toUpperCase(),
              closeAmount,
              isPercentage,
              closeData,
              retryResult,
              requestId
            });

            return; // Success, return directly
          } catch (retryError: any) {
            // Retry failed, log detailed information
            logger.error(`Close position retry failed after 401 [${requestId}]`, {
              userId,
              username,
              symbol: symbol.toUpperCase(),
              closeAmount,
              isPercentage,
              closeData,
              originalError: apiError.message,
              retryError: retryError.message,
              retryErrorStatus: retryError.status,
              retryErrorResponse: retryError.response?.data,
              requestId
            });
            
            // Use unified error handling
            await handleTradingError(
              ctx, 
              retryError, 
              'close', 
              symbol, 
              closeAmount, 
              loadingMessage.message_id
            );
            return;
          }
        } else {
          // Other errors, log detailed information
          logger.error(`Close position API error [${requestId}]`, {
            userId,
            username,
            symbol: symbol.toUpperCase(),
            closeAmount,
            isPercentage,
            closeData,
            errorStatus: apiError.status,
            errorMessage: apiError.message,
            errorResponse: apiError.response?.data,
            errorStack: apiError.stack,
            requestId
          });
          
          // Use unified error handling
          await handleTradingError(
            ctx, 
            apiError, 
            'close', 
            symbol, 
            closeAmount, 
            loadingMessage.message_id
          );
        }
      }

    } catch (error) {
      // System exception, log detailed information
      logger.error(`Close position system error [${requestId}]`, {
        userId,
        username,
        args,
        symbol: args[0],
        closeAmount: args[1],
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack,
        requestId
      });
      
      // Use unified error handling for system exceptions
      await handleTradingError(ctx, error, 'close', args[0], args[1]);
    }
  }

  /**
   * Validate close amount format
   */
  private validateCloseAmount(amountStr: string): {
    isValid: boolean;
    amount: number;
    isPercentage: boolean;
    errorMsg?: string;
  } {
    if (!amountStr || amountStr.trim() === '') {
      return {
        isValid: false,
        amount: 0,
        isPercentage: false,
        errorMsg: 'Amount cannot be empty'
      };
    }

    const trimmed = amountStr.trim();

    // Check percentage format
    if (trimmed.endsWith('%')) {
      const percentageStr = trimmed.slice(0, -1);
      const percentage = parseFloat(percentageStr);
      
      if (isNaN(percentage)) {
        return {
          isValid: false,
          amount: 0,
          isPercentage: true,
          errorMsg: 'Invalid percentage format'
        };
      }
      
      if (percentage <= 0 || percentage > 100) {
        return {
          isValid: false,
          amount: 0,
          isPercentage: true,
          errorMsg: 'Percentage must be between 0-100%'
        };
      }
      
      return {
        isValid: true,
        amount: percentage,
        isPercentage: true
      };
    }

    // Check number format
    const amount = parseFloat(trimmed);
    if (isNaN(amount)) {
      return {
        isValid: false,
        amount: 0,
        isPercentage: false,
        errorMsg: 'Invalid amount format'
      };
    }
    
    if (amount <= 0) {
      return {
        isValid: false,
        amount: 0,
        isPercentage: false,
        errorMsg: 'Amount must be greater than 0'
      };
    }
    
    if (amount > 999999) {
      return {
        isValid: false,
        amount: 0,
        isPercentage: false,
        errorMsg: 'Amount too large'
      };
    }
    
    return {
      isValid: true,
      amount: amount,
      isPercentage: false
    };
  }

  /**
   * Get handler statistics
   */
  public getStats(): any {
    return {
      name: 'CloseHandler',
      version: '1.0.0',
      supportedCommands: ['/close'],
      features: [
        'Position closing',
        'Partial position closing',
        'Percentage-based closing',
        'User authentication',
        'Parameter validation',
        'Detailed error handling',
        'Trading status feedback'
      ]
    };
  }
}

// Export singleton instance
export const closeHandler = new CloseHandler();

// Default export
export default closeHandler;