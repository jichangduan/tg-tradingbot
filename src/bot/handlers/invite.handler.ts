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
            '⚠️ Invalid page number format\n\n' +
            'Correct format: <code>/invite [page]</code>\n' +
            'Example: <code>/invite 2</code> to view page 2',
            { parse_mode: 'HTML' }
          );
          return;
        }
        page = pageArg;
      }

      if (args.length > 1) {
        await ctx.reply(
          '⚠️ Too many parameters\n\n' +
          'Correct format: <code>/invite [page]</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      // 发送"查询中..."消息
      const loadingMessage = await ctx.reply(
        '🔍 Fetching your invitation statistics...',
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
          '❌ Message sending failed, please try again\n\n' +
          '<i>If the problem persists, please contact administrator</i>',
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
      '❌ <b>System Error</b>\n\n' +
      'Sorry, an unexpected error occurred while processing your invitation query.\n\n' +
      '💡 <b>You can try:</b>\n' +
      '• Retry <code>/invite</code> later\n' +
      '• Check other features <code>/help</code>\n' +
      '• View wallet balance <code>/wallet</code>\n\n' +
      '<i>If the problem persists, please contact administrator</i>';

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
        await ctx.answerCbQuery('Already at first page');
        return;
      }

      // 获取目标页的数据
      const telegramId = userId!.toString();
      const inviteStats = await inviteService.getInviteStats(telegramId, targetPage, 10);

      if (targetPage > inviteStats.pagination.totalPages) {
        await ctx.answerCbQuery('Already at last page');
        return;
      }

      // 更新消息内容
      const responseMessage = messageFormatter.formatInviteStatsMessage(inviteStats);
      
      await ctx.editMessageText(responseMessage, { parse_mode: 'HTML' });
      await ctx.answerCbQuery(`Switched to page ${targetPage}`);

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

      await ctx.answerCbQuery('Page navigation failed, please try again');
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
        '🔗 <b>Your Invitation Link</b>\n\n' +
        `<code>${inviteLink}</code>\n\n` +
        '💡 <b>How to use:</b>\n' +
        '• Copy and share the link with friends\n' +
        '• Friends click the link to start using the Bot\n' +
        '• You earn points when friends trade\n\n' +
        '🎁 <b>Reward Rules:</b>\n' +
        '• Every $100 trading volume = 1 point\n' +
        '• Points can be redeemed for rewards\n' +
        '• Real-time statistics, instant crediting\n\n' +
        'Use <code>/invite</code> to view invitation statistics';

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
        '❌ Invitation link generation failed\n\nPlease try again later',
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