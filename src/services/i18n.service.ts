import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { cacheService } from './cache.service';

/**
 * I18nService - 国际化翻译服务
 * 基于 lastmemefi-api 架构设计，支持内存缓存和参数插值
 */
export class I18nService {
  private static instance: I18nService;
  private translationCache: Record<string, Record<string, string>> = {};
  private cacheLoaded = false;
  private supportedLocales = ['en', 'zh-CN', 'ko'];
  private defaultLocale = 'en';

  public static getInstance(): I18nService {
    if (!I18nService.instance) {
      I18nService.instance = new I18nService();
    }
    return I18nService.instance;
  }

  /**
   * 延迟加载翻译文件到内存缓存
   */
  private async loadTranslations(): Promise<void> {
    if (this.cacheLoaded) return;

    try {
      const localesDir = path.join(__dirname, '../locales');
      
      logger.info('🌍 Starting translation file loading', {
        localesDir,
        supportedLocales: this.supportedLocales,
        defaultLocale: this.defaultLocale,
        directoryExists: fs.existsSync(localesDir)
      });
      
      if (fs.existsSync(localesDir)) {
        const files = fs.readdirSync(localesDir);
        logger.info('📁 Found files in locales directory', { files });
        
        for (const file of files) {
          if (file.endsWith('.json')) {
            const locale = file.replace('.json', '');
            
            logger.info(`🔍 Processing locale file: ${file}`, {
              file,
              locale,
              isSupported: this.supportedLocales.includes(locale)
            });
            
            // 只加载支持的语言
            if (this.supportedLocales.includes(locale)) {
              const filePath = path.join(localesDir, file);
              
              try {
                const content = fs.readFileSync(filePath, 'utf8');
                const parsedContent = JSON.parse(content);
                this.translationCache[locale] = parsedContent;
                
                const keyCount = Object.keys(parsedContent).length;
                
                logger.info(`✅ Successfully loaded ${locale} translations`, {
                  locale,
                  filePath,
                  keyCount,
                  sampleKeys: Object.keys(parsedContent).slice(0, 5),
                  hasPositionsOverview: !!parsedContent['positions.overview'],
                  hasPnlAnalysisReport: !!parsedContent['pnl.analysisReport']
                });
                
              } catch (fileError) {
                logger.error(`❌ Failed to load ${locale} translation file`, {
                  locale,
                  filePath,
                  error: (fileError as Error).message,
                  stack: (fileError as Error).stack
                });
              }
            } else {
              logger.warn(`⚠️ Skipping unsupported locale: ${locale}`, {
                file,
                locale,
                supportedLocales: this.supportedLocales
              });
            }
          }
        }
        
        this.cacheLoaded = true;
        
        // 详细记录加载结果
        const loadingSummary = {
          success: true,
          loadedLocales: Object.keys(this.translationCache),
          translationCounts: Object.fromEntries(
            Object.entries(this.translationCache).map(([locale, translations]) => [
              locale,
              Object.keys(translations).length
            ])
          ),
          defaultLocaleKeys: Object.keys(this.translationCache[this.defaultLocale] || {}).length,
          criticalKeysCheck: {
            english: {
              'positions.overview': this.translationCache['en']?.['positions.overview'] || 'MISSING',
              'pnl.analysisReport': this.translationCache['en']?.['pnl.analysisReport'] || 'MISSING'
            },
            chinese: {
              'positions.overview': this.translationCache['zh-CN']?.['positions.overview'] || 'MISSING',
              'pnl.analysisReport': this.translationCache['zh-CN']?.['pnl.analysisReport'] || 'MISSING'
            }
          }
        };
        
        logger.info('🎉 Translation loading completed', loadingSummary);
        
        // 启动时验证英文翻译
        await this.validateEnglishTranslations();
        
        // 如果英文翻译缺失，尝试强制重新加载
        if (!this.translationCache['en'] || Object.keys(this.translationCache['en']).length === 0) {
          logger.warn('⚠️ English translations missing, attempting force reload');
          await this.forceReloadEnglishTranslations();
        }
        
      } else {
        logger.error('❌ Locales directory not found', { 
          localesDir,
          currentWorkingDir: process.cwd(),
          __dirname
        });
      }
    } catch (error) {
      logger.error('💥 Critical error loading translation files', { 
        error: (error as Error).message,
        stack: (error as Error).stack,
        localesDir: path.join(__dirname, '../locales')
      });
    }
  }

  /**
   * 核心翻译方法 - 完全对标 lastmemefi-api 的 req.__(key, ...params)
   * @param key 翻译键值，支持嵌套路径如 'welcome.title'
   * @param locale 语言代码，默认为 'en'
   * @param params 参数对象或参数数组
   */
  public async __(key: string, locale: string = 'en', params?: any): Promise<string> {
    await this.loadTranslations();
    
    // 🔍 详细调试翻译查找过程
    const debugInfo = {
      key,
      requestedLocale: locale,
      defaultLocale: this.defaultLocale,
      cacheLoaded: this.cacheLoaded,
      availableLocales: Object.keys(this.translationCache),
      localeHasTranslations: !!this.translationCache[locale],
      keyExistsInLocale: !!this.translationCache[locale]?.[key],
      keyExistsInDefault: !!this.translationCache[this.defaultLocale]?.[key]
    };
    
    // 1. 尝试获取指定语言的翻译
    let translation = this.translationCache[locale]?.[key];
    
    if (translation) {
      logger.debug('✅ Translation found in requested locale', {
        ...debugInfo,
        translationFound: true,
        translationValue: translation
      });
    } else {
      logger.info('⚠️ Translation not found in requested locale', debugInfo);
    }
    
    // 2. 如果没有找到，回退到默认语言（英文）
    if (!translation && locale !== this.defaultLocale) {
      translation = this.translationCache[this.defaultLocale]?.[key];
      
      if (translation) {
        logger.warn('🔄 Translation fallback to default locale successful', { 
          ...debugInfo,
          fallbackSuccessful: true,
          translationValue: translation
        });
      } else {
        logger.error('❌ Translation fallback to default locale failed', {
          ...debugInfo,
          fallbackFailed: true,
          defaultLocaleTranslations: Object.keys(this.translationCache[this.defaultLocale] || {}).length
        });
      }
    }
    
    // 3. 如果还是没有，返回原始key
    if (!translation) {
      logger.error('💥 Translation completely missing', { 
        ...debugInfo,
        returnedKey: key,
        availableKeysInDefault: Object.keys(this.translationCache[this.defaultLocale] || {}).slice(0, 10),
        translationCacheDump: {
          en: Object.keys(this.translationCache['en'] || {}).length,
          'zh-CN': Object.keys(this.translationCache['zh-CN'] || {}).length,
          ko: Object.keys(this.translationCache['ko'] || {}).length
        }
      });
      return key;
    }
    
    // 4. 参数替换 - 支持对象参数 {symbol: 'BTC', price: '50000'} 
    if (params) {
      const interpolated = this.interpolateParams(translation, params);
      logger.debug('🔧 Translation interpolated with params', {
        key,
        locale,
        originalTranslation: translation,
        interpolatedTranslation: interpolated,
        params
      });
      return interpolated;
    }
    
    logger.debug('✅ Translation returned successfully', {
      key,
      locale,
      translation
    });
    
    return translation;
  }

  /**
   * 参数插值 - 支持 {key} 格式的参数替换
   * @param template 模板字符串，如 "Hello {name}!"
   * @param params 参数对象，如 {name: 'World'}
   */
  private interpolateParams(template: string, params: any): string {
    if (typeof params === 'object' && params !== null) {
      return template.replace(/{(\w+)}/g, (match, key) => {
        return params[key] !== undefined ? String(params[key]) : match;
      });
    }
    
    // 如果传入的是其他类型，直接替换第一个参数位置
    return template.replace(/{(\w+)}/g, () => String(params));
  }

  /**
   * 获取用户语言偏好
   * @param telegramId Telegram 用户 ID
   */
  public async getUserLanguage(telegramId?: number): Promise<string> {
    if (!telegramId) {
      return this.defaultLocale;
    }
    
    try {
      const cacheKey = `user:lang:${telegramId}`;
      const result = await cacheService.get(cacheKey);
      const userLang = (result.data as string) || this.defaultLocale;
      
      // 确保返回的语言在支持列表中
      return this.supportedLocales.includes(userLang) ? userLang : this.defaultLocale;
    } catch (error) {
      logger.error('Failed to get user language preference', { 
        telegramId, 
        error: (error as Error).message 
      });
      return this.defaultLocale;
    }
  }

  /**
   * 设置用户语言偏好
   * @param telegramId Telegram 用户 ID
   * @param locale 语言代码
   */
  public async setUserLanguage(telegramId: number, locale: string): Promise<boolean> {
    try {
      if (!this.supportedLocales.includes(locale)) {
        logger.warn('Unsupported locale', { locale, supportedLocales: this.supportedLocales });
        return false;
      }
      
      const cacheKey = `user:lang:${telegramId}`;
      const ttl = 365 * 24 * 60 * 60; // 1年有效期
      const result = await cacheService.set(cacheKey, locale, ttl);
      
      if (result.success) {
        logger.info('User language preference saved', { telegramId, locale });
        return true;
      } else {
        logger.error('Failed to save user language preference', { 
          telegramId, 
          locale, 
          error: result.error 
        });
        return false;
      }
    } catch (error) {
      logger.error('Error setting user language preference', { 
        telegramId, 
        locale, 
        error: (error as Error).message 
      });
      return false;
    }
  }

  /**
   * 从Telegram语言代码检测用户语言
   * @param languageCode Telegram 用户的 language_code
   */
  public detectLanguageFromTelegram(languageCode?: string): string {
    if (!languageCode) {
      return this.defaultLocale;
    }
    
    const lowerCode = languageCode.toLowerCase();
    
    // 精确匹配
    if (this.supportedLocales.includes(lowerCode)) {
      return lowerCode;
    }
    
    // 中文语言检测
    if (lowerCode.startsWith('zh-cn') || lowerCode.startsWith('zh-hans')) {
      return 'zh-CN';
    }
    if (lowerCode.startsWith('zh')) {
      return 'zh-CN'; // 默认简体中文
    }
    
    // 韩文
    if (lowerCode.startsWith('ko')) {
      return 'ko';
    }
    
    // 英文
    if (lowerCode.startsWith('en')) {
      return 'en';
    }
    
    return this.defaultLocale;
  }

  /**
   * 获取支持的语言列表
   */
  public getSupportedLocales(): string[] {
    return [...this.supportedLocales];
  }

  /**
   * 获取默认语言
   */
  public getDefaultLocale(): string {
    return this.defaultLocale;
  }

  /**
   * 检查是否支持某个语言
   */
  public isLocaleSupported(locale: string): boolean {
    return this.supportedLocales.includes(locale);
  }

  /**
   * 重新加载翻译文件（热更新，用于开发调试）
   */
  public async reloadTranslations(): Promise<void> {
    logger.info('🔄 Starting translation reload');
    this.cacheLoaded = false;
    this.translationCache = {};
    await this.loadTranslations();
    
    // 重新加载后验证英文翻译
    await this.validateEnglishTranslations();
    
    logger.info('✅ Translation files reloaded successfully');
  }

  /**
   * 获取翻译统计信息
   */
  public getStats(): any {
    return {
      supportedLocales: this.supportedLocales,
      defaultLocale: this.defaultLocale,
      cacheLoaded: this.cacheLoaded,
      translationCounts: Object.fromEntries(
        Object.entries(this.translationCache).map(([locale, translations]) => [
          locale,
          Object.keys(translations).length
        ])
      )
    };
  }

  /**
   * 验证英文翻译是否正确加载（专门用于调试英文问题）
   */
  public async validateEnglishTranslations(): Promise<any> {
    await this.loadTranslations();
    
    const criticalKeys = [
      'positions.overview',
      'positions.accountInfo', 
      'positions.currentPositions',
      'pnl.analysisReport',
      'pnl.realizedSummary',
      'pnl.tradingStatistics'
    ];
    
    const englishCache = this.translationCache['en'] || {};
    const validation = {
      englishCacheExists: !!this.translationCache['en'],
      englishKeyCount: Object.keys(englishCache).length,
      criticalKeysValidation: {} as Record<string, any>,
      firstTenKeys: Object.keys(englishCache).slice(0, 10),
      sampleTranslations: {} as Record<string, string>
    };
    
    // 验证关键翻译键
    for (const key of criticalKeys) {
      const translation = englishCache[key];
      validation.criticalKeysValidation[key] = {
        exists: !!translation,
        value: translation || 'MISSING',
        type: typeof translation
      };
      
      if (translation) {
        validation.sampleTranslations[key] = translation;
      }
    }
    
    logger.info('🔍 English translation validation results', validation);
    
    return validation;
  }

  /**
   * 强制重新加载英文翻译（应急修复方法）
   */
  public async forceReloadEnglishTranslations(): Promise<boolean> {
    try {
      const localesDir = path.join(__dirname, '../locales');
      const englishFilePath = path.join(localesDir, 'en.json');
      
      logger.info('🔄 Force reloading English translations', {
        localesDir,
        englishFilePath,
        fileExists: fs.existsSync(englishFilePath)
      });
      
      if (fs.existsSync(englishFilePath)) {
        const content = fs.readFileSync(englishFilePath, 'utf8');
        const parsedContent = JSON.parse(content);
        
        // 强制更新英文缓存
        this.translationCache['en'] = parsedContent;
        
        const keyCount = Object.keys(parsedContent).length;
        logger.info('✅ English translations force reloaded successfully', {
          keyCount,
          hasPositionsOverview: !!parsedContent['positions.overview'],
          hasPnlAnalysisReport: !!parsedContent['pnl.analysisReport'],
          sampleKeys: Object.keys(parsedContent).slice(0, 5)
        });
        
        return true;
      } else {
        logger.error('❌ English translation file not found for force reload', {
          englishFilePath
        });
        return false;
      }
    } catch (error) {
      logger.error('❌ Force reload of English translations failed', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      return false;
    }
  }
}

// 导出单例实例
export const i18nService = I18nService.getInstance();

// 默认导出
export default i18nService;