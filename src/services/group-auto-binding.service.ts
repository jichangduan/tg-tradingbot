import { ExtendedContext } from '../bot/index';
import { pushService } from './push.service';
import { cacheService } from './cache.service';
import { getUserAccessToken } from '../utils/auth';
import { logger } from '../utils/logger';

/**
 * 群组自动绑定服务
 * 负责在群主使用任何命令时自动绑定群组推送
 */
export class GroupAutoBindingService {
  private readonly BINDING_CACHE_PREFIX = 'group_binding_status';
  private readonly CREATOR_CACHE_PREFIX = 'group_creator_status';
  private readonly BINDING_CACHE_TTL = 24 * 60 * 60; // 24小时
  private readonly CREATOR_CACHE_TTL = 30 * 60; // 30分钟
  private readonly COOLDOWN_TTL = 5 * 60; // 5分钟失败冷却

  /**
   * 尝试自动绑定群组
   */
  public async tryAutoBindGroup(ctx: ExtendedContext): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const chatType = ctx.chat?.type;
    const requestId = ctx.requestId || 'auto_bind';

    // 只处理群组和超级群组
    if (!userId || !chatId || (chatType !== 'group' && chatType !== 'supergroup')) {
      return;
    }

    const userIdStr = userId.toString();
    const chatIdStr = chatId.toString();
    const chatTitle = (ctx.chat && 'title' in ctx.chat) ? ctx.chat.title || '未命名群组' : '未命名群组';

    try {
      logger.debug('🔍 [AUTO_BIND] Checking auto-binding conditions', {
        userId,
        chatId: chatIdStr,
        chatTitle,
        requestId
      });

      // 1. 检查是否已经绑定过（避免重复API调用）
      const isAlreadyBound = await this.isGroupAlreadyBound(userIdStr, chatIdStr);
      if (isAlreadyBound) {
        logger.debug('⏭️ [AUTO_BIND] Group already bound, skipping', {
          userId,
          chatId: chatIdStr,
          requestId
        });
        return;
      }

      // 2. 检查绑定冷却期（避免频繁失败重试）
      const isInCooldown = await this.isBindingInCooldown(userIdStr, chatIdStr);
      if (isInCooldown) {
        logger.debug('⏰ [AUTO_BIND] Binding in cooldown period, skipping', {
          userId,
          chatId: chatIdStr,
          requestId
        });
        return;
      }

      // 3. 验证用户是否为群主
      const isCreator = await this.verifyGroupCreator(ctx, parseInt(userIdStr), parseInt(chatIdStr));
      if (!isCreator) {
        logger.debug('👤 [AUTO_BIND] User is not group creator, skipping', {
          userId,
          chatId: chatIdStr,
          requestId
        });
        return;
      }

      // 4. 执行自动绑定
      await this.performAutoBinding(userIdStr, chatIdStr, chatTitle, requestId, ctx);

    } catch (error) {
      logger.warn('⚠️ [AUTO_BIND] Auto-binding failed', {
        userId,
        chatId: chatIdStr,
        error: (error as Error).message,
        requestId
      });

      // 设置冷却期避免重复失败
      await this.setBindingCooldown(userIdStr, chatIdStr);
    }
  }

  /**
   * 检查群组是否已经绑定
   */
  private async isGroupAlreadyBound(userId: string, groupId: string): Promise<boolean> {
    try {
      const cacheKey = `${this.BINDING_CACHE_PREFIX}:${userId}:${groupId}`;
      const result = await cacheService.get<boolean>(cacheKey);
      return result.success && result.data === true;
    } catch (error) {
      logger.debug('缓存检查失败，假设未绑定', { userId: parseInt(userId), groupId });
      return false;
    }
  }

  /**
   * 检查是否在绑定冷却期
   */
  private async isBindingInCooldown(userId: string, groupId: string): Promise<boolean> {
    try {
      const cacheKey = `${this.BINDING_CACHE_PREFIX}:cooldown:${userId}:${groupId}`;
      const result = await cacheService.get<boolean>(cacheKey);
      return result.success && result.data === true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 设置绑定冷却期
   */
  private async setBindingCooldown(userId: string, groupId: string): Promise<void> {
    try {
      const cacheKey = `${this.BINDING_CACHE_PREFIX}:cooldown:${userId}:${groupId}`;
      await cacheService.set(cacheKey, true, this.COOLDOWN_TTL);
    } catch (error) {
      logger.debug('设置冷却期失败', { userId: parseInt(userId), groupId, error: (error as Error).message });
    }
  }

  /**
   * 验证用户是否为群主（复用push.handler.ts的逻辑）
   */
  private async verifyGroupCreator(ctx: ExtendedContext, userId: number, chatId: number): Promise<boolean> {
    const requestId = ctx.requestId || 'auto_bind';
    const cacheKey = `${this.CREATOR_CACHE_PREFIX}:${userId}:${chatId}`;

    try {
      // 先检查缓存
      const cachedResult = await cacheService.get<boolean>(cacheKey);
      if (cachedResult.success && cachedResult.data !== undefined) {
        logger.debug('群主权限验证命中缓存', {
          userId,
          chatId,
          isCreator: cachedResult.data,
          requestId
        });
        return cachedResult.data;
      }

      // 获取群组管理员列表
      const administrators = await ctx.telegram.getChatAdministrators(chatId);
      
      // 检查用户是否为群组创建者
      const isCreator = administrators.some(admin =>
        admin.status === 'creator' && admin.user.id === userId
      );

      // 缓存验证结果
      await cacheService.set(cacheKey, isCreator, this.CREATOR_CACHE_TTL);

      logger.debug('群主权限验证完成', {
        userId,
        chatId,
        isCreator,
        totalAdmins: administrators.length,
        requestId
      });

      return isCreator;

    } catch (error) {
      logger.warn('群主权限验证失败', {
        userId,
        chatId,
        error: (error as Error).message,
        requestId
      });

      // 权限验证失败时，为安全起见返回 false
      return false;
    }
  }

  /**
   * 执行自动绑定
   */
  private async performAutoBinding(
    userId: string,
    groupId: string,
    groupName: string,
    requestId: string,
    ctx: ExtendedContext
  ): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info('🚀 [AUTO_BIND] Starting automatic group binding', {
        userId: parseInt(userId),
        groupId,
        groupName,
        requestId
      });

      // 获取用户访问令牌
      const accessToken = await getUserAccessToken(userId, {
        username: ctx.from?.username,
        first_name: ctx.from?.first_name,
        last_name: ctx.from?.last_name
      });

      // 调用现有的群组绑定API
      await pushService.bindGroupPush(userId, accessToken, groupId, groupName);

      // 缓存绑定成功状态
      const bindingCacheKey = `${this.BINDING_CACHE_PREFIX}:${userId}:${groupId}`;
      await cacheService.set(bindingCacheKey, true, this.BINDING_CACHE_TTL);

      const duration = Date.now() - startTime;
      logger.info('✅ [AUTO_BIND] Automatic group binding completed successfully', {
        userId: parseInt(userId),
        groupId,
        groupName,
        duration,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('❌ [AUTO_BIND] Automatic group binding failed', {
        userId: parseInt(userId),
        groupId,
        groupName,
        duration,
        error: (error as Error).message,
        requestId
      });

      // 重新抛出错误，让上层处理冷却期设置
      throw error;
    }
  }

  /**
   * 手动清除绑定缓存（用于测试或故障排除）
   */
  public async clearBindingCache(userId: string, groupId?: string): Promise<void> {
    try {
      if (groupId) {
        // 清除特定群组的缓存
        const bindingCacheKey = `${this.BINDING_CACHE_PREFIX}:${userId}:${groupId}`;
        const creatorCacheKey = `${this.CREATOR_CACHE_PREFIX}:${userId}:${groupId}`;
        const cooldownCacheKey = `${this.BINDING_CACHE_PREFIX}:cooldown:${userId}:${groupId}`;
        
        await Promise.all([
          cacheService.delete(bindingCacheKey),
          cacheService.delete(creatorCacheKey),
          cacheService.delete(cooldownCacheKey)
        ]);
        
        logger.info('清除特定群组绑定缓存', { userId: parseInt(userId), groupId });
      } else {
        // 清除用户所有群组的缓存（通过模式匹配，如果缓存服务支持）
        logger.info('清除用户所有群组绑定缓存', { userId: parseInt(userId) });
        // 注意：这里需要根据实际的缓存服务实现来决定如何批量删除
      }
    } catch (error) {
      logger.warn('清除绑定缓存失败', {
        userId: parseInt(userId),
        groupId,
        error: (error as Error).message
      });
    }
  }

  /**
   * 获取群组绑定统计信息（用于监控和调试）
   */
  public async getBindingStats(): Promise<{
    totalChecks: number;
    successfulBindings: number;
    failedBindings: number;
    cacheHitRate: number;
  }> {
    // TODO: 如果需要详细统计，可以在这里实现
    // 目前返回模拟数据
    return {
      totalChecks: 0,
      successfulBindings: 0,
      failedBindings: 0,
      cacheHitRate: 0
    };
  }
}

// 导出单例
export const groupAutoBindingService = new GroupAutoBindingService();
export default groupAutoBindingService;