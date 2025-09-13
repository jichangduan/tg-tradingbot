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
        await ctx.reply('❌ Unable to get user information, please retry');
        return;
      }

      // Show loading status
      const loadingMsg = await ctx.reply('⏳ Querying your points information...');

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
      const pointsMessage = this.formatPointsMessage(inviteStats);
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
      const errorMessage = this.handlePointsError(error as DetailedError);
      await ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }
  }

  /**
   * 格式化积分信息消息
   */
  private formatPointsMessage(inviteStats: any): string {
    const {
      currentPoints,
      totalTradingVolume,
      inviteeCount,
      lastUpdated
    } = inviteStats;

    const messageLines = [
      '🎯 <b>Your Points Details</b>',
      '',
      `💎 <b>Current Points:</b> ${this.formatNumber(currentPoints)} points`,
      `📊 <b>Total Trading Volume:</b> $${this.formatNumber(totalTradingVolume)}`,
      `👥 <b>Invitees:</b> ${inviteeCount} people`,
      '',
      '📋 <b>Points Rules</b>',
      '• Every $100 trading volume = 1 point',
      '• Invite friends to increase trading volume and earn more points',
      '• Points can be used for platform special benefits and rewards',
      '',
      `🕒 <b>Update Time:</b> ${this.formatDateTime(lastUpdated)}`,
      '',
      '💡 <b>Tip:</b> Send /invite to view detailed invitation statistics',
      '',
      '🆘 <b>Need Help?</b>',
      '• 📱 Send /help to view usage guide',
      '• 💰 Send /wallet to check wallet balance',
      '• 📊 Send /markets to view market trends',
      '',
      'If problems persist, please contact administrator'
    ];

    return messageLines.join('\n');
  }

  /**
   * 处理积分查询错误
   */
  private handlePointsError(error: DetailedError): string {
    const baseMessage = [
      '❌ <b>Points Query Failed</b>',
      '',
      error.message || 'Unknown error',
      '',
      '💡 <b>Suggestion:</b> Please resend /points command',
      '',
      '🆘 <b>Need Help?</b>',
      '• 📱 Send /help to view usage guide',
      '• 💰 Send /wallet to check wallet balance',
      '• 📊 Send /markets to view market trends',
      '',
      'If problems persist, please contact administrator'
    ];

    return baseMessage.join('\n');
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