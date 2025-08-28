import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api.service';
import { messageFormatter } from '../utils/message.formatter';

/**
 * 市场数据接口响应类型
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
 * 市场数据命令处理器
 * 处理 /markets 命令，显示主要加密货币的市场行情
 */
export class MarketsHandler {

  constructor() {
  }

  /**
   * 处理/markets命令
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
      // 发送加载中消息
      const loadingMessage = await ctx.reply('🔍 正在获取市场数据...');
      
      // 获取市场数据
      const marketData = await this.fetchMarketData();
      
      // 格式化市场数据消息
      const formattedMessage = this.formatMarketMessage(marketData);
      
      // 编辑消息显示结果
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMessage.message_id,
        undefined,
        formattedMessage,
        { parse_mode: 'Markdown' }
      );

      logger.info('Markets data sent successfully', {
        userId,
        dataCount: marketData.length
      });

    } catch (error) {
      logger.error('Failed to handle markets command', {
        userId,
        username,
        error: (error as Error).message
      });

      // 发送友好的错误消息
      await ctx.reply(
        '❌ 查询失败\n\n' +
        '获取市场数据时出现错误，请稍后重试。',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * 从API获取市场数据
   */
  private async fetchMarketData(): Promise<MarketData[]> {
    try {
      logger.debug('Fetching market data from API');
      
      const response = await apiService.get<MarketDataResponse>(
        '/api/home/getLargeMarketData'
      );

      // 验证响应格式
      if (!response || response.code !== 200 || !Array.isArray(response.data)) {
        throw new Error(`Invalid API response format: ${JSON.stringify(response).substring(0, 200)}`);
      }

      // 验证数据完整性
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
   * 格式化市场数据为Telegram消息
   */
  private formatMarketMessage(marketData: MarketData[]): string {
    try {
      // 消息头
      let message = '🏪 *主要加密货币市场行情*\n\n';
      
      // 添加每个币种的信息
      marketData.forEach((coin, index) => {
        const changeEmoji = this.getChangeEmoji(coin.change);
        const changeText = this.formatChangeText(coin.change);
        const priceText = this.formatPrice(coin.price);
        
        message += `${index + 1}. *${coin.name}*\n`;
        message += `   💰 $${priceText}\n`;
        message += `   ${changeEmoji} ${changeText}\n\n`;
      });

      // 添加更新时间
      const updateTime = new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false
      });
      message += `\n⏰ 更新时间: ${updateTime}`;
      
      // 添加使用提示
      message += '\n\n💡 使用 `/price <币种>` 查看详细价格信息';

      return message;

    } catch (error) {
      logger.error('Failed to format market message', {
        error: (error as Error).message,
        dataCount: marketData.length
      });
      throw new Error('消息格式化失败');
    }
  }

  /**
   * 根据涨跌幅获取表情符号
   */
  private getChangeEmoji(change: number): string {
    if (change > 0) return '📈';
    if (change < 0) return '📉';
    return '➡️';
  }

  /**
   * 格式化涨跌幅文本
   */
  private formatChangeText(change: number): string {
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}%`;
  }

  /**
   * 格式化价格显示
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
   * 健康检查 - 测试市场数据接口是否正常
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

// 导出单例实例
export const marketsHandler = new MarketsHandler();

// 默认导出
export default marketsHandler;