import { Context } from 'telegraf';
import { inviteService } from '../../services/invite.service';
import { messageFormatter } from '../utils/message.formatter';
import { logger } from '../../utils/logger';
import { DetailedError } from '../../types/api.types';
import { ExtendedContext } from '../index';

/**
 * Points命令处理器
 * 处理 /points 命令，显示用户赚取的积分信息
 */
export class PointsHandler {
  /**
   * 处理 /points 命令
   * @param ctx Telegram上下文
   * @param args 命令参数数组
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('points', userId!, username, args);

      if (!userId) {
        const userInfoError = await ctx.__!('trading.userInfoError');
        await ctx.reply(userInfoError);
        return;
      }

      // Show loading status
      const loadingMessage = await ctx.__!('points.loading');
      const loadingMsg = await ctx.reply(loadingMessage);

      // 调用invite服务获取积分数据（积分基于交易量计算）
      logger.info(`Points query started [points_${Date.now()}_${Math.random().toString(36).substr(2, 9)}]`, {
        telegramId: userId.toString(),
        username,
        requestId
      });

      const inviteStats = await inviteService.getInviteStats(
        userId.toString(),
        1, // 只需要第一页来获取总数据
        1  // 只需要1条记录，主要获取积分信息
      );

      // 删除加载消息
      try {
        await ctx.deleteMessage(loadingMsg.message_id);
      } catch (deleteError) {
        // 删除失败不影响功能
      }

      // 格式化积分信息
      const pointsMessage = await ctx.__!('points.details', {
        currentPoints: this.formatNumber(inviteStats.currentPoints),
        totalTradingVolume: this.formatNumber(inviteStats.totalTradingVolume), 
        inviteeCount: inviteStats.inviteeCount,
        lastUpdated: this.formatDateTime(inviteStats.lastUpdated)
      });
      await ctx.reply(pointsMessage, { parse_mode: 'HTML' });

      // 记录成功日志
      const duration = Date.now() - startTime;
      logger.info(`Points query completed successfully [${requestId}] - ${duration}ms`, {
        telegramId: userId.toString(),
        username,
        totalTradingVolume: inviteStats.totalTradingVolume,
        currentPoints: inviteStats.currentPoints,
        inviteeCount: inviteStats.inviteeCount,
        duration,
        requestId
      });

      logger.logPerformance('points_query_success', duration, {
        userId: userId,
        username,
        totalTradingVolume: inviteStats.totalTradingVolume,
        currentPoints: inviteStats.currentPoints,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error(`Points query failed [${requestId}] - ${duration}ms`, {
        telegramId: userId?.toString(),
        username,
        errorCode: (error as DetailedError).code,
        errorMessage: (error as Error).message,
        duration,
        requestId
      });

      // 处理详细错误并显示用户友好消息
      const errorMessage = await ctx.__!('points.error');
      await ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }
  }


  /**
   * 格式化数字显示
   */
  private formatNumber(num: number): string {
    if (num === 0) return '0';
    if (num < 0.01) return '< 0.01';
    return num.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    });
  }

  /**
   * 格式化日期时间
   */
  private formatDateTime(date: Date): string {
    try {
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC'
      });
    } catch (error) {
      return 'Just now';
    }
  }
}

// 导出单例实例
export const pointsHandler = new PointsHandler();

// 默认导出
export default pointsHandler;