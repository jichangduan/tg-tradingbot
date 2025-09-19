import { Context } from 'telegraf';
import { i18nService } from '../services/i18n.service';
import { logger } from '../utils/logger';
import { ExtendedContext } from '../bot/index';

/**
 * 语言检测中间件
 * 为每个请求自动检测和设置用户语言偏好
 * 在 context 中注入翻译函数
 */
export function createLanguageMiddleware() {
  return async (ctx: ExtendedContext, next: () => Promise<void>) => {
    const telegramId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const telegramLangCode = ctx.from?.language_code;
    
    try {
      let userLanguage = 'en'; // 默认语言
      
      if (telegramId) {
        // 1. 尝试获取用户已设置的语言偏好
        userLanguage = await i18nService.getUserLanguage(telegramId);
        
        // 2. 如果是默认语言（意味着可能是新用户），尝试基于 Telegram 语言检测
        if (userLanguage === 'en' && telegramLangCode) {
          const detectedLang = i18nService.detectLanguageFromTelegram(telegramLangCode);
          
          // 如果检测到非英语语言，自动为用户设置
          if (detectedLang !== 'en') {
            const saved = await i18nService.setUserLanguage(telegramId, detectedLang);
            if (saved) {
              userLanguage = detectedLang;
              
              logger.info('Auto-detected and set user language', {
                telegramId,
                username,
                telegramLangCode,
                detectedLanguage: detectedLang,
                previousLanguage: 'en'
              });
            }
          }
        }
      }
      
      // 3. 将用户语言添加到 context 中
      ctx.userLanguage = userLanguage;
      
      // 4. 在 context 中注入翻译助手函数
      ctx.__ = async (key: string, params?: any) => {
        return await i18nService.__(key, userLanguage, params);
      };
      
      // 5. 添加设置语言的便捷方法
      ctx.setLanguage = async (newLocale: string) => {
        if (telegramId && i18nService.isLocaleSupported(newLocale)) {
          const saved = await i18nService.setUserLanguage(telegramId, newLocale);
          if (saved) {
            ctx.userLanguage = newLocale;
            
            // 更新翻译函数
            ctx.__ = async (key: string, params?: any) => {
              return await i18nService.__(key, newLocale, params);
            };
            
            logger.info('User language changed', {
              telegramId,
              username,
              oldLanguage: userLanguage,
              newLanguage: newLocale
            });
            
            return true;
          }
        }
        return false;
      };
      
      // 记录语言信息（仅在调试模式下）
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Language middleware processed', {
          telegramId,
          username,
          telegramLangCode,
          userLanguage,
          hasTranslationFunction: typeof ctx.__ === 'function'
        });
      }
      
    } catch (error) {
      logger.error('Language middleware error', {
        error: (error as Error).message,
        telegramId,
        username,
        telegramLangCode
      });
      
      // 出错时使用默认设置
      ctx.userLanguage = 'en';
      ctx.__ = async (key: string, params?: any) => {
        return await i18nService.__(key, 'en', params);
      };
      ctx.setLanguage = async () => false;
    }
    
    return next();
  };
}

/**
 * 扩展 Context 类型定义
 */
declare module 'telegraf' {
  interface Context {
    userLanguage?: string;
    __?: (key: string, params?: any) => Promise<string>;
    setLanguage?: (locale: string) => Promise<boolean>;
  }
}

export default createLanguageMiddleware;