// import { Context } from 'telegraf'; // 未使用，已注释
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api.service';
import { cacheService } from '../../services/cache.service';
// import { MessageFormatter } from '../utils/message.formatter'; // 未使用，已注释
// import { Validator } from '../utils/validator'; // 未使用，已注释
import { ExtendedContext } from '../index';
import { getUserAccessToken } from '../../utils/auth';
import { chartImageService, PositionsChartData, PositionInfo } from '../../services/chart-image.service';

/**
 * 仓位信息接口
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
 * 仓位查询响应接口
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
 * 仓位查询命令处理器
 * 处理用户的 /positions 命令，查询并显示当前所有开放仓位
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
      await ctx.reply('❌ 无法识别用户身份');
      return;
    }

    // 发送加载消息
    const loadingMessage = await ctx.reply(
      '🔍 正在查询您的持仓信息...\n' +
      '⏳ 请稍候，正在获取最新数据'
    );

    try {
      // 尝试从缓存获取数据
      logger.info(`Checking cache for positions [${requestId}]`, {
        userId,
        cacheKey: `${this.cacheKey}${userId}`,
        requestId
      });
      
      const cachedData = await this.getCachedPositions(userId);
      if (cachedData) {
        logger.info(`Using cached positions data [${requestId}]`, {
          userId,
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
      
      const formattedMessage = this.formatPositionsMessage(positionsData);
      
      // 缓存结果
      await this.cachePositions(userId, formattedMessage);

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
        await ctx.replyWithPhoto({ source: chartImage.imageBuffer }, {
          caption: '📊 持仓总览图表',
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
      
      const errorMessage = this.handleError(error as Error, requestId);
      
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
    
    // 获取用户的access token，支持fallback重新认证
    logger.info(`Getting user access token [${reqId}]`, {
      userId,
      requestId: reqId
    });
    
    const userToken = await this.getUserAccessToken(userId, ctx, reqId);
    
    if (!userToken) {
      logger.error(`No access token available [${reqId}]`, {
        userId,
        requestId: reqId
      });
      throw new Error('用户未登录，请先使用 /start 命令登录');
    }
    
    logger.info(`Access token obtained, making API call [${reqId}]`, {
      userId,
      tokenLength: userToken.length,
      apiUrl: '/api/tgbot/trading/positions',
      requestId: reqId
    });

    try {
      const response = await apiService.getWithAuth<PositionsResponse>(
        '/api/tgbot/trading/positions',
        userToken,
        {},
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
        throw new Error(response.message || '获取仓位信息失败');
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
   * 格式化仓位信息消息
   */
  private formatPositionsMessage(data: PositionsResponse): string {
    const { positions, totalPositions, totalPnl, accountValue, availableBalance } = data.data;

    if (totalPositions === 0) {
      return `
📊 <b>持仓概览</b>

💰 <b>账户信息:</b>
• 账户价值: $${accountValue}
• 可用余额: $${availableBalance}
• 持仓数量: 0

📈 <b>当前持仓:</b>
暂无持仓

💡 <i>您可以使用以下命令开仓:</i>
• <code>/long BTC 10x 100</code> - 做多BTC
• <code>/short ETH 5x 50</code> - 做空ETH
• <code>/markets</code> - 查看市场行情

<i>🕐 查询时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</i>
      `.trim();
    }

    let positionsText = '';
    positions.forEach((position, index) => {
      const sideIcon = position.side === 'long' ? '📈' : '📉';
      const sideText = position.side === 'long' ? '做多' : '做空';
      const pnlColor = parseFloat(position.pnl) >= 0 ? '🟢' : '🔴';
      const pnlPrefix = parseFloat(position.pnl) >= 0 ? '+' : '';
      
      positionsText += `
${sideIcon} <b>${position.symbol} ${sideText}</b>
• 仓位大小: ${Math.abs(parseFloat(position.size)).toFixed(4)}
• 开仓价格: $${parseFloat(position.entryPrice).toFixed(4)}
• 标记价格: $${parseFloat(position.markPrice).toFixed(4)}
• 未实现盈亏: ${pnlColor} ${pnlPrefix}$${position.pnl} (${pnlPrefix}${position.pnlPercentage}%)
• 占用保证金: $${position.marginUsed}
${index < positions.length - 1 ? '\n━━━━━━━━━━━━━━━━━━━━\n' : ''}
      `.trim();
    });

    const totalPnlColor = parseFloat(totalPnl) >= 0 ? '🟢' : '🔴';
    const totalPnlPrefix = parseFloat(totalPnl) >= 0 ? '+' : '';

    return `
📊 <b>持仓概览</b>

💰 <b>账户信息:</b>
• 账户价值: $${accountValue}
• 可用余额: $${availableBalance}
• 总体盈亏: ${totalPnlColor} ${totalPnlPrefix}$${totalPnl}
• 持仓数量: ${totalPositions}

📈 <b>当前持仓:</b>
${positionsText}

💡 <i>管理持仓:</i>
• <code>/close 代币</code> - 平仓指定代币
• <code>/price 代币</code> - 查询实时价格
• <code>/chart 代币</code> - 查看K线图

<i>🕐 查询时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</i>
    `.trim();
  }

  /**
   * 错误处理
   */
  private handleError(error: Error, requestId?: string): string {
    const reqId = requestId || `error_${Date.now()}`;
    
    logger.error(`Handling positions error [${reqId}]`, { 
      error: error.message,
      errorType: error.constructor?.name,
      errorStack: error.stack,
      requestId: reqId
    });

    if (error.message.includes('未登录')) {
      logger.info(`Authentication error detected [${reqId}]`, { requestId: reqId });
      return `
❌ <b>用户未登录</b>

请先使用 /start 命令登录系统后再查询持仓信息。

<i>如果您已经登录但仍出现此错误，请联系管理员。</i>
      `.trim();
    }

    if (error.message.includes('网络') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      logger.info(`Network error detected [${reqId}]`, { requestId: reqId });
      return `
❌ <b>网络连接失败</b>

请检查网络连接后重试，或稍后再试。

<i>如果问题持续存在，请联系管理员。</i>
      `.trim();
    }

    // 判断是否为外部接口问题（API返回400/500等状态码）
    if (error.message.includes('status code 400') || (error as any).response?.status === 400) {
      logger.info(`API 400 error detected [${reqId}]`, { 
        errorStatus: (error as any).response?.status,
        errorData: (error as any).response?.data,
        requestId: reqId
      });
      
      return `
❌ <b>外部接口错误 (400)</b>

持仓查询接口暂时不可用，这是后端API接口问题。

💡 <b>建议操作:</b>
• 稍后重试此命令
• 联系管理员报告接口故障
• 使用其他命令如 /wallet 查看账户信息

⚠️ <i>这不是您的操作问题，而是系统接口需要修复。</i>

<b>技术详情:</b> ${error.message}
      `.trim();
    }

    if (error.message.includes('status code 500') || error.message.includes('status code 502') || 
        error.message.includes('status code 503') || 
        (error as any).response?.status >= 500) {
      logger.info(`Server error detected [${reqId}]`, { 
        errorStatus: (error as any).response?.status,
        requestId: reqId
      });
      
      return `
❌ <b>服务器错误</b>

后端服务暂时不可用，请稍后重试。

💡 <b>建议操作:</b>
• 等待5-10分钟后重试
• 检查其他命令是否正常工作
• 联系管理员确认服务状态

⚠️ <i>这是临时性服务问题，通常会自动恢复。</i>
      `.trim();
    }

    // 超时错误
    if (error.message.includes('timeout') || error.message.includes('ECONNABORTED')) {
      logger.info(`Timeout error detected [${reqId}]`, { requestId: reqId });
      return `
❌ <b>请求超时</b>

持仓查询超时，可能是网络或服务器响应较慢。

💡 <b>建议操作:</b>
• 稍后重试此命令
• 检查网络连接状态

<i>如果问题持续存在，请联系管理员。</i>
      `.trim();
    }

    logger.info(`Generic error, returning default message [${reqId}]`, { requestId: reqId });
    
    return `
❌ <b>查询失败</b>

获取持仓信息时出现错误，请稍后重试。

<b>错误详情:</b> ${error.message}
<b>请求ID:</b> ${reqId}

<i>如果问题持续存在，请联系管理员。</i>
    `.trim();
  }

  /**
   * 获取缓存的仓位数据
   */
  private async getCachedPositions(userId: number): Promise<string | null> {
    try {
      const key = `${this.cacheKey}${userId}`;
      
      logger.debug('Getting cached positions', {
        userId,
        cacheKey: key
      });
      
      const result = await cacheService.get<string>(key);
      
      if (result.success && result.data) {
        logger.debug('Found cached positions data', {
          userId,
          cacheKey: key,
          dataLength: result.data.length
        });
        return result.data;
      }
      
      logger.debug('No cached positions data found', {
        userId,
        cacheKey: key,
        cacheResult: result
      });
      
      return null;
    } catch (error) {
      logger.warn('Failed to get cached positions', { 
        error: (error as Error).message, 
        userId,
        cacheKey: `${this.cacheKey}${userId}`
      });
      return null;
    }
  }

  /**
   * 缓存仓位数据
   */
  private async cachePositions(userId: number, data: string): Promise<void> {
    try {
      const key = `${this.cacheKey}${userId}`;
      
      logger.debug('Caching positions data', {
        userId,
        cacheKey: key,
        dataLength: data.length,
        cacheTTL: this.cacheTTL
      });
      
      const result = await cacheService.set(key, data, this.cacheTTL);
      
      if (result.success) {
        logger.debug('Positions data cached successfully', {
          userId,
          cacheKey: key,
          cacheTTL: this.cacheTTL
        });
      } else {
        logger.warn('Failed to cache positions data', {
          userId,
          cacheKey: key,
          cacheError: result.error
        });
      }
    } catch (error) {
      logger.warn('Failed to cache positions', { 
        error: (error as Error).message, 
        userId,
        cacheKey: `${this.cacheKey}${userId}`
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
        logger.error(`Failed to cache accessToken [${reqId}]`, {
          userId,
          tokenKey,
          error: result.error,
          requestId: reqId
        });
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