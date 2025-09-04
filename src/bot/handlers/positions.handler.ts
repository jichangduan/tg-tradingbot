// import { Context } from 'telegraf'; // 未使用，已注释
import { logger } from '../../utils/logger';
import { apiService } from '../../services/api.service';
import { cacheService } from '../../services/cache.service';
// import { MessageFormatter } from '../utils/message.formatter'; // 未使用，已注释
// import { Validator } from '../utils/validator'; // 未使用，已注释
import { ExtendedContext } from '../index';
import { getUserAccessToken } from '../../utils/auth';

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
    if (!userId) {
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
      const cachedData = await this.getCachedPositions(userId);
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

      // 从API获取数据，传递ctx用于fallback认证
      const positionsData = await this.fetchPositionsFromAPI(userId, ctx);
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

      logger.error('Positions command failed', {
        error: (error as Error).message,
        userId,
        requestId: ctx.requestId
      });
    }
  }

  /**
   * 从API获取仓位数据
   */
  private async fetchPositionsFromAPI(userId: number, ctx?: ExtendedContext): Promise<PositionsResponse> {
    // 获取用户的access token，支持fallback重新认证
    const userToken = await this.getUserAccessToken(userId, ctx);
    
    if (!userToken) {
      throw new Error('用户未登录，请先使用 /start 命令登录');
    }

    const response = await apiService.getWithAuth<PositionsResponse>(
      '/api/tgbot/trading/positions',
      userToken,
      {},
      { timeout: 10000 }
    );

    if (response.code !== 200) {
      throw new Error(response.message || '获取仓位信息失败');
    }

    return response;
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
  private handleError(error: Error): string {
    logger.error('Positions handler error:', { error: error.message });

    if (error.message.includes('未登录')) {
      return `
❌ <b>用户未登录</b>

请先使用 /start 命令登录系统后再查询持仓信息。

<i>如果您已经登录但仍出现此错误，请联系管理员。</i>
      `.trim();
    }

    if (error.message.includes('网络')) {
      return `
❌ <b>网络连接失败</b>

请检查网络连接后重试，或稍后再试。

<i>如果问题持续存在，请联系管理员。</i>
      `.trim();
    }

    // 判断是否为外部接口问题（API返回400/500等状态码）
    if (error.message.includes('status code 400')) {
      return `
❌ <b>外部接口错误 (400)</b>

持仓查询接口暂时不可用，这是后端API接口问题。

💡 <b>建议操作:</b>
• 稍后重试此命令
• 联系管理员报告接口故障
• 使用其他命令如 /wallet 查看账户信息

⚠️ <i>这不是您的操作问题，而是系统接口需要修复。</i>
      `.trim();
    }

    if (error.message.includes('status code 500') || error.message.includes('status code 502') || error.message.includes('status code 503')) {
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

    return `
❌ <b>查询失败</b>

获取持仓信息时出现错误，请稍后重试。

<b>错误详情:</b> ${error.message}

<i>如果问题持续存在，请联系管理员。</i>
    `.trim();
  }

  /**
   * 获取缓存的仓位数据
   */
  private async getCachedPositions(userId: number): Promise<string | null> {
    try {
      const key = `${this.cacheKey}${userId}`;
      const result = await cacheService.get<string>(key);
      if (result.success && result.data) {
        return result.data;
      }
      return null;
    } catch (error) {
      logger.warn('Failed to get cached positions', { error: (error as Error).message, userId });
      return null;
    }
  }

  /**
   * 缓存仓位数据
   */
  private async cachePositions(userId: number, data: string): Promise<void> {
    try {
      const key = `${this.cacheKey}${userId}`;
      await cacheService.set(key, data, this.cacheTTL);
    } catch (error) {
      logger.warn('Failed to cache positions', { error: (error as Error).message, userId });
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
   * 缓存用户的accessToken
   */
  private async cacheUserAccessToken(userId: number, accessToken: string): Promise<void> {
    try {
      const tokenKey = `user:token:${userId}`;
      const tokenTTL = 24 * 60 * 60; // 24小时过期
      
      const result = await cacheService.set(tokenKey, accessToken, tokenTTL);
      
      if (result.success) {
        logger.debug('AccessToken cached in positions handler', {
          userId,
          tokenKey,
          expiresIn: tokenTTL
        });
      } else {
        logger.warn('Failed to cache accessToken in positions handler', {
          userId,
          tokenKey,
          error: result.error
        });
      }
    } catch (error) {
      logger.error('Error caching accessToken in positions handler', {
        userId,
        error: (error as Error).message
      });
    }
  }
}

// 导出处理器实例
export const positionsHandler = new PositionsHandler();
export default positionsHandler;