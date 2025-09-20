import { logger } from '../../utils/logger';
import { apiService } from '../../services/api.service';
import { cacheService } from '../../services/cache.service';
import { ExtendedContext } from '../index';
import { getUserAccessToken } from '../../utils/auth';
import { chartImageService, PositionsChartData, PositionInfo } from '../../services/chart-image.service';

/**
 * Position information interface
 */
interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: string;
  entryPrice: string;
  markPrice: string;
  pnl: string;
  pnlPercentage: string;
  marginUsed: string;
}

/**
 * Positions query response interface
 */
interface PositionsResponse {
  code: number;
  data: {
    positions: Position[];
    totalPositions: number;
    totalPnl: string;
    accountValue: string;
    availableBalance: string;
  };
  message: string;
}

/**
 * Positions query command handler
 * Handles user's /positions command, queries and displays all current open positions
 */
export class PositionsHandler {
  // private formatter: MessageFormatter; // 未使用，已注释
  // private validator: Validator; // 未使用，已注释
  private readonly cacheKey = 'tgbot:positions:';
  private readonly cacheTTL = 30; // 30秒缓存

  constructor() {
    // this.formatter = new MessageFormatter(); // 未使用，已注释
    // this.validator = new Validator(); // 未使用，已注释
  }

  /**
   * 处理 /positions 命令
   */
  public async handle(ctx: ExtendedContext, _args: string[]): Promise<void> {
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 命令入口日志
    logger.info(`Positions command started [${requestId}]`, {
      userId,
      username,
      chatId: ctx.chat?.id,
      requestId
    });

    if (!userId) {
      logger.error(`Positions command failed - no userId [${requestId}]`, { requestId });
      const userInfoError = await ctx.__!('trading.userInfoError');
      await ctx.reply(userInfoError);
      return;
    }

    // Send loading message
    const loadingMsg = await ctx.__!('positions.loading');
    const loadingMessage = await ctx.reply(loadingMsg);

    try {
      // 获取用户语言偏好
      const userLanguage = ctx.session?.language || ctx.from?.language_code || 'en';
      
      // 尝试从缓存获取数据
      logger.info(`Checking cache for positions [${requestId}]`, {
        userId,
        userLanguage,
        cacheKey: `${this.cacheKey}${userId}:${userLanguage}`,
        requestId
      });
      
      const cachedData = await this.getCachedPositions(userId, userLanguage);
      if (cachedData) {
        logger.info(`Using cached positions data [${requestId}]`, {
          userId,
          userLanguage,
          cachedDataLength: cachedData.length,
          requestId
        });
        
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMessage.message_id,
          undefined,
          cachedData,
          { parse_mode: 'HTML' }
        );
        return;
      } else {
        logger.info(`No cached positions data found [${requestId}]`, {
          userId,
          userLanguage,
          requestId
        });
      }

      // 从API获取数据，传递ctx用于fallback认证
      logger.info(`Fetching positions from API [${requestId}]`, {
        userId,
        apiEndpoint: '/api/tgbot/trading/positions',
        requestId
      });
      
      const positionsData = await this.fetchPositionsFromAPI(userId, ctx, requestId);
      
      logger.info(`API call successful, formatting message [${requestId}]`, {
        userId,
        totalPositions: positionsData.data.totalPositions,
        accountValue: positionsData.data.accountValue,
        availableBalance: positionsData.data.availableBalance,
        requestId
      });
      
      const formattedMessage = await this.formatPositionsMessage(positionsData, ctx);
      
      // 缓存结果
      await this.cachePositions(userId, formattedMessage, userLanguage);

      // 更新消息
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        loadingMessage.message_id,
        undefined,
        formattedMessage,
        { parse_mode: 'HTML' }
      );

      // 🔧 生成并发送Positions总览图表
      try {
        const chartData = this.preparePositionsChartData(positionsData);
        const chartImage = await chartImageService.generatePositionsChart(chartData);
        
        // 发送图表图片
        const chartCaption = await ctx.__!('positions.chartCaption');
        await ctx.replyWithPhoto({ source: chartImage.imageBuffer }, {
          caption: chartCaption,
          parse_mode: 'HTML'
        });
        
        logger.info('Positions chart sent successfully', {
          userId,
          totalValue: chartData.totalValue,
          positionsCount: chartData.positions.length
        });
      } catch (chartError) {
        logger.warn('Failed to generate positions chart', {
          userId,
          error: (chartError as Error).message
        });
        // 图表生成失败不影响主要功能
      }

    } catch (error) {
      logger.error(`Positions command failed [${requestId}]`, {
        error: (error as Error).message,
        errorStack: (error as Error).stack,
        userId,
        username,
        errorType: (error as Error).constructor?.name,
        requestId
      });
      
      const errorMessage = await this.handleError(error as Error, ctx, requestId);
      
      try {
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          loadingMessage.message_id,
          undefined,
          errorMessage,
          { parse_mode: 'HTML' }
        );
        
        logger.info(`Error message updated successfully [${requestId}]`, {
          userId,
          requestId
        });
      } catch (editError) {
        logger.warn(`Failed to edit message, sending new reply [${requestId}]`, {
          userId,
          editError: (editError as Error).message,
          requestId
        });
        
        await ctx.reply(errorMessage, { parse_mode: 'HTML' });
      }
    }
  }

  /**
   * 从API获取仓位数据
   */
  private async fetchPositionsFromAPI(userId: number, ctx?: ExtendedContext, requestId?: string): Promise<PositionsResponse> {
    const reqId = requestId || `pos_api_${Date.now()}`;
    
    logger.info(`Starting fetchPositionsFromAPI [${reqId}]`, {
      userId,
      hasContext: !!ctx,
      requestId: reqId
    });
    
    // 获取用户数据和访问令牌（统一调用，获取内部userId）
    const { getUserDataAndToken } = await import('../../utils/auth');
    const { userData, accessToken } = await getUserDataAndToken(userId.toString(), {
      username: ctx?.from?.username,
      first_name: ctx?.from?.first_name,
      last_name: ctx?.from?.last_name
    });
    
    logger.info(`🔍 User Data Check (positions):`, {
      telegramId: userId.toString(),
      internalUserId: userData.userId,
      userIdType: typeof userData.userId,
      accessTokenLength: accessToken?.length,
      hasAccessToken: !!accessToken
    });
    
    if (!accessToken) {
      logger.error(`No access token available [${reqId}]`, {
        userId,
        requestId: reqId
      });
      throw new Error('User not logged in, please use /start command to login first');
    }

    try {
      // 为positions接口也添加userId参数支持
      const positionsParams = {
        userId: userData.userId  // ✅ 添加内部用户ID
      };
      
      logger.info(`🚀 Positions API Call:`, {
        endpoint: '/api/tgbot/trading/positions',
        userId: userData.userId,
        hasToken: !!accessToken
      });

      const response = await apiService.getWithAuth<PositionsResponse>(
        '/api/tgbot/trading/positions',
        accessToken,
        positionsParams,  // ✅ 传递包含userId的参数
        { timeout: 10000 }
      );
      
      logger.info(`API response received [${reqId}]`, {
        userId,
        responseCode: response.code,
        responseMessage: response.message,
        hasData: !!response.data,
        requestId: reqId
      });

      // 🔍 详细记录API完整响应数据用于诊断数据不一致问题
      logger.info(`🔍 Complete API response analysis [${reqId}]`, {
        userId,
        fullResponse: JSON.stringify(response, null, 2),
        responseStructure: {
          hasCode: response.code !== undefined,
          hasMessage: response.message !== undefined,
          hasData: !!response.data,
          dataType: typeof response.data,
          dataKeys: response.data ? Object.keys(response.data) : []
        },
        specificDataAnalysis: response.data ? {
          positions: response.data.positions || 'missing',
          totalPositions: response.data.totalPositions || 'missing',
          totalPnl: response.data.totalPnl || 'missing',
          accountValue: response.data.accountValue || 'missing',
          availableBalance: response.data.availableBalance || 'missing',
          positionsLength: Array.isArray(response.data.positions) ? response.data.positions.length : 'not array'
        } : null,
        requestId: reqId
      });

      if (response.code !== 200) {
        logger.error(`API returned non-200 code [${reqId}]`, {
          userId,
          responseCode: response.code,
          responseMessage: response.message,
          fullResponse: JSON.stringify(response),
          requestId: reqId
        });
        throw new Error(response.message || 'Failed to get position information');
      }

      // 🔍 详细诊断：对比多个API数据源找出真正问题
      try {
        logger.info(`🔍 Starting comprehensive API data comparison [${reqId}]`, {
          userId,
          requestId: reqId
        });

        // 1. 并行调用所有相关API进行对比
        const [walletBalance, hyperliquidContract] = await Promise.all([
          (async () => {
            const walletService = await import('../../services/wallet.service');
            return await walletService.walletService.getAccountBalance(userId.toString());
          })(),
          (async () => {
            const hyperliquidService = await import('../../services/hyperliquid.service');
            return await hyperliquidService.getUserContractBalance(1, userId.toString());
          })()
        ]);

        // 2. 提取Hyperliquid原始数据
        const hyperliquidRawData = (hyperliquidContract.data as any)?.data || hyperliquidContract.data;
        const assetPositions = hyperliquidRawData?.assetPositions || [];
        const marginSummary = hyperliquidRawData?.marginSummary || {};

        // 3. 详细对比分析
        logger.info(`📊 Complete API data comparison analysis [${reqId}]`, {
          userId,
          
          // Positions API 数据
          positionsAPI: {
            endpoint: '/api/tgbot/trading/positions',
            totalPositions: response.data?.totalPositions || 'missing',
            accountValue: response.data?.accountValue || 'missing',
            availableBalance: response.data?.availableBalance || 'missing',
            positions: response.data?.positions || 'missing',
            hasPositionsArray: Array.isArray(response.data?.positions),
            positionsArrayLength: Array.isArray(response.data?.positions) ? response.data.positions.length : 'not array'
          },

          // Wallet API 数据
          walletAPI: {
            endpoint: '/api/hyperliquid/getUserState (via wallet)',
            nativeBalance: walletBalance.nativeBalance,
            withdrawableAmount: walletBalance.withdrawableAmount,
            totalUsdValue: walletBalance.totalUsdValue,
            address: walletBalance.address
          },

          // Hyperliquid 原始数据
          hyperliquidDirect: {
            endpoint: '/api/hyperliquid/getUserState (direct)',
            assetPositionsCount: assetPositions.length,
            accountValue: marginSummary.accountValue,
            totalMarginUsed: marginSummary.totalMarginUsed,
            withdrawable: hyperliquidRawData?.withdrawable,
            hasAssetPositions: assetPositions.length > 0,
            assetPositions: assetPositions.map((pos: any) => ({
              coin: pos.position?.coin,
              szi: pos.position?.szi,
              unrealizedPnl: pos.position?.unrealizedPnl,
              marginUsed: pos.position?.marginUsed
            }))
          },

          // 数据一致性分析
          consistencyAnalysis: {
            walletShowsFunds: walletBalance.nativeBalance > 0,
            hyperliquidShowsPositions: assetPositions.length > 0,
            positionsAPIShowsEmpty: (response.data?.totalPositions || 0) === 0,
            
            // 关键问题检测
            criticalInconsistency: {
              hyperliquidHasPositions: assetPositions.length > 0,
              positionsAPIReturnsZero: (response.data?.totalPositions || 0) === 0,
              problemDetected: assetPositions.length > 0 && (response.data?.totalPositions || 0) === 0
            },

            // 数值对比
            valueComparison: {
              hyperliquidAccountValue: marginSummary.accountValue,
              positionsAPIAccountValue: response.data?.accountValue,
              valuesMatch: marginSummary.accountValue === response.data?.accountValue,
              
              hyperliquidWithdrawable: hyperliquidRawData?.withdrawable,
              positionsAPIAvailable: response.data?.availableBalance,
              withdrawableMatch: hyperliquidRawData?.withdrawable === response.data?.availableBalance
            }
          },

          requestId: reqId
        });

        // 4. 如果发现关键不一致，记录详细的问题报告
        if (assetPositions.length > 0 && (response.data?.totalPositions || 0) === 0) {
          logger.error(`🚨 CRITICAL DATA INCONSISTENCY DETECTED [${reqId}]`, {
            userId,
            issue: 'Positions API returns zero positions but Hyperliquid shows active positions',
            
            hyperliquidTruthSource: {
              positionsCount: assetPositions.length,
              accountValue: marginSummary.accountValue,
              totalMarginUsed: marginSummary.totalMarginUsed,
              positions: assetPositions.map((pos: any) => `${pos.position.coin}: ${pos.position.szi}`)
            },

            positionsAPIWrongData: {
              totalPositions: response.data?.totalPositions,
              accountValue: response.data?.accountValue,
              availableBalance: response.data?.availableBalance
            },

            suggestedAction: 'Check /api/tgbot/trading/positions backend implementation',
            requestId: reqId
          });
        }

      } catch (comparisonError) {
        logger.error(`Failed to perform API comparison [${reqId}]`, {
          userId,
          error: (comparisonError as Error).message,
          errorStack: (comparisonError as Error).stack,
          requestId: reqId
        });
      }

      return response;
    } catch (apiError: any) {
      logger.error(`API call failed [${reqId}]`, {
        userId,
        errorMessage: apiError.message,
        errorStatus: apiError.response?.status,
        errorStatusText: apiError.response?.statusText,
        errorData: apiError.response?.data ? JSON.stringify(apiError.response.data) : 'no data',
        requestId: reqId
      });
      throw apiError;
    }
  }

  /**
   * Format positions information message
   */
  private async formatPositionsMessage(data: PositionsResponse, ctx: ExtendedContext): Promise<string> {
    const { positions, totalPositions, totalPnl, accountValue, availableBalance } = data.data;

    if (totalPositions === 0) {
      const overview = await ctx.__!('positions.overview');
      const accountInfo = await ctx.__!('positions.accountInfo');
      const accountValueLabel = await ctx.__!('positions.accountValue');
      const availableBalanceLabel = await ctx.__!('positions.availableBalance');
      const totalPnlLabel = await ctx.__!('positions.totalPnl');
      const positionCountLabel = await ctx.__!('positions.positionCount');
      const currentPositions = await ctx.__!('positions.currentPositions');
      const noPositions = await ctx.__!('positions.noPositions');
      const managePositions = await ctx.__!('positions.managePositions');
      const openLong = await ctx.__!('positions.manage.openLong');
      const openShort = await ctx.__!('positions.manage.openShort');
      const markets = await ctx.__!('positions.manage.markets');
      const queryTime = await ctx.__!('positions.queryTime');
      
      return `
<b>${overview}</b>

<b>${accountInfo}</b>
• ${accountValueLabel}    : $${parseFloat(accountValue).toFixed(2)}
• ${availableBalanceLabel}: $${parseFloat(availableBalance).toFixed(2)}
• ${totalPnlLabel}        : 🔘 $0.00
• ${positionCountLabel}   : 0

<b>${currentPositions}</b>
${noPositions}

<b>${managePositions}</b>
• ${openLong}
• ${openShort}
• ${markets}

<i>${queryTime} ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}</i>
      `.trim();
    }

    // Get translation labels for position details
    const longText = await ctx.__!('positions.long');
    const shortText = await ctx.__!('positions.short');
    const positionSizeLabel = await ctx.__!('positions.positionSize');
    const entryPriceLabel = await ctx.__!('positions.entryPrice');
    const markPriceLabel = await ctx.__!('positions.markPrice');
    const unrealizedPnlLabel = await ctx.__!('positions.unrealizedPnl');
    const marginUsedLabel = await ctx.__!('positions.marginUsed');
    
    let positionsText = '';
    positions.forEach((position, index) => {
      const sideIcon = position.side === 'long' ? '📈' : '📉';
      const sideText = position.side === 'long' ? longText : shortText;
      const pnlColor = parseFloat(position.pnl) >= 0 ? '🟢' : '🔴';
      const pnlPrefix = parseFloat(position.pnl) >= 0 ? '+' : '';
      
      // Format position size to remove unnecessary decimals
      const positionSize = Math.abs(parseFloat(position.size));
      const formattedSize = positionSize < 1 ? positionSize.toFixed(4) : positionSize.toFixed(2);
      
      positionsText += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${sideIcon} <b>${position.symbol} ${sideText}</b>
• ${positionSizeLabel}    : ${formattedSize} ${position.symbol}
• ${entryPriceLabel}      : $${parseFloat(position.entryPrice).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
• ${markPriceLabel}       : $${parseFloat(position.markPrice).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
• ${unrealizedPnlLabel}   : ${pnlColor} ${pnlPrefix}$${Math.abs(parseFloat(position.pnl)).toFixed(2)} (${pnlPrefix}${parseFloat(position.pnlPercentage).toFixed(2)}%)
• ${marginUsedLabel}      : $${parseFloat(position.marginUsed).toFixed(2)}
      `;
    });

    const totalPnlColor = parseFloat(totalPnl) >= 0 ? '🟢' : '🔴';
    const totalPnlPrefix = parseFloat(totalPnl) >= 0 ? '+' : '';

    // Get translation labels for the overview
    const overview = await ctx.__!('positions.overview');
    const accountInfo = await ctx.__!('positions.accountInfo');
    const accountValueLabel = await ctx.__!('positions.accountValue');
    const availableBalanceLabel = await ctx.__!('positions.availableBalance');
    const totalPnlLabel = await ctx.__!('positions.totalPnl');
    const positionCountLabel = await ctx.__!('positions.positionCount');
    const currentPositions = await ctx.__!('positions.currentPositions');
    const managePositions = await ctx.__!('positions.managePositions');
    const closePosition = await ctx.__!('positions.manage.close');
    const checkPrice = await ctx.__!('positions.manage.price');
    const viewChart = await ctx.__!('positions.manage.chart');
    const queryTime = await ctx.__!('positions.queryTime');

    return `
<b>${overview}</b>

<b>${accountInfo}</b>
• ${accountValueLabel}    : $${parseFloat(accountValue).toFixed(2)}
• ${availableBalanceLabel}: $${parseFloat(availableBalance).toFixed(2)}
• ${totalPnlLabel}        : ${totalPnlColor} ${totalPnlPrefix}$${Math.abs(parseFloat(totalPnl)).toFixed(2)}
• ${positionCountLabel}   : ${totalPositions}

<b>${currentPositions}</b>
${positionsText}

<b>${managePositions}</b>
• ${closePosition}
• ${checkPrice}
• ${viewChart}

<i>${queryTime} ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}</i>
    `.trim();
  }

  /**
   * Error handling
   */
  private async handleError(error: Error, ctx: ExtendedContext, requestId?: string): Promise<string> {
    const reqId = requestId || `error_${Date.now()}`;
    
    logger.error(`Handling positions error [${reqId}]`, { 
      error: error.message,
      errorType: error.constructor?.name,
      errorStack: error.stack,
      requestId: reqId
    });

    if (error.message.includes('not logged in')) {
      logger.info(`Authentication error detected [${reqId}]`, { requestId: reqId });
      const title = await ctx.__!('positions.errors.notLoggedIn.title');
      const description = await ctx.__!('positions.errors.notLoggedIn.description');
      const note = await ctx.__!('positions.errors.notLoggedIn.note');
      
      return `
<b>${title}</b>

${description}

<i>${note}</i>
      `.trim();
    }

    if (error.message.includes('network') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      logger.info(`Network error detected [${reqId}]`, { requestId: reqId });
      const title = await ctx.__!('positions.errors.network.title');
      const description = await ctx.__!('positions.errors.network.description');
      const note = await ctx.__!('positions.errors.network.note');
      
      return `
<b>${title}</b>

${description}

<i>${note}</i>
      `.trim();
    }

    // 判断是否为外部接口问题（API返回400/500等状态码）
    if (error.message.includes('status code 400') || (error as any).response?.status === 400) {
      logger.info(`API 400 error detected [${reqId}]`, { 
        errorStatus: (error as any).response?.status,
        errorData: (error as any).response?.data,
        requestId: reqId
      });
      
      const title = await ctx.__!('positions.errors.api400.title');
      const description = await ctx.__!('positions.errors.api400.description');
      const suggestions = await ctx.__!('positions.errors.api400.suggestions');
      const retry = await ctx.__!('positions.errors.api400.retry');
      const contact = await ctx.__!('positions.errors.api400.contact');
      const useWallet = await ctx.__!('positions.errors.api400.useWallet');
      const note = await ctx.__!('positions.errors.api400.note');
      const technical = await ctx.__!('positions.errors.api400.technical');
      
      return `
<b>${title}</b>

${description}

<b>${suggestions}</b>
${retry}
${contact}
${useWallet}

${note}

<b>${technical}</b> ${error.message}
      `.trim();
    }

    if (error.message.includes('status code 500') || error.message.includes('status code 502') || 
        error.message.includes('status code 503') || 
        (error as any).response?.status >= 500) {
      logger.info(`Server error detected [${reqId}]`, { 
        errorStatus: (error as any).response?.status,
        requestId: reqId
      });
      
      const title = await ctx.__!('positions.errors.server.title');
      const description = await ctx.__!('positions.errors.server.description');
      const suggestions = await ctx.__!('positions.errors.server.suggestions');
      const wait = await ctx.__!('positions.errors.server.wait');
      const checkOthers = await ctx.__!('positions.errors.server.checkOthers');
      const contactAdmin = await ctx.__!('positions.errors.server.contactAdmin');
      const note = await ctx.__!('positions.errors.server.note');
      
      return `
<b>${title}</b>

${description}

<b>${suggestions}</b>
${wait}
${checkOthers}
${contactAdmin}

${note}
      `.trim();
    }

    // Timeout error
    if (error.message.includes('timeout') || error.message.includes('ECONNABORTED')) {
      logger.info(`Timeout error detected [${reqId}]`, { requestId: reqId });
      const title = await ctx.__!('positions.errors.timeout.title');
      const description = await ctx.__!('positions.errors.timeout.description');
      const suggestions = await ctx.__!('positions.errors.timeout.suggestions');
      const retry = await ctx.__!('positions.errors.timeout.retry');
      const network = await ctx.__!('positions.errors.timeout.network');
      const note = await ctx.__!('positions.errors.timeout.note');
      
      return `
<b>${title}</b>

${description}

<b>${suggestions}</b>
${retry}
${network}

<i>${note}</i>
      `.trim();
    }

    logger.info(`Generic error, returning default message [${reqId}]`, { requestId: reqId });
    
    const title = await ctx.__!('positions.errors.generic.title');
    const description = await ctx.__!('positions.errors.generic.description');
    const details = await ctx.__!('positions.errors.generic.details');
    const requestIdLabel = await ctx.__!('positions.errors.generic.requestId');
    const note = await ctx.__!('positions.errors.generic.note');
    
    return `
<b>${title}</b>

${description}

<b>${details}</b> ${error.message}
<b>${requestIdLabel}</b> ${reqId}

<i>${note}</i>
    `.trim();
  }

  /**
   * 获取缓存的仓位数据
   */
  private async getCachedPositions(userId: number, userLanguage: string): Promise<string | null> {
    try {
      const key = `${this.cacheKey}${userId}:${userLanguage}`;
      
      logger.debug('Getting cached positions', {
        userId,
        userLanguage,
        cacheKey: key
      });
      
      const result = await cacheService.get<string>(key);
      
      if (result.success && result.data) {
        logger.debug('Found cached positions data', {
          userId,
          userLanguage,
          cacheKey: key,
          dataLength: result.data.length
        });
        return result.data;
      }
      
      logger.debug('No cached positions data found', {
        userId,
        userLanguage,
        cacheKey: key,
        cacheResult: result
      });
      
      return null;
    } catch (error) {
      logger.warn('Failed to get cached positions', { 
        error: (error as Error).message, 
        userId,
        userLanguage,
        cacheKey: `${this.cacheKey}${userId}:${userLanguage}`
      });
      return null;
    }
  }

  /**
   * 缓存仓位数据
   */
  private async cachePositions(userId: number, data: string, userLanguage: string): Promise<void> {
    try {
      const key = `${this.cacheKey}${userId}:${userLanguage}`;
      
      logger.debug('Caching positions data', {
        userId,
        userLanguage,
        cacheKey: key,
        dataLength: data.length,
        cacheTTL: this.cacheTTL
      });
      
      const result = await cacheService.set(key, data, this.cacheTTL);
      
      if (result.success) {
        logger.debug('Positions data cached successfully', {
          userId,
          userLanguage,
          cacheKey: key,
          cacheTTL: this.cacheTTL
        });
      } else {
        const errorMessage = result.error || 'Unknown cache error';
        // Redis配置问题不影响positions查询核心功能
        if (errorMessage.includes('Redis config issue')) {
          logger.debug('🔧 Redis config prevents caching positions, but query completed successfully');
        } else {
          logger.warn('Failed to cache positions data', {
            userId,
            userLanguage,
            cacheKey: key,
            cacheError: errorMessage
          });
        }
      }
    } catch (error) {
      logger.warn('Failed to cache positions', { 
        error: (error as Error).message, 
        userId,
        userLanguage,
        cacheKey: `${this.cacheKey}${userId}:${userLanguage}`
      });
    }
  }

  /**
   * 获取用户的访问令牌
   * 支持从缓存获取，如果没有则尝试重新认证并缓存
   */
  private async getUserAccessToken(userId: number, ctx?: ExtendedContext, requestId?: string): Promise<string | null> {
    const reqId = requestId || `token_${Date.now()}`;
    
    try {
      // 方案1: 从缓存中获取用户token
      const tokenKey = `user:token:${userId}`;
      
      logger.info(`Checking token cache [${reqId}]`, {
        userId,
        tokenKey,
        requestId: reqId
      });
      
      const result = await cacheService.get<string>(tokenKey);
      
      if (result.success && result.data) {
        logger.info(`AccessToken found in cache [${reqId}]`, { 
          userId, 
          tokenKey,
          tokenLength: result.data.length,
          requestId: reqId
        });
        return result.data;
      }

      logger.info(`AccessToken not in cache [${reqId}]`, {
        userId,
        cacheResult: result,
        requestId: reqId
      });

      // 方案2: 如果缓存中没有token，尝试通过用户信息重新获取
      if (ctx && ctx.from) {
        logger.info(`Attempting to re-authenticate user [${reqId}]`, { 
          userId,
          username: ctx.from.username,
          requestId: reqId
        });
        
        const userInfo = {
          username: ctx.from.username,
          first_name: ctx.from.first_name,
          last_name: ctx.from.last_name
        };

        try {
          const freshToken = await getUserAccessToken(userId.toString(), userInfo);
          
          logger.info(`Fresh token obtained [${reqId}]`, {
            userId,
            tokenLength: freshToken.length,
            requestId: reqId
          });
          
          // 将新获取的token缓存起来
          await this.cacheUserAccessToken(userId, freshToken, reqId);
          
          logger.info(`AccessToken re-authenticated and cached successfully [${reqId}]`, { 
            userId,
            requestId: reqId
          });
          return freshToken;
        } catch (authError) {
          logger.error(`Failed to re-authenticate user [${reqId}]`, {
            userId,
            error: (authError as Error).message,
            requestId: reqId
          });
        }
      } else {
        logger.warn(`No context available for re-authentication [${reqId}]`, {
          userId,
          hasCtx: !!ctx,
          hasFrom: !!(ctx?.from),
          requestId: reqId
        });
      }

      // 方案3: 如果所有方法都失败，返回null
      logger.error(`No access token available for user [${reqId}]`, { 
        userId,
        requestId: reqId
      });
      return null;

    } catch (error) {
      logger.error(`Failed to get user access token [${reqId}]`, { 
        error: (error as Error).message, 
        userId,
        requestId: reqId
      });
      return null;
    }
  }

  /**
   * 准备Positions图表数据
   */
  private preparePositionsChartData(positionsData: PositionsResponse): PositionsChartData {
    const { positions, totalPnl, accountValue, availableBalance } = positionsData.data;
    
    // 转换Position到PositionInfo格式
    const positionInfos: PositionInfo[] = positions.map(pos => ({
      symbol: pos.symbol,
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      markPrice: pos.markPrice,
      pnl: pos.pnl,
      pnlPercentage: pos.pnlPercentage,
      liquidationPrice: pos.marginUsed // 简化映射，实际可能需要计算
    }));

    // 计算总价值和变化
    const totalValue = parseFloat(accountValue);
    const totalPnlNum = parseFloat(totalPnl);
    
    // 计算变化百分比（简化计算）
    const totalChangePercentage = totalValue > 0 ? (totalPnlNum / totalValue) * 100 : 0;

    return {
      totalValue: totalValue,
      totalChange: totalPnlNum,
      totalChangePercentage: totalChangePercentage,
      positions: positionInfos,
      accountInfo: {
        availableBalance: availableBalance,
        usedMargin: positions.reduce((sum, pos) => sum + parseFloat(pos.marginUsed), 0).toString()
      }
    };
  }

  /**
   * 缓存用户的accessToken
   */
  private async cacheUserAccessToken(userId: number, accessToken: string, requestId?: string): Promise<void> {
    const reqId = requestId || `cache_token_${Date.now()}`;
    
    try {
      const tokenKey = `user:token:${userId}`;
      const tokenTTL = 24 * 60 * 60; // 24小时过期
      
      logger.info(`Caching access token [${reqId}]`, {
        userId,
        tokenKey,
        tokenLength: accessToken.length,
        expiresIn: tokenTTL,
        requestId: reqId
      });
      
      const result = await cacheService.set(tokenKey, accessToken, tokenTTL);
      
      if (result.success) {
        logger.info(`AccessToken cached successfully [${reqId}]`, {
          userId,
          tokenKey,
          expiresIn: tokenTTL,
          requestId: reqId
        });
      } else {
        const errorMessage = result.error || 'Unknown cache error';
        // Redis配置问题不影响token使用，只是下次需要重新获取
        if (errorMessage.includes('Redis config issue')) {
          logger.debug(`🔧 Redis config prevents token caching, but token is valid and usable [${reqId}]`);
        } else {
          logger.error(`Failed to cache accessToken [${reqId}]`, {
            userId,
            tokenKey,
            error: errorMessage,
            requestId: reqId
          });
        }
      }
    } catch (error) {
      logger.error(`Error caching accessToken [${reqId}]`, {
        userId,
        error: (error as Error).message,
        requestId: reqId
      });
    }
  }
}

// 导出处理器实例
export const positionsHandler = new PositionsHandler();
export default positionsHandler;