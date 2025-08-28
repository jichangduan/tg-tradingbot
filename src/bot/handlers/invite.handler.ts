import { Context } from 'telegraf';
import { inviteService } from '../../services/invite.service';
import { messageFormatter } from '../utils/message.formatter';
import { logger } from '../../utils/logger';
import { DetailedError } from '../../types/api.types';
import { ExtendedContext } from '../index';

/**
 * Invite命令处理器
 * 处理 /invite 命令，显示用户的邀请统计和积分信息
 */
export class InviteHandler {
  /**
   * 处理 /invite 命令
   * @param ctx Telegram上下文
   * @param args 命令参数数组
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('invite', userId!, username, args);

      // 参数验证和页码解析
      let page = 1;
      let pageSize = 10; // 默认每页显示10条记录

      if (args.length > 0) {
        const pageArg = parseInt(args[0]);
        if (isNaN(pageArg) || pageArg < 1) {
          await ctx.reply(
            '⚠️ 页码格式不正确\n\n' +
            '正确格式: <code>/invite [页码]</code>\n' +
            '例如: <code>/invite 2</code> 查看第2页',
            { parse_mode: 'HTML' }
          );
          return;
        }
        page = pageArg;
      }

      if (args.length > 1) {
        await ctx.reply(
          '⚠️ 参数过多\n\n' +
          '正确格式: <code>/invite [页码]</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 发送"查询中..."消息
      const loadingMessage = await ctx.reply(
        '🔍 正在获取邀请统计数据...',
        { parse_mode: 'HTML' }
      );

      // 调用邀请服务获取统计数据
      let inviteStats;
      try {
        const telegramId = userId!.toString();
        inviteStats = await inviteService.getInviteStats(telegramId, page, pageSize);
      } catch (serviceError) {
        await this.handleServiceError(ctx, serviceError as DetailedError, loadingMessage.message_id);
        return;
      }

      // 格式化并发送响应消息
      try {
        const responseMessage = messageFormatter.formatInviteStatsMessage(inviteStats);
        
        await ctx.telegram.editMessageText(
          ctx.chat?.id,
          loadingMessage.message_id,
          undefined,
          responseMessage,
          { parse_mode: 'HTML' }
        );

        // 记录成功的查询
        const duration = Date.now() - startTime;
        logger.logPerformance('invite_query_success', duration, {
          userId,
          username,
          page,
          inviteeCount: inviteStats.inviteeCount,
          totalTradingVolume: inviteStats.totalTradingVolume,
          currentPoints: inviteStats.currentPoints,
          requestId
        });

      } catch (messageError) {
        logger.error(`Failed to send invite message [${requestId}]`, {
          error: (messageError as Error).message,
          userId,
          requestId
        });

        // 如果编辑消息失败，尝试发送新消息
        await ctx.reply(
          '❌ 消息发送失败，请重试\n\n' +
          '<i>如果问题持续存在，请联系管理员</i>',
          { parse_mode: 'HTML' }
        );
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Invite command failed [${requestId}]`, {
        error: (error as Error).message,
        stack: (error as Error).stack,
        duration,
        userId,
        username,
        args,
        requestId
      });

      // 发送通用错误消息
      await this.sendGenericErrorMessage(ctx);
    }
  }

  /**
   * 处理服务错误
   */
  private async handleServiceError(
    ctx: Context, 
    error: DetailedError, 
    loadingMessageId: number
  ): Promise<void> {
    const errorMessage = messageFormatter.formatInviteErrorMessage(error);
    
    try {
      await ctx.telegram.editMessageText(
        ctx.chat?.id,
        loadingMessageId,
        undefined,
        errorMessage,
        { parse_mode: 'HTML' }
      );
    } catch (editError) {
      // 如果编辑失败，发送新消息
      await ctx.reply(errorMessage, { parse_mode: 'HTML' });
    }
  }

  /**
   * 发送通用错误消息
   */
  private async sendGenericErrorMessage(ctx: Context): Promise<void> {
    const errorMessage = 
      '❌ <b>系统错误</b>\n\n' +
      '很抱歉，处理您的邀请查询时出现了意外错误。\n\n' +
      '💡 <b>您可以尝试:</b>\n' +
      '• 稍后重试 <code>/invite</code>\n' +
      '• 查看其他功能 <code>/help</code>\n' +
      '• 检查钱包余额 <code>/wallet</code>\n\n' +
      '<i>如果问题持续存在，请联系管理员</i>';

    await ctx.reply(errorMessage, { parse_mode: 'HTML' });
  }

  /**
   * 处理分页导航（预留功能）
   * 处理用户点击"上一页"或"下一页"按钮
   */
  public async handlePageNavigation(
    ctx: ExtendedContext, 
    page: number, 
    action: 'prev' | 'next'
  ): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.info(`Invite page navigation [${requestId}]`, {
        userId,
        username,
        currentPage: page,
        action,
        requestId
      });

      // 计算目标页码
      const targetPage = action === 'next' ? page + 1 : page - 1;
      
      if (targetPage < 1) {
        await ctx.answerCbQuery('已经是第一页了');
        return;
      }

      // 获取目标页的数据
      const telegramId = userId!.toString();
      const inviteStats = await inviteService.getInviteStats(telegramId, targetPage, 10);

      if (targetPage > inviteStats.pagination.totalPages) {
        await ctx.answerCbQuery('已经是最后一页了');
        return;
      }

      // 更新消息内容
      const responseMessage = messageFormatter.formatInviteStatsMessage(inviteStats);
      
      await ctx.editMessageText(responseMessage, { parse_mode: 'HTML' });
      await ctx.answerCbQuery(`已切换到第${targetPage}页`);

      const duration = Date.now() - startTime;
      logger.logPerformance('invite_page_navigation_success', duration, {
        userId,
        username,
        fromPage: page,
        toPage: targetPage,
        action,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Invite page navigation failed [${requestId}]`, {
        error: (error as Error).message,
        userId,
        page,
        action,
        duration,
        requestId
      });

      await ctx.answerCbQuery('分页导航失败，请重试');
    }
  }

  /**
   * 处理邀请链接生成（预留功能）
   */
  public async generateInviteLink(ctx: ExtendedContext): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.info(`Generate invite link request [${requestId}]`, {
        userId,
        username,
        requestId
      });

      // 这里需要获取用户的推荐码
      // 暂时使用用户ID作为推荐码的一部分
      const userReferralCode = `USER${userId}`;
      const inviteLink = inviteService.generateInviteLink(userReferralCode);

      const linkMessage = 
        '🔗 <b>您的邀请链接</b>\n\n' +
        `<code>${inviteLink}</code>\n\n` +
        '💡 <b>如何使用:</b>\n' +
        '• 复制链接分享给朋友\n' +
        '• 朋友点击链接开始使用Bot\n' +
        '• 朋友交易时您将获得积分奖励\n\n' +
        '🎁 <b>奖励规则:</b>\n' +
        '• 每$100交易量 = 1积分\n' +
        '• 积分可用于兑换奖励\n' +
        '• 实时统计，及时到账\n\n' +
        '使用 <code>/invite</code> 查看邀请统计';

      await ctx.reply(linkMessage, { parse_mode: 'HTML' });

      const duration = Date.now() - startTime;
      logger.logPerformance('invite_link_generation_success', duration, {
        userId,
        username,
        referralCode: userReferralCode,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Generate invite link failed [${requestId}]`, {
        error: (error as Error).message,
        userId,
        duration,
        requestId
      });

      await ctx.reply(
        '❌ 邀请链接生成失败\n\n请稍后重试',
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * 获取处理器统计信息
   */
  public getStats(): any {
    return {
      name: 'InviteHandler',
      version: '1.0.0',
      supportedCommands: ['/invite'],
      features: [
        'Invite statistics display',
        'Points calculation (trading volume / 100)',
        'Pagination navigation',
        'Invite link generation',
        'Comprehensive error handling'
      ]
    };
  }
}

// 导出单例实例
export const inviteHandler = new InviteHandler();

// 默认导出
export default inviteHandler;