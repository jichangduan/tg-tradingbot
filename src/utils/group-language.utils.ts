import { Context } from 'telegraf';
import { ExtendedContext } from '../bot/index';
import { logger } from './logger';
import { i18nService } from '../services/i18n.service';

/**
 * Group language detection utilities
 * 群组语言检测工具集
 */

/**
 * Detect group admin's language preference and create a context with that language
 * 检测群主的语言偏好并创建使用该语言的上下文
 * 
 * @param ctx Telegram context
 * @returns Promise<ExtendedContext> context with admin's language preference
 */
export async function createGroupLanguageContext(ctx: ExtendedContext): Promise<ExtendedContext> {
  const requestId = ctx.requestId || 'unknown';
  const chatId = ctx.chat?.id;
  
  if (!chatId) {
    logger.warn(`Missing chat ID for group language detection [${requestId}]`);
    return ctx; // Return original context as fallback
  }

  try {
    // Get group administrators
    const administrators = await ctx.telegram.getChatAdministrators(chatId);
    
    // Find the group creator
    const creator = administrators.find(admin => admin.status === 'creator');
    
    if (!creator) {
      logger.warn(`No group creator found for language detection [${requestId}]`, {
        chatId,
        requestId
      });
      return ctx; // Return original context with default language
    }

    // Try to detect creator's language preference
    const creatorLanguage = await detectUserLanguage(creator.user.id, requestId);
    
    if (creatorLanguage && i18nService.isLocaleSupported(creatorLanguage)) {
      // Create a new context with the creator's language
      const languageContext = Object.assign({}, ctx) as ExtendedContext;
      languageContext.userLanguage = creatorLanguage;
      
      // Add language-aware translation function
      languageContext.__ = (key: string, options?: any): Promise<string> => {
        return i18nService.__(key, creatorLanguage, options);
      };
      
      languageContext.__! = (key: string, options?: any): Promise<string> => {
        return i18nService.__(key, creatorLanguage, options);
      };
      
      logger.info(`Group language context created [${requestId}]`, {
        chatId,
        creatorId: creator.user.id,
        detectedLanguage: creatorLanguage,
        requestId
      });
      
      return languageContext;
    }
    
  } catch (error) {
    logger.error(`Failed to detect group language [${requestId}]`, {
      chatId,
      error: (error as Error).message,
      requestId
    });
  }
  
  // Fallback to original context (English by default)
  logger.debug(`Using default language for group [${requestId}]`, {
    chatId,
    defaultLanguage: ctx.userLanguage || 'en',
    requestId
  });
  
  return ctx;
}

/**
 * Detect user's language preference (simplified version)
 * 检测用户的语言偏好（简化版本）
 * 
 * This is a simplified implementation. In a full system, you might:
 * - Store user language preferences in database
 * - Use Telegram's language_code from user info
 * - Implement more sophisticated detection logic
 */
async function detectUserLanguage(userId: number, requestId: string): Promise<string | null> {
  try {
    // For now, we'll use a simple approach based on user's Telegram language
    // In a production system, you might want to:
    // 1. Check database for stored user language preference
    // 2. Use user's Telegram language_code
    // 3. Implement language learning based on user interactions
    
    // Default fallback strategy: return English
    // This can be enhanced to actually detect/store user preferences
    
    logger.debug(`Detecting language for user ${userId} [${requestId}]`);
    
    // TODO: Implement actual language detection logic
    // For now, return null to use system default
    return null;
    
  } catch (error) {
    logger.error(`Error detecting user language [${requestId}]`, {
      userId,
      error: (error as Error).message,
      requestId
    });
    return null;
  }
}

/**
 * Get supported language code from Telegram language code
 * 从 Telegram 语言代码获取支持的语言代码
 */
export function mapTelegramLanguageCode(telegramLangCode: string | undefined): string {
  if (!telegramLangCode) {
    return 'en'; // Default to English
  }
  
  // Map Telegram language codes to our supported locales
  const languageMapping: { [key: string]: string } = {
    'en': 'en',
    'zh': 'zh-CN',
    'zh-cn': 'zh-CN',
    'zh-hans': 'zh-CN', 
    'ko': 'ko',
    'kr': 'ko'
  };
  
  const lowerCode = telegramLangCode.toLowerCase();
  return languageMapping[lowerCode] || 'en';
}

/**
 * Create internationalized group message
 * 创建国际化的群组消息
 */
export async function createGroupMessage(
  ctx: ExtendedContext,
  messageKeys: {
    title: string;
    lines: string[];
  }
): Promise<string> {
  try {
    const title = await ctx.__!(messageKeys.title);
    const lines = await Promise.all(
      messageKeys.lines.map(key => ctx.__!(key))
    );
    
    return [title, '', ...lines].join('\n');
    
  } catch (error) {
    logger.error('Failed to create group message', {
      error: (error as Error).message,
      messageKeys
    });
    
    // Fallback to English
    return 'Welcome! Use /help to see available commands.';
  }
}