import { Context } from 'telegraf';
import { logger } from './logger';
import { ExtendedContext } from '../bot/index';

/**
 * Group admin verification utilities
 * 群主权限验证工具集
 */

/**
 * Verify if user is group creator/owner
 * 验证用户是否为群主/群组创建者
 * 
 * @param ctx Telegram context
 * @param userId User ID to verify
 * @param chatId Group chat ID
 * @returns Promise<boolean> true if user is group creator, false otherwise
 */
export async function verifyGroupCreator(
  ctx: ExtendedContext,
  userId: number,
  chatId: number
): Promise<boolean> {
  const requestId = ctx.requestId || 'unknown';

  try {
    logger.debug(`Verifying group creator [${requestId}]`, { userId, chatId, requestId });

    // Get group administrators list
    const administrators = await ctx.telegram.getChatAdministrators(chatId);
    
    // Check if user is group creator
    const isCreator = administrators.some(admin =>
      admin.status === 'creator' && admin.user.id === userId
    );

    logger.debug(`Group creator verification result [${requestId}]`, {
      userId,
      chatId,
      isCreator,
      totalAdmins: administrators.length,
      requestId
    });

    return isCreator;

  } catch (error) {
    logger.error(`Failed to verify group creator [${requestId}]`, {
      userId,
      chatId,
      error: (error as Error).message,
      requestId
    });

    // Return false for security reasons when verification fails
    return false;
  }
}

/**
 * Check if the current chat is a group or supergroup
 * 检查当前对话是否为群组或超级群组
 * 
 * @param ctx Telegram context
 * @returns boolean true if current chat is a group, false otherwise
 */
export function isGroupChat(ctx: Context): boolean {
  const chatType = ctx.chat?.type;
  return chatType === 'group' || chatType === 'supergroup';
}

/**
 * Get group information for logging
 * 获取群组信息用于日志记录
 * 
 * @param ctx Telegram context
 * @returns Object with group information
 */
export function getGroupInfo(ctx: Context): {
  chatId: number | undefined;
  chatTitle: string;
  chatType: string | undefined;
} {
  const chatId = ctx.chat?.id;
  const chatTitle = (ctx.chat && 'title' in ctx.chat) ? ctx.chat.title || 'Unnamed Group' : 'Unnamed Group';
  const chatType = ctx.chat?.type;

  return {
    chatId,
    chatTitle,
    chatType
  };
}

/**
 * Comprehensive group admin check with logging
 * 综合群主权限检查（包含日志记录）
 * 
 * @param ctx Telegram context
 * @param operation Operation name for logging
 * @returns Promise<boolean> true if user has admin permissions in group
 */
export async function checkGroupAdminPermission(
  ctx: ExtendedContext,
  operation: string = 'group_operation'
): Promise<boolean> {
  const userId = ctx.from?.id;
  const requestId = ctx.requestId || 'unknown';
  const groupInfo = getGroupInfo(ctx);

  if (!userId) {
    logger.warn(`Missing user information [${requestId}]`, {
      userId,
      chatId: groupInfo.chatId,
      operation,
      requestId
    });
    return false;
  }

  // Check if it's a group chat
  if (!isGroupChat(ctx)) {
    logger.debug(`Not a group chat, allowing operation [${requestId}]`, {
      userId,
      chatType: groupInfo.chatType,
      operation,
      requestId
    });
    return true; // Allow operation in private chats
  }

  // For group chats, we need the chat ID
  if (!groupInfo.chatId) {
    logger.warn(`Missing chat ID for group operation [${requestId}]`, {
      userId,
      chatId: groupInfo.chatId,
      operation,
      requestId
    });
    return false;
  }

  // Log group operation attempt
  logger.info(`Group ${operation} permission check [${requestId}]`, {
    userId,
    groupId: groupInfo.chatId,
    groupName: groupInfo.chatTitle,
    operation,
    requestId
  });

  // Verify group creator permission
  const isCreator = await verifyGroupCreator(ctx, userId, groupInfo.chatId);
  
  if (isCreator) {
    logger.info(`Group ${operation} permission granted [${requestId}]`, {
      userId,
      groupId: groupInfo.chatId,
      groupName: groupInfo.chatTitle,
      operation,
      requestId
    });
  } else {
    logger.warn(`Group ${operation} permission denied [${requestId}]`, {
      userId,
      groupId: groupInfo.chatId,
      groupName: groupInfo.chatTitle,
      operation,
      requestId
    });
  }

  return isCreator;
}