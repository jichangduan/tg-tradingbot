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
        await ctx.reply('❌ 无法获取用户信息，请重试');
        return;
      }

      // 显示加载状态
      const loadingMsg = await ctx.reply('⏳ 正在查询您的积分信息...');

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
      '🎯 <b>您的积分详情</b>',
      '',
      `💎 <b>当前积分:</b> ${this.formatNumber(currentPoints)} 分`,
      `📊 <b>总交易量:</b> $${this.formatNumber(totalTradingVolume)}`,
      `👥 <b>邀请人数:</b> ${inviteeCount} 人`,
      '',
      '📋 <b>积分规则</b>',
      '• 每 $100 交易量 = 1 积分',
      '• 通过邀请好友增加交易量来赚取更多积分',
      '• 积分可用于平台特殊权益和奖励',
      '',
      `🕒 <b>更新时间:</b> ${this.formatDateTime(lastUpdated)}`,
      '',
      '💡 <b>提示:</b> 发送 /invite 查看详细邀请统计',
      '',
      '🆘 <b>需要帮助？</b>',
      '• 📱 发送 /help 查看使用指南',
      '• 💰 发送 /wallet 查看钱包余额',
      '• 📊 发送 /markets 查看市场行情',
      '',
      '如果问题持续存在，请联系管理员'
    ];

    return messageLines.join('\n');
  }

  /**
   * 处理积分查询错误
   */
  private handlePointsError(error: DetailedError): string {
    const baseMessage = [
      '❌ <b>积分查询失败</b>',
      '',
      error.message || '未知错误',
      '',
      '💡 <b>建议:</b> 请重新发送 /points 命令',
      '',
      '🆘 <b>需要帮助？</b>',
      '• 📱 发送 /help 查看使用指南',
      '• 💰 发送 /wallet 查看钱包余额',
      '• 📊 发送 /markets 查看市场行情',
      '',
      '如果问题持续存在，请联系管理员'
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
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Shanghai'
      });
    } catch (error) {
      return '刚刚';
    }
  }
}

// 导出单例实例
export const pointsHandler = new PointsHandler();

// 默认导出
export default pointsHandler;