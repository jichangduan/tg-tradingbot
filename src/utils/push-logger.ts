import { logger } from './logger';
import { PushSettings, PushData } from '../services/push.service';

/**
 * 推送相关的专用日志工具
 * 提供统一的推送流程日志记录功能
 */
export class PushLogger {
  
  /**
   * 记录推送数据获取开始
   */
  static logDataFetchStart(userId: string): void {
    // 删除详细的开始日志，减少噪音
  }

  /**
   * 记录令牌获取状态
   */
  static logTokenStatus(userId: string, hasToken: boolean): void {
    // 删除令牌状态详细日志
  }

  /**
   * 记录令牌初始化成功
   */
  static logTokenInitialized(userId: string): void {
    // 删除令牌初始化日志
  }

  /**
   * 记录API调用开始
   */
  static logApiCallStart(userId: string): void {
    // 删除API调用开始日志
  }

  /**
   * 记录API响应详情
   */
  static logApiResponse(userId: string, response: any, duration: number): void {
    // 删除详细的API响应日志，减少日志量
  }

  /**
   * 记录测试数据创建
   */
  static logTestDataCreated(userId: string, testData: PushData): void {
    logger.warn(`⚠️ [PUSH_DATA] No push data from API for user ${userId}, using fallback data`);
  }

  /**
   * 记录数据获取成功
   */
  static logDataFetchSuccess(userId: string, duration: number): void {
    // 删除数据获取成功的详细日志
  }

  /**
   * 记录数据获取错误和备用数据
   */
  static logDataFetchError(userId: string, duration: number, error: Error): void {
    logger.error(`❌ [PUSH_DATA] Failed to get push data for user ${userId}`, {
      durationMs: duration,
      durationText: `${duration}ms`,
      error: error.message,
      stack: error.stack
    });
    // 删除fallback数据日志
  }

  /**
   * 记录内容检查开始
   */
  static logContentCheckStart(pushData: PushData | undefined): void {
    // 删除内容检查开始日志
  }

  /**
   * 记录内容检查失败（无数据）
   */
  static logContentCheckFailed(): void {
    logger.warn(`❌ [CONTENT_CHECK] No push data provided - content check failed`);
  }

  /**
   * 记录详细的内容分析结果
   */
  static logContentAnalysis(pushData: PushData): void {
    // 删除详细的内容分析日志，减少噪音
  }

  /**
   * 记录内容检查最终结果
   */
  static logContentCheckResult(hasAnyContent: boolean, pushData: PushData): void {
    // 保留关键结果信息
    if (hasAnyContent) {
      const totalItems = (pushData.flash_news?.length || 0) + 
                        (pushData.whale_actions?.length || 0) + 
                        (pushData.fund_flows?.length || 0);
      logger.info(`✅ [CONTENT_CHECK] Found ${totalItems} items to push`);
    }
  }

  /**
   * 记录消息发送流程开始
   */
  static logMessageSendStart(userId: string, settings: PushSettings, hasPushData: boolean): void {
    // 删除消息发送开始日志
  }

  /**
   * 记录Telegram Bot状态
   */
  static logTelegramBotStatus(userId: string, isAvailable: boolean): void {
    if (!isAvailable) {
      logger.error(`❌ [MESSAGE_SEND] Telegram Bot instance not available for user ${userId}`);
    }
  }

  /**
   * 记录推送内容检查
   */
  static logPushContentCheck(userId: string, hasPushData: boolean, pushDataKeys: string[]): void {
    // 删除推送内容检查日志
  }

  /**
   * 记录内容过滤结果
   */
  static logContentFiltering(userId: string, flashCount: number, whaleCount: number, fundCount: number, settings: PushSettings): void {
    // 删除内容过滤详细日志
  }

  /**
   * 记录消息格式化结果
   */
  static logMessageFormatting(userId: string, messages: any[]): void {
    // 删除消息格式化过程日志
  }

  /**
   * 记录消息发送完成
   */
  static logMessageSendComplete(userId: string, messageCount: number, duration: number, totalContentLength: number): void {
    logger.info(`🎉 [MESSAGE_SEND] All push messages sent successfully to user ${userId}`, {
      messageCount,
      durationMs: duration,
      durationText: `${duration}ms`,
      totalContentSent: totalContentLength
    });
  }

  /**
   * 记录消息发送错误
   */
  static logMessageSendError(userId: string, duration: number, error: Error, settings: PushSettings, hasPushData: boolean): void {
    logger.error(`💥 [MESSAGE_SEND] Failed to send push messages to user ${userId}`, {
      error: error.message,
      stack: error.stack,
      durationMs: duration,
      durationText: `${duration}ms`,
      settings,
      hasPushData
    });
  }
}