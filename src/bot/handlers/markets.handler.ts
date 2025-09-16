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
          parse_mode: 'HTML',
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

      logger.debug(`Successfully fetched ${validData.length} market entries`, {
        totalEntries: validData.length,
        entries: validData.map(item => ({ name: item.name, price: item.price, change: item.change }))
      });
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

      // Header with HTML pre tag for perfect alignment without copy button
      let message = `🏪 <b>PERP MARKETS</b>\n\n<pre>\n`;
      
      // Format each coin with precise column alignment
      pageData.forEach((coin) => {
        const priceText = this.formatPrice(coin.price);
        const changeText = this.formatChangeText(coin.change);
        
        // Create precisely aligned columns:
        // Token name: 20 chars left-aligned
        // Price: 15 chars right-aligned with $ prefix
        // Change: 10 chars right-aligned
        const tokenName = coin.name.padEnd(20);
        const price = `$${priceText}`.padStart(15);
        const change = changeText.padStart(10);
        
        // Use exact spacing between columns
        message += `${tokenName}${price}  ${change}\n`;
      });

      // Close pre tag
      message += `</pre>`;

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
   * Create markets pagination keyboard with three-button layout
   */
  private createMarketsKeyboard(currentPage: number, totalItems: number): InlineKeyboardMarkup {
    const itemsPerPage = 10;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    
    logger.debug('Creating markets keyboard', {
      currentPage,
      totalItems,
      totalPages,
      itemsPerPage
    });
    
    // Three-button layout: [⬅️] [1/3] [➡️]
    const buttons = [];
    
    // Previous page button (disabled if on first page)
    buttons.push({
      text: currentPage > 1 ? '⬅️' : '◀️',
      callback_data: currentPage > 1 ? `markets_prev_${currentPage - 1}` : 'markets_disabled'
    });
    
    // Page info button (center)
    buttons.push({
      text: `${currentPage}/${totalPages}`,
      callback_data: 'markets_page_info'
    });
    
    // Next page button (disabled if on last page)
    buttons.push({
      text: currentPage < totalPages ? '▶️' : '▶️',
      callback_data: currentPage < totalPages ? `markets_next_${currentPage + 1}` : 'markets_disabled'
    });
    
    const keyboard = {
      inline_keyboard: [buttons]
    };
    
    logger.debug('Markets keyboard created', {
      currentPage,
      totalPages,
      keyboard: JSON.stringify(keyboard)
    });
    
    return keyboard;
  }

  /**
   * Handle markets pagination callback
   */
  public async handleCallback(ctx: Context): Promise<void> {
    const callbackData = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!callbackData || !callbackData.startsWith('markets_')) return;

    try {
      // Handle disabled buttons (do nothing)
      if (callbackData === 'markets_disabled' || callbackData === 'markets_page_info') {
        await ctx.answerCbQuery();
        return;
      }

      let page: number;
      
      // Parse different callback formats
      if (callbackData.startsWith('markets_prev_')) {
        page = parseInt(callbackData.replace('markets_prev_', ''));
      } else if (callbackData.startsWith('markets_next_')) {
        page = parseInt(callbackData.replace('markets_next_', ''));
      } else if (callbackData.startsWith('markets_page_')) {
        // Support old format for backward compatibility
        page = parseInt(callbackData.replace('markets_page_', ''));
      } else {
        await ctx.answerCbQuery();
        return;
      }
      
      // Show loading status
      await ctx.answerCbQuery('🔄 加载中...');
      
      // Get fresh market data
      const marketData = await this.fetchMarketData();
      
      // Validate page number
      const totalPages = Math.ceil(marketData.length / 10);
      if (page < 1 || page > totalPages) {
        await ctx.answerCbQuery('❌ 页码无效');
        return;
      }
      
      // Format message for requested page
      const formattedMessage = this.formatMarketMessage(marketData, page);
      const keyboard = this.createMarketsKeyboard(page, marketData.length);
      
      // Update message
      await ctx.editMessageText(formattedMessage, {
        parse_mode: 'HTML',
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