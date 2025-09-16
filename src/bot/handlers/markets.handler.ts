import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api.service';
import { messageFormatter } from '../utils/message.formatter';
import { chartImageService, MarketsTableData, MarketDataItem } from '../../services/chart-image.service';

/**
 * Market data interface response types
 */
interface MarketData {
  name: string;
  price: number;
  change: number;
}

interface MarketDataResponse {
  code: number;
  data: MarketData[];
  message: string;
}

/**
 * Market data command handler
 * Handles /markets command, displays major cryptocurrency market data
 */
export class MarketsHandler {

  constructor() {
  }

  /**
   * Handle /markets command
   */
  public async handle(ctx: Context, args: string[]): Promise<void> {
    const userId = ctx.from?.id;
    const username = ctx.from?.username;
    
    logger.info('Markets command received', { 
      userId, 
      username, 
      args: args.length
    });

    try {
      // Send loading message
      const loadingMessage = await ctx.reply('📊 Fetching market data...');
      
      // Get market data
      const marketData = await this.fetchMarketData();
      
      // Try to generate market chart image
      let useImageChart = true;
      let chartImage;
      
      try {
        const marketsTableData = this.convertToMarketsTableData(marketData);
        chartImage = await chartImageService.generateMarketsChart(marketsTableData);
      } catch (imageError) {
        logger.warn('Markets chart generation failed, falling back to text format', {
          error: (imageError as Error).message,
          userId
        });
        useImageChart = false;
      }

      // Send response
      try {
        if (useImageChart && chartImage) {
          // Send clean chart image
          await ctx.telegram.deleteMessage(ctx.chat?.id!, loadingMessage.message_id);
          
          await ctx.replyWithPhoto(
            { source: chartImage.imageBuffer },
            {
              caption: '📊 <b>PERP MARKETS</b>\n\n<i>💡 Use /price &lt;token&gt; for detailed information</i>',
              parse_mode: 'HTML'
            }
          );
        } else {
          // Fallback to text format
          const formattedMessage = this.formatMarketMessage(marketData);
          
          await ctx.telegram.editMessageText(
            ctx.chat?.id,
            loadingMessage.message_id,
            undefined,
            formattedMessage,
            { parse_mode: 'Markdown' }
          );
        }

        logger.info('Markets data sent successfully', {
          userId,
          dataCount: marketData.length,
          chartType: useImageChart ? 'image' : 'text'
        });

      } catch (messageError) {
        logger.error('Failed to send markets message', {
          error: (messageError as Error).message,
          userId
        });

        // Final fallback - send simple text message
        try {
          const formattedMessage = this.formatMarketMessage(marketData);
          await ctx.reply(formattedMessage, { parse_mode: 'Markdown' });
        } catch (fallbackError) {
          logger.error('Fallback message also failed', {
            error: (fallbackError as Error).message
          });
        }
      }

    } catch (error) {
      logger.error('Failed to handle markets command', {
        userId,
        username,
        error: (error as Error).message
      });

      // Send user-friendly error message
      await ctx.reply(
        '❌ Query Failed\n\n' +
        'Error occurred while fetching market data, please try again later.',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Fetch market data from API
   */
  private async fetchMarketData(): Promise<MarketData[]> {
    try {
      logger.debug('Fetching market data from API');
      
      const response = await apiService.get<MarketDataResponse>(
        '/api/home/getLargeMarketData'
      );

      // Validate response format
      if (!response || response.code !== 200 || !Array.isArray(response.data)) {
        throw new Error(`Invalid API response format: ${JSON.stringify(response).substring(0, 200)}`);
      }

      // Validate data integrity
      const validData = response.data.filter(item => 
        item && 
        typeof item.name === 'string' && 
        typeof item.price === 'number' && 
        typeof item.change === 'number'
      );

      if (validData.length === 0) {
        throw new Error('No valid market data received from API');
      }

      logger.debug(`Successfully fetched ${validData.length} market entries`);
      return validData;

    } catch (error) {
      logger.error('Failed to fetch market data from API', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Format market data as Telegram message
   */
  private formatMarketMessage(marketData: MarketData[]): string {
    try {
      // Message header
      let message = '🏪 *Major Cryptocurrency Market Data*\n\n';
      
      // Add information for each coin
      marketData.forEach((coin, index) => {
        const changeEmoji = this.getChangeEmoji(coin.change);
        const changeText = this.formatChangeText(coin.change);
        const priceText = this.formatPrice(coin.price);
        
        message += `${index + 1}. *${coin.name}*\n`;
        message += `   💰 $${priceText}\n`;
        message += `   ${changeEmoji} ${changeText}\n\n`;
      });

      // Add update time
      const updateTime = new Date().toLocaleString('en-US', {
        timeZone: 'UTC',
        hour12: false
      });
      message += `\n⏰ Updated: ${updateTime} UTC`;
      
      // Add usage tip
      message += '\n\n💡 Use `/price <token>` to view detailed price information';

      return message;

    } catch (error) {
      logger.error('Failed to format market message', {
        error: (error as Error).message,
        dataCount: marketData.length
      });
      throw new Error('Message formatting failed');
    }
  }

  /**
   * Convert API market data to chart table data format
   */
  private convertToMarketsTableData(marketData: MarketData[]): MarketsTableData {
    const markets: MarketDataItem[] = marketData.map(market => ({
      name: market.name,
      price: market.price,
      change: market.change,
      volume: undefined, // API doesn't provide volume data
      marketCap: undefined // API doesn't provide market cap data
    }));

    return {
      title: 'PERP MARKETS',
      markets: markets,
      timestamp: Date.now()
    };
  }

  /**
   * Get emoji based on price change
   */
  private getChangeEmoji(change: number): string {
    if (change > 0) return '📈';
    if (change < 0) return '📉';
    return '➡️';
  }

  /**
   * Format price change text
   */
  private formatChangeText(change: number): string {
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}%`;
  }

  /**
   * Format price display
   */
  private formatPrice(price: number): string {
    if (price >= 1000) {
      return price.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    } else if (price >= 1) {
      return price.toFixed(2);
    } else if (price >= 0.01) {
      return price.toFixed(4);
    } else {
      return price.toFixed(8);
    }
  }

  /**
   * Health check - test if market data API is working properly
   */
  public async healthCheck(): Promise<boolean> {
    try {
      await this.fetchMarketData();
      return true;
    } catch (error) {
      logger.warn('Markets handler health check failed', { 
        error: (error as Error).message 
      });
      return false;
    }
  }
}

// Export singleton instance
export const marketsHandler = new MarketsHandler();

// Default export
export default marketsHandler;