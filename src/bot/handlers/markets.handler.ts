import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api.service';

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
      
      // Format and send text response with pagination (default page 1)
      const formattedMessage = this.formatMarketMessage(marketData, 1);
      const keyboard = this.createMarketsKeyboard(1, marketData.length);
      
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        loadingMessage.message_id,
        undefined,
        formattedMessage,
        { 
          parse_mode: 'Markdown',
          reply_markup: keyboard
        }
      );

      logger.info('Markets data sent successfully', {
        userId,
        dataCount: marketData.length,
        format: 'text'
      });

    } catch (error) {
      logger.error('Failed to handle markets command', {
        userId,
        username,
        error: (error as Error).message
      });

      // Send user-friendly error message
      await ctx.reply(
        '❌ Query Failed\\n\\n' +
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
   * Format market data as Telegram message with pagination
   */
  private formatMarketMessage(marketData: MarketData[], page: number = 1): string {
    try {
      const itemsPerPage = 10;
      const totalPages = Math.ceil(marketData.length / itemsPerPage);
      const startIndex = (page - 1) * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const pageData = marketData.slice(startIndex, endIndex);

      // Header with page info
      let message = `🏪 *PERP MARKETS*                    第 ${page}/${totalPages} 页\n\n`;
      
      // Format each coin in a clean single-line format
      pageData.forEach((coin) => {
        const priceText = this.formatPrice(coin.price);
        const changeText = this.formatChangeText(coin.change);
        
        // Create aligned format: TOKEN    PRICE    CHANGE%
        const tokenName = coin.name.padEnd(12);
        const price = `$${priceText}`.padStart(15);
        const change = changeText.padStart(10);
        
        message += `${tokenName}${price}   ${change}\n`;
      });

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
   * Create markets pagination keyboard
   */
  private createMarketsKeyboard(currentPage: number, totalItems: number): InlineKeyboardMarkup {
    const itemsPerPage = 10;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    
    const buttons = [];
    
    // Previous page button
    if (currentPage > 1) {
      buttons.push({
        text: '⬅️ 上一页',
        callback_data: `markets_page_${currentPage - 1}`
      });
    }
    
    // Next page button  
    if (currentPage < totalPages) {
      buttons.push({
        text: '下一页 ➡️',
        callback_data: `markets_page_${currentPage + 1}`
      });
    }
    
    return {
      inline_keyboard: buttons.length > 0 ? [buttons] : []
    };
  }

  /**
   * Handle markets pagination callback
   */
  public async handleCallback(ctx: Context): Promise<void> {
    const callbackData = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!callbackData || !callbackData.startsWith('markets_page_')) return;

    try {
      const page = parseInt(callbackData.replace('markets_page_', ''));
      
      // Show loading status
      await ctx.answerCbQuery('🔄 加载中...');
      
      // Get fresh market data
      const marketData = await this.fetchMarketData();
      
      // Format message for requested page
      const formattedMessage = this.formatMarketMessage(marketData, page);
      const keyboard = this.createMarketsKeyboard(page, marketData.length);
      
      // Update message
      await ctx.editMessageText(formattedMessage, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      
    } catch (error) {
      logger.error('Failed to handle markets pagination callback', {
        error: (error as Error).message,
        callbackData
      });
      
      await ctx.answerCbQuery('❌ 翻页失败，请重试');
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