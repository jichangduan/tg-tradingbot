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
    logger.info(`🔄 [PUSH_DATA] Starting push data retrieval for user ${userId}`);
  }

  /**
   * 记录令牌获取状态
   */
  static logTokenStatus(userId: string, hasToken: boolean): void {
    if (hasToken) {
      logger.info(`🔑 [PUSH_DATA] Using cached token for user ${userId}`);
    } else {
      logger.info(`🔑 [PUSH_DATA] No cached token found for user ${userId}, initializing user`);
    }
  }

  /**
   * 记录令牌初始化成功
   */
  static logTokenInitialized(userId: string): void {
    logger.info(`🔑 [PUSH_DATA] User ${userId} token initialized successfully`);
  }

  /**
   * 记录API调用开始
   */
  static logApiCallStart(userId: string): void {
    logger.info(`📡 [PUSH_DATA] Fetching push settings from API for user ${userId}`);
  }

  /**
   * 记录API响应详情
   */
  static logApiResponse(userId: string, response: any, duration: number): void {
    logger.info(`📦 [PUSH_DATA] API response received for user ${userId}`, {
      durationMs: duration,
      durationText: `${duration}ms`,
      hasResponse: !!response,
      hasData: !!response?.data,
      hasPushData: !!response?.data?.push_data,
      userSettings: response?.data?.user_settings,
      pushDataKeys: response?.data?.push_data ? Object.keys(response.data.push_data) : [],
      flashNewsCount: response?.data?.push_data?.flash_news?.length || 0,
      whaleActionsCount: response?.data?.push_data?.whale_actions?.length || 0,
      fundFlowsCount: response?.data?.push_data?.fund_flows?.length || 0
    });
  }

  /**
   * 记录测试数据创建
   */
  static logTestDataCreated(userId: string, testData: PushData): void {
    logger.warn(`⚠️ [PUSH_DATA] No push data from API for user ${userId}, creating test data`);
    logger.info(`🧪 [PUSH_DATA] Created test push data for user ${userId}`, {
      testDataKeys: Object.keys(testData),
      flashCount: testData.flash_news?.length || 0,
      whaleCount: testData.whale_actions?.length || 0,
      fundCount: testData.fund_flows?.length || 0
    });
  }

  /**
   * 记录数据获取成功
   */
  static logDataFetchSuccess(userId: string, duration: number): void {
    logger.info(`✅ [PUSH_DATA] Successfully retrieved push data for user ${userId}`, {
      durationMs: duration,
      durationText: `${duration}ms`,
      dataAvailable: true
    });
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
    logger.info(`🧪 [PUSH_DATA] Returning fallback test data for user ${userId} due to error`);
  }

  /**
   * 记录内容检查开始
   */
  static logContentCheckStart(pushData: PushData | undefined): void {
    logger.info(`🔍 [CONTENT_CHECK] Starting push content validation`, {
      hasPushData: !!pushData,
      pushDataType: typeof pushData
    });
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
    const hasFlashNews = pushData.flash_news && pushData.flash_news.length > 0;
    const hasWhaleActions = pushData.whale_actions && pushData.whale_actions.length > 0;
    const hasFundFlows = pushData.fund_flows && pushData.fund_flows.length > 0;

    logger.info(`📊 [CONTENT_CHECK] Content analysis results`, {
      flashNews: {
        exists: !!pushData.flash_news,
        count: pushData.flash_news?.length || 0,
        hasContent: hasFlashNews,
        sample: pushData.flash_news?.[0] ? {
          title: pushData.flash_news[0].title?.substring(0, 50),
          hasTitle: !!pushData.flash_news[0].title,
          hasContent: !!pushData.flash_news[0].content
        } : null
      },
      whaleActions: {
        exists: !!pushData.whale_actions,
        count: pushData.whale_actions?.length || 0,
        hasContent: hasWhaleActions,
        sample: pushData.whale_actions?.[0] ? {
          action: pushData.whale_actions[0].action,
          hasAction: !!pushData.whale_actions[0].action,
          hasAmount: !!pushData.whale_actions[0].amount
        } : null
      },
      fundFlows: {
        exists: !!pushData.fund_flows,
        count: pushData.fund_flows?.length || 0,
        hasContent: hasFundFlows,
        sample: pushData.fund_flows?.[0] ? {
          from: pushData.fund_flows[0].from,
          hasFrom: !!pushData.fund_flows[0].from,
          hasAmount: !!pushData.fund_flows[0].amount
        } : null
      }
    });
  }

  /**
   * 记录内容检查最终结果
   */
  static logContentCheckResult(hasAnyContent: boolean, pushData: PushData): void {
    const hasFlashNews = pushData.flash_news && pushData.flash_news.length > 0;
    const hasWhaleActions = pushData.whale_actions && pushData.whale_actions.length > 0;
    const hasFundFlows = pushData.fund_flows && pushData.fund_flows.length > 0;

    logger.info(`${hasAnyContent ? '✅' : '❌'} [CONTENT_CHECK] Content validation result`, {
      hasAnyContent,
      contentTypes: {
        flash: hasFlashNews,
        whale: hasWhaleActions,
        fund: hasFundFlows
      },
      totalContentItems: (pushData.flash_news?.length || 0) + 
                          (pushData.whale_actions?.length || 0) + 
                          (pushData.fund_flows?.length || 0)
    });
  }

  /**
   * 记录消息发送流程开始
   */
  static logMessageSendStart(userId: string, settings: PushSettings, hasPushData: boolean): void {
    logger.info(`📤 [MESSAGE_SEND] Starting message send process for user ${userId}`, {
      settings,
      hasPushData
    });
  }

  /**
   * 记录Telegram Bot状态
   */
  static logTelegramBotStatus(userId: string, isAvailable: boolean): void {
    if (isAvailable) {
      logger.info(`🤖 [MESSAGE_SEND] Telegram Bot instance available for user ${userId}`);
    } else {
      logger.error(`❌ [MESSAGE_SEND] Telegram Bot instance not available for user ${userId}`);
    }
  }

  /**
   * 记录推送内容检查
   */
  static logPushContentCheck(userId: string, hasPushData: boolean, pushDataKeys: string[]): void {
    logger.info(`🔍 [MESSAGE_SEND] Checking push content for user ${userId}`, {
      hasPushData,
      pushDataKeys
    });
  }

  /**
   * 记录内容过滤结果
   */
  static logContentFiltering(userId: string, flashCount: number, whaleCount: number, fundCount: number, settings: PushSettings): void {
    logger.info(`📋 [MESSAGE_SEND] Content filtering results for user ${userId}`, {
      flashNewsFiltered: flashCount,
      whaleActionsFiltered: whaleCount,
      fundFlowsFiltered: fundCount,
      userSettings: settings
    });
  }

  /**
   * 记录消息格式化结果
   */
  static logMessageFormatting(userId: string, messages: any[]): void {
    logger.info(`⚙️ [MESSAGE_SEND] Formatting messages for user ${userId}`);
    logger.info(`📝 [MESSAGE_SEND] Message formatting completed for user ${userId}`, {
      messageCount: messages.length,
      messagePreview: messages.map(msg => ({
        contentLength: msg.content?.length || 0,
        hasKeyboard: !!msg.keyboard,
        keyboardButtonCount: msg.keyboard ? msg.keyboard.length : 0
      }))
    });
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