import { userService } from '../services/user.service';
import { logger } from './logger';
import { UserInitRequest, UserInitData } from '../types/api.types';

/**
 * 简单的认证工具函数
 * 获取用户的访问令牌，用于API认证
 */
export async function getUserAccessToken(
  telegramId: string,
  userInfo?: {
    username?: string;
    first_name?: string;
    last_name?: string;
  }
): Promise<string> {
  const requestId = `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    logger.info(`Getting access token for user [${requestId}]`, {
      telegramId,
      requestId
    });

    const initRequest: UserInitRequest = {
      telegram_id: telegramId,
      username: userInfo?.username,
      first_name: userInfo?.first_name,
      last_name: userInfo?.last_name
    };

    const userData: UserInitData = await userService.initializeUser(initRequest);
    
    logger.info(`Access token obtained successfully [${requestId}]`, {
      telegramId,
      userId: userData.userId,
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