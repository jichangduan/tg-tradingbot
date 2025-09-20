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
        const storedLanguage = await i18nService.getUserLanguage(telegramId);
        
        // 2. 检查是否是真正的新用户（没有任何语言设置记录）
        const isNewUser = await isNewUserCheck(telegramId);
        
        logger.debug('🔍 Language detection process', {
          telegramId,
          username,
          storedLanguage,
          telegramLangCode,
          isNewUser,
          requestId: (ctx as any).requestId
        });
        
        if (isNewUser && telegramLangCode) {
          // 只对真正的新用户进行自动语言检测
          const detectedLang = i18nService.detectLanguageFromTelegram(telegramLangCode);
          
          logger.info('🌍 Auto-detecting language for new user', {
            telegramId,
            username,
            telegramLangCode,
            detectedLanguage: detectedLang,
            willSetLanguage: detectedLang !== 'en'
          });
          
          if (detectedLang !== 'en') {
            const saved = await i18nService.setUserLanguage(telegramId, detectedLang);
            if (saved) {
              userLanguage = detectedLang;
              
              logger.info('✅ Auto-detected and set user language for new user', {
                telegramId,
                username,
                telegramLangCode,
                detectedLanguage: detectedLang,
                previousLanguage: 'en'
              });
            }
          } else {
            // 新用户但检测为英文，显式设置为英文以标记非新用户
            await i18nService.setUserLanguage(telegramId, 'en');
            userLanguage = 'en';
            
            logger.info('✅ Set English for new English-speaking user', {
              telegramId,
              username,
              telegramLangCode
            });
          }
        } else {
          // 现有用户，尊重已存储的语言选择，绝不覆盖
          userLanguage = storedLanguage;
          
          logger.debug('✅ Using stored language preference for existing user', {
            telegramId,
            username,
            storedLanguage,
            telegramLangCode,
            willNotOverride: true
          });
        }
      }
      
      // 3. 将用户语言添加到 context 中
      ctx.userLanguage = userLanguage;
      
      // 4. 在 context 中注入翻译助手函数
      ctx.__ = async (key: string, params?: any) => {
        return await i18nService.__(key, userLanguage, params);
      };
      
      // 4a. 添加 __! 函数作为 __ 的别名（用于兼容现有代码）
      ctx.__! = async (key: string, params?: any) => {
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
            
            ctx.__! = async (key: string, params?: any) => {
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
      ctx.__! = async (key: string, params?: any) => {
        return await i18nService.__(key, 'en', params);
      };
      ctx.setLanguage = async () => false;
    }
    
    return next();
  };
}

/**
 * 检查是否为新用户（没有语言偏好记录）
 */
async function isNewUserCheck(telegramId: number): Promise<boolean> {
  try {
    const cacheKey = `user:lang:${telegramId}`;
    const result = await import('../services/cache.service').then(m => m.cacheService.get(cacheKey));
    
    // 如果缓存中没有记录，说明是新用户
    const isNew = !result.success || !result.data;
    
    logger.debug('🔍 New user check result', {
      telegramId,
      cacheKey,
      cacheSuccess: result.success,
      hasData: !!result.data,
      storedValue: result.data,
      isNewUser: isNew
    });
    
    return isNew;
  } catch (error) {
    logger.error('Error checking if user is new', {
      telegramId,
      error: (error as Error).message
    });
    // 出错时保守处理，认为是新用户
    return true;
  }
}

/**
 * 扩展 Context 类型定义
 */
declare module 'telegraf' {
  interface Context {
    userLanguage?: string;
    __?: (key: string, params?: any) => Promise<string>;
    '__!'?: (key: string, params?: any) => Promise<string>;
    setLanguage?: (locale: string) => Promise<boolean>;
  }
}

export default createLanguageMiddleware;