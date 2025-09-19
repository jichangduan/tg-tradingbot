import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { ExtendedContext } from '../index';
import { i18nService } from '../../services/i18n.service';
import { logger } from '../../utils/logger';

/**
 * Language command handler
 * 处理 /language 命令和语言切换功能（双语言版本：英语+中文）
 */
export class LanguageHandler {
  /**
   * Handle /language command
   * @param ctx Telegram context
   * @param args Command arguments
   */
  public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const requestId = ctx.requestId || 'unknown';

    try {
      logger.logCommand('language', userId!, username, args);

      const currentLanguage = ctx.userLanguage || 'en';
      
      // 显示当前语言状态
      const currentLangMsg = await ctx.__!('language.current');
      const selectMsg = await ctx.__!('language.select');
      
      const message = `${currentLangMsg}\n\n${selectMsg}`;
      
      // 创建语言选择键盘
      const keyboard = this.createLanguageKeyboard(currentLanguage);
      
      await ctx.reply(message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

      const duration = Date.now() - startTime;
      logger.info(`Language command completed [${requestId}] - ${duration}ms`, {
        userId,
        username,
        currentLanguage,
        duration,
        requestId
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`Language command failed [${requestId}] - ${duration}ms`, {
        error: (error as Error).message,
        stack: (error as Error).stack,
        duration,
        userId,
        username,
        requestId
      });

      // 发送错误消息
      await this.sendErrorMessage(ctx);
    }
  }

  /**
   * 创建语言选择内联键盘
   * @param currentLang 当前用户语言
   */
  private createLanguageKeyboard(currentLang: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          {
            text: `${currentLang === 'en' ? '✅ ' : ''}🇺🇸 English`,
            callback_data: 'lang_en'
          },
          {
            text: `${currentLang === 'zh-CN' ? '✅ ' : ''}🇨🇳 简体中文`,
            callback_data: 'lang_zh-CN'
          },
          {
            text: `${currentLang === 'ko' ? '✅ ' : ''}🇰🇷 한국어`,
            callback_data: 'lang_ko'
          }
        ]
      ]
    };
  }

  /**
   * 处理语言切换回调查询
   * @param ctx 回调查询 context
   */
  public async handleLanguageChange(ctx: any): Promise<void> {
    const startTime = Date.now();
    const userId = ctx.from?.id;
    const username = ctx.from?.username || 'unknown';
    const callbackData = ctx.callbackQuery?.data;

    try {
      if (!callbackData || !callbackData.startsWith('lang_')) {
        await ctx.answerCbQuery('❌ Invalid language selection');
        return;
      }

      const newLanguage = callbackData.replace('lang_', '');
      
      // 验证语言是否支持
      if (!i18nService.isLocaleSupported(newLanguage)) {
        await ctx.answerCbQuery('❌ Unsupported language');
        return;
      }

      // 切换用户语言
      const success = await ctx.setLanguage(newLanguage);
      
      if (success) {
        // 用新语言发送确认消息
        const confirmMessage = await ctx.__!('language.changed');
        
        // 更新消息内容
        await ctx.editMessageText(confirmMessage, {
          parse_mode: 'HTML'
        });
        
        await ctx.answerCbQuery('✅');
        
        logger.info('User language changed successfully', {
          userId,
          username,
          newLanguage,
          duration: Date.now() - startTime
        });
      } else {
        await ctx.answerCbQuery('❌ Failed to change language');
        
        logger.error('Failed to change user language', {
          userId,
          username,
          requestedLanguage: newLanguage
        });
      }

    } catch (error) {
      logger.error('Language change callback failed', {
        error: (error as Error).message,
        userId,
        username,
        callbackData,
        duration: Date.now() - startTime
      });

      await ctx.answerCbQuery('❌ Error occurred');
    }
  }

  /**
   * 发送错误消息
   */
  private async sendErrorMessage(ctx: Context): Promise<void> {
    const errorMessage = 
      '❌ <b>Language Command Error</b>\n\n' +
      'Sorry, there was an error processing your language settings.\n\n' +
      '💡 <b>You can try:</b>\n' +
      '• Retry /language command\n' +
      '• Contact administrator if the problem persists';

    try {
      await ctx.reply(errorMessage, { parse_mode: 'HTML' });
    } catch (sendError) {
      logger.error('Failed to send language error message', {
        sendError: (sendError as Error).message
      });
    }
  }

  /**
   * 获取支持的语言列表信息（用于调试）
   */
  public async getLanguageInfo(ctx: ExtendedContext): Promise<void> {
    try {
      const stats = i18nService.getStats();
      const currentLanguage = ctx.userLanguage || 'en';
      
      let infoMessage = `🌍 <b>Language System Info</b>\n\n`;
      infoMessage += `📍 Current Language: ${currentLanguage}\n`;
      infoMessage += `🔧 Supported Languages: ${stats.supportedLocales.join(', ')}\n`;
      infoMessage += `📊 Translation Counts:\n`;
      
      for (const [locale, count] of Object.entries(stats.translationCounts)) {
        infoMessage += `  • ${locale}: ${count} keys\n`;
      }
      
      infoMessage += `\n💾 Cache Status: ${stats.cacheLoaded ? '✅ Loaded' : '❌ Not Loaded'}`;
      
      await ctx.reply(infoMessage, { parse_mode: 'HTML' });
      
    } catch (error) {
      logger.error('Failed to get language info', {
        error: (error as Error).message,
        userId: ctx.from?.id
      });
      
      await ctx.reply('❌ Failed to get language information');
    }
  }

  /**
   * 获取处理器统计信息
   */
  public getStats(): any {
    return {
      name: 'LanguageHandler',
      version: '1.0.0',
      supportedCommands: ['/language'],
      supportedCallbacks: ['lang_en', 'lang_zh-CN', 'lang_ko'],
      features: [
        'Language selection interface',
        'Auto language detection from Telegram',
        'User preference persistence',
        'Real-time language switching',
        'Trilingual support (English + Chinese + Korean)'
      ]
    };
  }
}

// 导出单例实例
export const languageHandler = new LanguageHandler();

// 默认导出
export default languageHandler;