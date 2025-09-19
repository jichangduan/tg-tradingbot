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
          const invalidPageMsg = await ctx.__!('invite.invalidPage');
          await ctx.reply(invalidPageMsg, { parse_mode: 'HTML' });
          return;
        }
        page = pageArg;
      }

      if (args.length > 1) {
        const tooManyParamsMsg = await ctx.__!('invite.tooManyParams');
        await ctx.reply(tooManyParamsMsg, { parse_mode: 'HTML' });
        return;
      }

      // 发送"查询中..."消息
      const loadingMsg = await ctx.__!('invite.loading');
      const loadingMessage = await ctx.reply(loadingMsg, { parse_mode: 'HTML' });

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
        const sendFailedMsg = await ctx.__!('errors.messageSendFailed');
        await ctx.reply(sendFailedMsg, { parse_mode: 'HTML' });
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
    ctx: ExtendedContext, 
    error: DetailedError, 
    loadingMessageId: number
  ): Promise<void> {
    const errorMessage = await ctx.__!('invite.error');
    
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
  private async sendGenericErrorMessage(ctx: ExtendedContext): Promise<void> {
    const errorMessage = await ctx.__!('invite.systemError');
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

      const linkMessage = await ctx.__!('invite.linkGenerated', inviteLink);
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

      const linkErrorMsg = await ctx.__!('invite.linkGenerationFailed');
      await ctx.reply(linkErrorMsg, { parse_mode: 'HTML' });
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