import { userService } from '../services/user.service';
import { logger } from './logger';
import { UserInitRequest, UserInitData } from '../types/api.types';
import { cacheService } from '../services/cache.service';

/**
 * 获取用户的访问令牌，优先从缓存获取，没有则调用API并自动缓存
 * @param telegramId 用户的Telegram ID
 * @param userInfo 用户信息（用于API调用）
 * @param forceRefresh 是否强制刷新token（跳过缓存）
 */
export async function getUserAccessToken(
  telegramId: string,
  userInfo?: {
    username?: string;
    first_name?: string;
    last_name?: string;
  },
  forceRefresh: boolean = false
): Promise<string> {
  const requestId = `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const tokenKey = `user:token:${telegramId}`;
  
  try {
    // 如果不是强制刷新，先尝试从缓存获取
    if (!forceRefresh) {
      const cachedResult = await cacheService.get<string>(tokenKey);
      if (cachedResult.success && cachedResult.data) {
        logger.debug(`Access token found in cache [${requestId}]`, {
          telegramId,
          tokenKey,
          requestId
        });
        return cachedResult.data;
      }
    }

    logger.info(`Getting fresh access token for user [${requestId}]`, {
      telegramId,
      forceRefresh,
      requestId
    });

    const initRequest: UserInitRequest = {
      telegram_id: telegramId,
      username: userInfo?.username,
      first_name: userInfo?.first_name,
      last_name: userInfo?.last_name
    };

    const userData: UserInitData = await userService.initializeUser(initRequest);
    
    // 自动缓存获取到的token
    await cacheUserAccessToken(telegramId, userData.accessToken, requestId);
    
    logger.info(`Access token obtained and cached successfully [${requestId}]`, {
      telegramId,
      userId: userData.userId,
      tokenKey,
      requestId
    });

    return userData.accessToken;

  } catch (error) {
    logger.error(`Failed to get access token [${requestId}]`, {
      telegramId,
      error: (error as Error).message,
      requestId
    });
    throw error;
  }
}

/**
 * 缓存用户的accessToken
 */
async function cacheUserAccessToken(
  telegramId: string,
  accessToken: string,
  requestId?: string
): Promise<void> {
  try {
    const tokenKey = `user:token:${telegramId}`;
    const tokenTTL = 24 * 60 * 60; // 24小时过期
    
    const result = await cacheService.set(tokenKey, accessToken, tokenTTL);
    
    if (result.success) {
      logger.debug(`AccessToken cached in auth utils [${requestId}]`, {
        telegramId,
        tokenKey,
        expiresIn: tokenTTL,
        requestId
      });
    } else {
      logger.warn(`Failed to cache accessToken in auth utils [${requestId}]`, {
        telegramId,
        tokenKey,
        error: result.error,
        requestId
      });
    }
  } catch (error) {
    logger.error(`Error caching accessToken in auth utils [${requestId}]`, {
      telegramId,
      error: (error as Error).message,
      requestId
    });
  }
}

/**
 * 清除用户的缓存token
 */
export async function clearUserAccessToken(telegramId: string): Promise<boolean> {
  try {
    const tokenKey = `user:token:${telegramId}`;
    const result = await cacheService.delete(tokenKey);
    
    if (result.success) {
      logger.info('AccessToken cleared from cache', { telegramId, tokenKey });
    } else {
      logger.warn('Failed to clear accessToken from cache', { 
        telegramId, 
        tokenKey, 
        error: result.error 
      });
    }
    
    return result.success;
  } catch (error) {
    logger.error('Error clearing accessToken from cache', {
      telegramId,
      error: (error as Error).message
    });
    return false;
  }
}