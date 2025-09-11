import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api.service';
import { cacheService } from '../../services/cache.service';
import { MessageFormatter } from '../utils/message.formatter';
import { Validator } from '../utils/validator';
import { ExtendedContext } from '../index';
import { getUserAccessToken } from '../../utils/auth';
import { chartImageService, PnlChartData, PnlDataPoint } from '../../services/chart-image.service';

/**
 * 交易记录接口
 */
interface Trade {
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: string;
  price: string;
  fee: string;
  timestamp: number;
  value: string;
}

/**
 * 统计数据接口
 */
interface Statistics {
  totalVolume: string;
  totalFees: string;
  buyTrades: number;
  sellTrades: number;
  averageTradeSize: string;
  tradingDays: number;
}

/**
 * 交易对统计接口
 */
interface SymbolBreakdown {
  symbol: string;
  trades: number;
  volume: string;
  fees: string;
  buyTrades: number;
  sellTrades: number;
}

/**
 * 日期统计接口
 */
interface DailyBreakdown {
  date: string;
  trades: number;
  volume: string;
  fees: string;
}

/**
 * PNL查询响应接口
 */
interface PnlResponse {
  code: number;
  data: {
    trades: Trade[];
    totalTrades: number;
    statistics: Statistics;
    symbolBreakdown: SymbolBreakdown[];
    dailyBreakdown: DailyBreakdown[];
  };
  message: string;
}

/**
 * PNL盈亏分析命令处理器
 * 处理用户的 /pnl 命令，查询并显示历史交易记录和盈亏统计分析
 */
export class PnlHandler {
  private formatter: MessageFormatter;
  private validator: Validator;
  private readonly cacheKey = 'tgbot:pnl:';
  private readonly cacheTTL = 60; // 60秒缓存（盈亏数据相对稳定）

  constructor() {
    this.formatter = new MessageFormatter();
    this.validator = new Validator();
  }

  /**
   * 处理 /pnl 命令
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply('❌ Unable to identify user');
      return;
    }

    // 发送加载消息
    const loadingMessage = await ctx.reply(
      '📊 Generating your PNL analysis report...\n' +
      '⏳ Please wait, calculating historical data'
    );

    try {
      // 尝试从缓存获取数据
      const cachedData = await this.getCachedPnl(userId);
      if (cachedData) {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMessage.message_id,
          undefined,
          cachedData,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 从API获取数据
      const pnlData = await this.fetchPnlFromAPI(userId, ctx);
      const formattedMessage = this.formatPnlMessage(pnlData);
      
      // 缓存结果
      await this.cachePnl(userId, formattedMessage);

      // 更新消息
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMessage.message_id,
        undefined,
        formattedMessage,
        { parse_mode: 'HTML' }
      );

      // 🔧 生成并发送PNL趋势图表
      try {
        if (pnlData.data.trades.length > 0) {
          const chartData = this.preparePnlChartData(pnlData);
          const chartImage = await chartImageService.generatePnlChart(chartData);
          
          // 发送图表图片
          await ctx.replyWithPhoto({ source: chartImage.imageBuffer }, {
            caption: '📈 PNL Trend Chart',
            parse_mode: 'HTML'
          });
          
          logger.info('PNL chart sent successfully', {
            userId,
            totalPnl: chartData.totalPnl,
            dataPoints: chartData.pnlHistory.length
          });
        }
      } catch (chartError) {
        logger.warn('Failed to generate PNL chart', {
          userId,
          error: (chartError as Error).message
        });
        // 图表生成失败不影响主要功能
      }

    } catch (error) {
      const errorMessage = this.handleError(error as Error);
      
      try {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMessage.message_id,
          undefined,
          errorMessage,
          { parse_mode: 'HTML' }
        );
      } catch (editError) {
        await ctx.reply(errorMessage, { parse_mode: 'HTML' });
      }

      logger.error('PNL command failed', {
        error: (error as Error).message,
        userId,
        requestId: ctx.requestId
      });
    }
  }

  /**
   * 从API获取PNL数据
   */
  private async fetchPnlFromAPI(userId: number, ctx?: ExtendedContext): Promise<PnlResponse> {
    // 获取用户的access token，支持fallback重新认证
    const userToken = await this.getUserAccessToken(userId, ctx);
    
    if (!userToken) {
      throw new Error('User not logged in, please use /start command to login first');
    }

    const response = await apiService.getWithAuth<PnlResponse>(
      '/api/tgbot/trading/pnl',
      userToken,
      {},
      { timeout: 15000 } // 增加超时时间，因为数据计算较复杂
    );

    // 🔧 详细记录API响应用于诊断
    logger.info('PNL API Response - Full Debug', {
      userId,
      responseCode: response.code,
      responseMessage: response.message,
      dataStructure: {
        hasTrades: response.data?.trades ? true : false,
        tradesCount: response.data?.trades?.length || 0,
        totalTrades: response.data?.totalTrades || 0,
        hasStatistics: response.data?.statistics ? true : false,
        hasSymbolBreakdown: response.data?.symbolBreakdown ? true : false,
        hasDailyBreakdown: response.data?.dailyBreakdown ? true : false
      },
      // 记录前3笔交易的详细信息用于调试
      sampleTrades: response.data?.trades?.slice(0, 3).map(trade => ({
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        quantityType: typeof trade.quantity,
        price: trade.price,
        priceType: typeof trade.price,
        fee: trade.fee,
        timestamp: trade.timestamp,
        value: trade.value
      })) || [],
      fullResponse: JSON.stringify(response, null, 2)
    });

    if (response.code !== 200) {
      throw new Error(response.message || 'Failed to get PNL analysis');
    }


    return response;
  }

  /**
   * 格式化PNL分析消息
   */
  private formatPnlMessage(data: PnlResponse): string {
    const { totalTrades, statistics } = data.data;

    // If no trading records
    if (totalTrades === 0) {
      return `
📊 <b>PNL Analysis Report</b>

📈 <b>Trading Statistics:</b>
• Total Trades: 0
• Volume: $0.00
• Fees: $0.00
• Trading Days: 0

<i>🕐 Analysis time: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })}</i>
      `.trim();
    }

    // Generate simple PNL analysis report
    let analysisMessage = `
📊 <b>PNL Analysis Report</b>

📈 <b>Trading Statistics:</b>
• Total Trades: ${totalTrades.toLocaleString()}
• Total Volume: $${this.formatNumber(statistics.totalVolume)}
• Total Fees: $${this.formatNumber(statistics.totalFees)}
• Trading Days: ${statistics.tradingDays} days

<i>🕐 Analysis time: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })}</i>
    `.trim();

    return analysisMessage;
  }




  /**
   * 数字格式化工具
   */
  private formatNumber(value: string | number): string {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    
    if (isNaN(num)) {
      return '0.00';
    }

    // 大数值使用K, M简写
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(2) + 'K';
    } else if (num >= 1) {
      return num.toFixed(2);
    } else {
      return num.toFixed(4);
    }
  }


  /**
   * 错误处理
   */
  private handleError(error: Error): string {
    logger.error('PNL handler error:', { error: error.message });

    if (error.message.includes('未登录') || error.message.includes('not logged in')) {
      return '❌ Please use /start to login first';
    }

    return '❌ Analysis failed, please try again later';
  }

  /**
   * 获取缓存的PNL数据
   */
  private async getCachedPnl(userId: number): Promise<string | null> {
    try {
      const key = `${this.cacheKey}${userId}`;
      const result = await cacheService.get<string>(key);
      if (result.success && result.data) {
        return result.data;
      }
      return null;
    } catch (error) {
      logger.warn('Failed to get cached pnl', { error: (error as Error).message, userId });
      return null;
    }
  }

  /**
   * 缓存PNL数据
   */
  private async cachePnl(userId: number, data: string): Promise<void> {
    try {
      const key = `${this.cacheKey}${userId}`;
      await cacheService.set(key, data, this.cacheTTL);
    } catch (error) {
      logger.warn('Failed to cache pnl', { error: (error as Error).message, userId });
    }
  }

  /**
   * 获取用户的访问令牌
   * 支持从缓存获取，如果没有则尝试重新认证并缓存
   */
  private async getUserAccessToken(userId: number, ctx?: ExtendedContext): Promise<string | null> {
    try {
      // 方案1: 从缓存中获取用户token
      const tokenKey = `user:token:${userId}`;
      const result = await cacheService.get<string>(tokenKey);
      
      if (result.success && result.data) {
        logger.debug('AccessToken found in cache', { userId, tokenKey });
        return result.data;
      }

      // 方案2: 如果缓存中没有token，尝试通过用户信息重新获取
      if (ctx && ctx.from) {
        logger.info('AccessToken not in cache, attempting to re-authenticate', { userId });
        
        const userInfo = {
          username: ctx.from.username,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name
        };

        try {
          const freshToken = await getUserAccessToken(userId.toString(), userInfo);
          
          // 将新获取的token缓存起来
          await this.cacheUserAccessToken(userId, freshToken);
          
          logger.info('AccessToken re-authenticated and cached successfully', { userId });
          return freshToken;
        } catch (authError) {
          logger.warn('Failed to re-authenticate user', {
            userId,
            error: (authError as Error).message
          });
        }
      }

      // 方案3: 如果所有方法都失败，返回null
      logger.warn('No access token available for user', { userId });
      return null;

    } catch (error) {
      logger.error('Failed to get user access token', { 
        error: (error as Error).message, 
        userId 
      });
      return null;
    }
  }

  /**
   * 准备PNL图表数据
   */
  private preparePnlChartData(pnlData: PnlResponse): PnlChartData {
    const trades = pnlData.data.trades;
    
    // 按时间排序交易记录
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    
    // 计算累计PNL历史
    let cumulativePnl = 0;
    const pnlHistory: PnlDataPoint[] = [];
    
    // 添加起始点 (第一笔交易前的0点)
    if (sortedTrades.length > 0) {
      pnlHistory.push({
        x: sortedTrades[0].timestamp * 1000,
        y: 0
      });
    }
    
    for (const trade of sortedTrades) {
      // 计算这笔交易的PNL影响 (简化计算，实际应该考虑买卖方向和价格差)
      const tradeValue = parseFloat(trade.value);
      const tradeFee = parseFloat(trade.fee);
      
      // 买入为负现金流，卖出为正现金流
      if (trade.side === 'buy') {
        cumulativePnl -= (tradeValue + tradeFee);
      } else {
        cumulativePnl += (tradeValue - tradeFee);
      }
      
      pnlHistory.push({
        x: trade.timestamp * 1000,
        y: cumulativePnl
      });
    }
    
    // 计算总PNL (使用统计数据)
    const statistics = pnlData.data.statistics;
    const totalVolume = parseFloat(statistics.totalVolume);
    const totalFees = parseFloat(statistics.totalFees);
    
    // 估算总PNL (这里使用简化计算，实际需要更精确的计算)
    const finalPnl = cumulativePnl;
    
    return {
      totalPnl: finalPnl,
      pnlHistory: pnlHistory,
      timeRange: {
        start: sortedTrades[0]?.timestamp * 1000 || Date.now(),
        end: sortedTrades[sortedTrades.length - 1]?.timestamp * 1000 || Date.now()
      }
    };
  }

  /**
   * 缓存用户的accessToken
   */
  private async cacheUserAccessToken(userId: number, accessToken: string): Promise<void> {
    try {
      const tokenKey = `user:token:${userId}`;
      const tokenTTL = 24 * 60 * 60; // 24小时过期
      
      const result = await cacheService.set(tokenKey, accessToken, tokenTTL);
      
      if (result.success) {
        logger.debug('AccessToken cached in pnl handler', {
          userId,
          tokenKey,
          expiresIn: tokenTTL
        });
      } else {
        logger.warn('Failed to cache accessToken in pnl handler', {
          userId,
          tokenKey,
          error: result.error
        });
      }
    } catch (error) {
      logger.error('Error caching accessToken in pnl handler', {
        userId,
        error: (error as Error).message
      });
    }
  }
}

// 导出处理器实例
export const pnlHandler = new PnlHandler();
export default pnlHandler;