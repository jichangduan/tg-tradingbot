import { Context } from 'telegraf';
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api.service';
import { cacheService } from '../../services/cache.service';
import { MessageFormatter } from '../utils/message.formatter';
import { Validator } from '../utils/validator';
import { ExtendedContext } from '../index';
import { chartImageService, PnlChartData, PnlDataPoint } from '../../services/chart-image.service';

/**
 * 增强的交易记录接口（包含真实PnL数据）
 */
interface EnhancedTrade {
  tradeId: number;
  symbol: string;
  side: 'buy' | 'sell';
  size: string;
  price: string;
  fee: string;
  timestamp: number;
  date: string;
  value: string;
  closedPnl: string;        // 平仓盈亏
  realizedPnl: number;      // 已实现盈亏
  direction: string;        // 交易方向
  startPosition: number;    // 起始持仓
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
 * PNL查询响应接口（真实PnL数据格式）
 */
interface PnlResponse {
  code: number;
  data: {
    trades: EnhancedTrade[];       // 增强的交易记录
    totalTrades: number;
    totalRealizedPnl: string;      // 总已实现盈亏
    profitableTrades: number;      // 盈利交易数
    losingTrades: number;          // 亏损交易数
    winRate: string;               // 胜率
    dataSource: string;            // 数据源标识
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
      const userInfoError = await ctx.__!('trading.userInfoError');
      await ctx.reply(userInfoError);
      return;
    }

    // 发送加载消息
    const loadingMsg = await ctx.__!('pnl.loading');
    const loadingMessage = await ctx.reply(loadingMsg);

    try {
      // 获取用户语言偏好
      const userLanguage = ctx.session?.language || ctx.from?.language_code || 'en';
      
      // 尝试从缓存获取数据
      const cachedData = await this.getCachedPnl(userId, userLanguage);
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
      const formattedMessage = await this.formatPnlMessage(pnlData, ctx);
      
      // 缓存结果
      await this.cachePnl(userId, formattedMessage, userLanguage);

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
          const chartCaption = await ctx.__!('pnl.chartCaption');
          await ctx.replyWithPhoto({ source: chartImage.imageBuffer }, {
            caption: chartCaption,
            parse_mode: 'HTML'
          });
          
          logger.info('Enhanced PNL chart sent successfully', {
            userId,
            totalRealizedPnl: chartData.totalPnl,
            dataPoints: chartData.pnlHistory.length,
            dataSource: pnlData.data.dataSource
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
      let errorMessage: string;
      
      if ((error as Error).message.includes('未登录') || (error as Error).message.includes('not logged in')) {
        errorMessage = await ctx.__!('trading.loginRequired');
      } else {
        errorMessage = await ctx.__!('pnl.error');
      }
      
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
    // 获取用户完整数据和access token
    const { getUserDataAndToken } = await import('../../utils/auth');
    const { userData, accessToken } = await getUserDataAndToken(userId.toString(), {
      username: ctx?.from?.username,
      first_name: ctx?.from?.first_name,
      last_name: ctx?.from?.last_name
    });

    // 使用内部用户ID调用API
    const pnlParams = {
      userId: userData.userId  // 使用内部用户ID而不是Telegram ID
    };

    logger.info('🚀 PNL API Call:', {
      endpoint: '/api/tgbot/trading/pnl',
      telegramId: userId,
      internalUserId: userData.userId,
      internalUserIdType: typeof userData.userId,
      params: pnlParams
    });

    const response = await apiService.getWithAuth<PnlResponse>(
      '/api/tgbot/trading/pnl',
      accessToken,
      pnlParams,
      { timeout: 15000 } // 增加超时时间，因为数据计算较复杂
    );

    // 🔧 详细记录API响应用于诊断
    logger.info('PNL API Response - Enhanced PnL Data Debug', {
      userId,
      responseCode: response.code,
      responseMessage: response.message,
      enhancedPnlData: {
        totalTrades: response.data?.totalTrades || 0,
        totalRealizedPnl: response.data?.totalRealizedPnl || null,
        profitableTrades: response.data?.profitableTrades || 0,
        losingTrades: response.data?.losingTrades || 0,
        winRate: response.data?.winRate || null,
        dataSource: response.data?.dataSource || null,
        hasTradesData: response.data?.trades ? true : false,
        tradesCount: response.data?.trades?.length || 0
      },
      dataStructure: {
        hasStatistics: response.data?.statistics ? true : false,
        hasSymbolBreakdown: response.data?.symbolBreakdown ? true : false,
        hasDailyBreakdown: response.data?.dailyBreakdown ? true : false
      },
      // 记录前3笔交易的增强PnL信息用于调试
      sampleEnhancedTrades: response.data?.trades?.slice(0, 3).map(trade => ({
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        side: trade.side,
        size: trade.size,
        price: trade.price,
        closedPnl: trade.closedPnl,
        realizedPnl: trade.realizedPnl,
        direction: trade.direction,
        timestamp: trade.timestamp,
        date: trade.date
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
  private async formatPnlMessage(data: PnlResponse, ctx: ExtendedContext): Promise<string> {
    const { 
      trades, 
      totalTrades, 
      totalRealizedPnl, 
      profitableTrades, 
      losingTrades, 
      winRate,
      dataSource,
      statistics 
    } = data.data;

    // 🔧 计算盈亏统计（如果API没有提供，则手动计算）
    let calculatedProfitableTrades = profitableTrades;
    let calculatedLosingTrades = losingTrades;  
    let calculatedWinRate = winRate;
    
    // 如果API没有返回统计数据，则从交易记录中计算
    if (profitableTrades === undefined || losingTrades === undefined || winRate === undefined) {
      const profitableCount = trades.filter(trade => trade.realizedPnl > 0).length;
      const losingCount = trades.filter(trade => trade.realizedPnl < 0).length;
      const totalCount = totalTrades || trades.length;
      
      calculatedProfitableTrades = profitableCount;
      calculatedLosingTrades = losingCount;
      calculatedWinRate = totalCount > 0 ? ((profitableCount / totalCount) * 100).toFixed(2) + '%' : '0%';
    }

    // 🔧 添加增强PnL数据处理日志
    logger.info('Enhanced PNL Data Processing', {
      totalTrades,
      totalRealizedPnl,
      originalWinRate: winRate,
      calculatedWinRate,
      originalProfitableTrades: profitableTrades,
      calculatedProfitableTrades,
      originalLosingTrades: losingTrades,
      calculatedLosingTrades,
      dataSource
    });

    // If no trading records
    if (totalTrades === 0) {
      const title = await ctx.__!('pnl.noRecords.title');
      const summary = await ctx.__!('pnl.noRecords.summary');
      const totalPnl = await ctx.__!('pnl.noRecords.totalPnl');
      const winRate = await ctx.__!('pnl.noRecords.winRate');
      const totalTradesText = await ctx.__!('pnl.noRecords.totalTrades');
      const statistics = await ctx.__!('pnl.noRecords.statistics');
      const volume = await ctx.__!('pnl.noRecords.volume');
      const fees = await ctx.__!('pnl.noRecords.fees');
      const days = await ctx.__!('pnl.noRecords.days');
      const dataSource = await ctx.__!('pnl.dataSource');
      const realPnlSource = await ctx.__!('pnl.realPnlSource');
      const analysisTime = await ctx.__!('pnl.analysisTime');
      
      return `
<b>${title}</b>

<b>${summary}</b>
• ${totalPnl}
• ${winRate}
• ${totalTradesText}

<b>${statistics}</b>
• ${volume}
• ${fees}
• ${days}

<i>${dataSource} ${realPnlSource}</i>
<i>${analysisTime} ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })}</i>
      `.trim();
    }

    // Generate enhanced PNL analysis report with real realized PnL data
    const reportTitle = await ctx.__!('pnl.analysisReport');
    const realizedSummary = await ctx.__!('pnl.realizedSummary');
    const totalRealizedLabel = await ctx.__!('pnl.totalRealized');
    const winRateLabel = await ctx.__!('pnl.winRate');
    const profitableTradesLabel = await ctx.__!('pnl.profitableTrades');
    const losingTradesLabel = await ctx.__!('pnl.losingTrades');
    const tradingStatistics = await ctx.__!('pnl.tradingStatistics');
    const totalVolumeLabel = await ctx.__!('pnl.totalVolume');
    const totalFeesLabel = await ctx.__!('pnl.totalFees');
    const tradingDaysLabel = await ctx.__!('pnl.tradingDays');
    const dataSourceLabel = await ctx.__!('pnl.dataSource');
    const realPnlSource = await ctx.__!('pnl.realPnlSource');
    const analysisTimeLabel = await ctx.__!('pnl.analysisTime');
    
    let analysisMessage = `
<b>${reportTitle}</b>

<b>${realizedSummary}</b>
• ${totalRealizedLabel} $${this.formatNumber(totalRealizedPnl)}
• ${winRateLabel} ${calculatedWinRate}
• ${profitableTradesLabel} ${calculatedProfitableTrades}/${totalTrades}
• ${losingTradesLabel} ${calculatedLosingTrades}/${totalTrades}

<b>${tradingStatistics}</b>
• ${totalVolumeLabel} $${this.formatNumber(statistics.totalVolume)}
• ${totalFeesLabel} $${this.formatNumber(statistics.totalFees)}
• ${tradingDaysLabel} ${statistics.tradingDays} days

<i>${dataSourceLabel} ${dataSource || realPnlSource}</i>
<i>${analysisTimeLabel} ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })}</i>
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
   * 获取缓存的PNL数据
   */
  private async getCachedPnl(userId: number, userLanguage: string): Promise<string | null> {
    try {
      const key = `${this.cacheKey}${userId}:${userLanguage}`;
      const result = await cacheService.get<string>(key);
      if (result.success && result.data) {
        return result.data;
      }
      return null;
    } catch (error) {
      logger.warn('Failed to get cached pnl', { error: (error as Error).message, userId, userLanguage });
      return null;
    }
  }

  /**
   * 缓存PNL数据
   */
  private async cachePnl(userId: number, data: string, userLanguage: string): Promise<void> {
    try {
      const key = `${this.cacheKey}${userId}:${userLanguage}`;
      await cacheService.set(key, data, this.cacheTTL);
    } catch (error) {
      logger.warn('Failed to cache pnl', { error: (error as Error).message, userId, userLanguage });
    }
  }


  /**
   * 准备PNL图表数据（使用真实已实现PnL）
   */
  private preparePnlChartData(pnlData: PnlResponse): PnlChartData {
    const trades = pnlData.data.trades;
    
    // 按时间排序交易记录
    const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    
    // 存储图表数据点
    const pnlDataPoints: PnlDataPoint[] = [];
    
    // 🔧 检测时间戳格式并标准化为毫秒
    const normalizeTimestamp = (timestamp: number): number => {
      // 如果时间戳小于13位，假设是秒，转换为毫秒
      if (timestamp < 10000000000000) {
        return timestamp * 1000;
      }
      // 否则已经是毫秒，直接使用
      return timestamp;
    };

    // 🔧 筛选关键交易节点（重要盈亏交易）
    const isSignificantTrade = (trade: EnhancedTrade): boolean => {
      return (
        Math.abs(trade.realizedPnl) >= 5 ||  // 盈亏大于等于$5
        trade.direction.includes('Close') ||  // 平仓交易
        trade.direction.includes('Open')      // 开仓交易
      );
    };

    // 先计算所有交易的累计PnL映射
    const cumulativePnlMap = new Map<number, number>();
    let runningPnl = 0;
    
    for (const trade of sortedTrades) {
      runningPnl += trade.realizedPnl;
      cumulativePnlMap.set(trade.tradeId, runningPnl);
    }

    // 筛选关键交易节点
    const significantTrades = sortedTrades.filter(isSignificantTrade);
    
    // 确保包含第一笔和最后一笔交易
    const keyTrades = [...new Set([
      sortedTrades[0],  // 第一笔交易
      ...significantTrades,  // 重要交易
      sortedTrades[sortedTrades.length - 1]  // 最后一笔交易
    ])].filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);

    logger.info('Key Trades Selection', {
      totalTrades: sortedTrades.length,
      significantTrades: significantTrades.length,
      keyTradesSelected: keyTrades.length,
      criteriaUsed: 'realizedPnl >= $5 OR Close/Open trades'
    });

    // 添加起始点 (第一笔交易前的0点)
    if (keyTrades.length > 0) {
      const firstTimestamp = normalizeTimestamp(keyTrades[0].timestamp);
      pnlDataPoints.push({
        x: firstTimestamp,
        y: 0
      });
      
      logger.debug('Chart Start Point', {
        originalTimestamp: keyTrades[0].timestamp,
        normalizedTimestamp: firstTimestamp,
        date: new Date(firstTimestamp).toISOString()
      });
    }
    
    // 只为关键交易创建图表数据点
    for (const trade of keyTrades) {
      const cumulativePnlAtTrade = cumulativePnlMap.get(trade.tradeId) || 0;
      const normalizedTimestamp = normalizeTimestamp(trade.timestamp);
      
      pnlDataPoints.push({
        x: normalizedTimestamp,
        y: cumulativePnlAtTrade
      });
      
      // 🔧 记录关键交易节点
      logger.debug('Key PnL Chart Data Point', {
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        direction: trade.direction,
        realizedPnl: trade.realizedPnl,
        cumulativePnlAtTrade: cumulativePnlAtTrade,
        isSignificant: isSignificantTrade(trade),
        originalTimestamp: trade.timestamp,
        normalizedTimestamp: normalizedTimestamp,
        date: trade.date,
        formattedDate: new Date(normalizedTimestamp).toISOString()
      });
    }
    
    // 使用API返回的总已实现PnL值
    const totalRealizedPnl = parseFloat(pnlData.data.totalRealizedPnl);
    
    const finalCumulativePnl = runningPnl; // 使用计算出的最终累计PnL
    
    logger.info('PnL Chart Preparation Complete', {
      totalTrades: sortedTrades.length,
      keyTradesUsed: keyTrades.length,
      totalDataPoints: pnlDataPoints.length,
      finalCumulativePnl: finalCumulativePnl,
      apiTotalRealizedPnl: totalRealizedPnl,
      dataConsistency: Math.abs(finalCumulativePnl - totalRealizedPnl) < 0.01 ? 'consistent' : 'inconsistent',
      timeSpan: keyTrades.length > 0 ? {
        start: new Date(normalizeTimestamp(keyTrades[0].timestamp)).toISOString(),
        end: new Date(normalizeTimestamp(keyTrades[keyTrades.length - 1].timestamp)).toISOString()
      } : null
    });
    
    return {
      totalPnl: totalRealizedPnl,
      pnlHistory: pnlDataPoints,
      timeRange: {
        start: keyTrades[0] ? normalizeTimestamp(keyTrades[0].timestamp) : Date.now(),
        end: keyTrades[keyTrades.length - 1] ? normalizeTimestamp(keyTrades[keyTrades.length - 1].timestamp) : Date.now()
      }
    };
  }

}

// 导出处理器实例
export const pnlHandler = new PnlHandler();
export default pnlHandler;