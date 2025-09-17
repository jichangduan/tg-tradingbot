import { PushSettings, PushData, pushService } from './push.service';
import { PushLogger } from '../utils/push-logger';
import { logger } from '../utils/logger';
import { getUserToken, getUserAccessToken } from '../utils/auth';

/**
 * 推送数据管理服务
 * 负责获取和处理用户的推送数据
 */
export class PushDataService {

  /**
   * 为用户获取推送数据
   * 从push.service.ts的getUserPushSettings中获取推送数据
   */
  public async getPushDataForUser(userId: string): Promise<PushData | undefined> {
    const startTime = Date.now();
    
    try {
      PushLogger.logDataFetchStart(userId);
      
      // 获取访问令牌
      let accessToken = await getUserToken(userId);
      
      if (!accessToken) {
        PushLogger.logTokenStatus(userId, false);
        
        const userInfo = {
          username: undefined,
          first_name: undefined,
          last_name: undefined
        };
        
        accessToken = await getUserAccessToken(userId, userInfo);
        PushLogger.logTokenInitialized(userId);
      } else {
        PushLogger.logTokenStatus(userId, true);
      }

      // 获取用户推送设置，其中包含推送数据
      PushLogger.logApiCallStart(userId);
      const response = await pushService.getUserPushSettings(userId, accessToken);
      
      // 详细日志记录API响应
      const duration = Date.now() - startTime;
      PushLogger.logApiResponse(userId, response, duration);
      
      // 🔍 详细分析API响应结构 - 用于调试立即推送问题
      logger.info(`🔍 [IMMEDIATE_PUSH_DEBUG] Detailed API response analysis`, {
        userId: parseInt(userId),
        responseExists: !!response,
        hasData: !!response?.data,
        hasPushData: !!response?.data?.push_data,
        hasUserSettings: !!response?.data?.user_settings,
        pushDataType: typeof response?.data?.push_data,
        pushDataKeys: response?.data?.push_data ? Object.keys(response.data.push_data) : 'none',
        flashNewsCount: response?.data?.push_data?.flash_news?.length || 0,
        whaleActionsCount: response?.data?.push_data?.whale_actions?.length || 0,
        fundFlowsCount: response?.data?.push_data?.fund_flows?.length || 0,
        responseCode: response?.code,
        responseMessage: response?.message?.substring(0, 100) || 'no_message',
        apiCallContext: 'immediate_push_request'
      });
      
      // 检查推送数据是否存在
      if (!response?.data?.push_data) {
        logger.warn(`⚠️ [IMMEDIATE_PUSH_DEBUG] API returned empty push_data`, {
          userId: parseInt(userId),
          fullResponse: JSON.stringify(response).substring(0, 1000),
          expectedFields: ['flash_news', 'whale_actions', 'fund_flows'],
          duration
        });
        PushLogger.logDataFetchSuccess(userId, duration);
        return undefined; // 返回undefined而不是测试数据
      }
      
      // 直接返回AIW3真实推送数据
      PushLogger.logDataFetchSuccess(userId, duration);
      return response.data.push_data;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // 详细记录错误信息以便调试
      logger.error(`🚨 [PUSH_DATA] Detailed error analysis for user ${userId}`, {
        errorName: (error as Error).name,
        errorMessage: (error as Error).message,
        errorStack: (error as Error).stack,
        durationMs: duration,
        durationText: `${duration}ms`,
        userIdStr: userId,
        errorType: error instanceof Error ? error.constructor.name : typeof error
      });
      
      PushLogger.logDataFetchError(userId, duration, error as Error);
      
      // 直接抛出错误，不使用fallback测试数据
      throw error;
    }
  }

  /**
   * 检查是否有新的推送内容
   */
  public hasNewPushContent(pushData: PushData | undefined): boolean {
    PushLogger.logContentCheckStart(pushData);
    
    if (!pushData) {
      PushLogger.logContentCheckFailed();
      return false;
    }
    
    // 检查是否有任何推送内容
    const hasFlashNews = pushData.flash_news && pushData.flash_news.length > 0;
    const hasWhaleActions = pushData.whale_actions && pushData.whale_actions.length > 0;
    const hasFundFlows = pushData.fund_flows && pushData.fund_flows.length > 0;
    
    // 详细记录每种内容类型的状态
    PushLogger.logContentAnalysis(pushData);
    
    const hasAnyContent = !!(hasFlashNews || hasWhaleActions || hasFundFlows);
    
    PushLogger.logContentCheckResult(hasAnyContent, pushData);
    
    return hasAnyContent;
  }


  /**
   * 根据用户设置筛选推送内容
   */
  public filterPushContent(pushData: PushData, settings: PushSettings): {
    flashNews: any[];
    whaleActions: any[];
    fundFlows: any[];
  } {
    const flashNews = settings.flash_enabled ? pushData.flash_news || [] : [];
    let whaleActions = settings.whale_enabled ? pushData.whale_actions || [] : [];
    let fundFlows = settings.fund_enabled ? pushData.fund_flows || [] : [];
    
    // 对鲸鱼交易进行金额过滤，小于$1,000,000的不推送
    if (whaleActions.length > 0) {
      whaleActions = this.filterWhaleActionsByAmount(whaleActions);
    }
    
    // 对资金流向进行金额过滤，小于$1,000,000的不推送  
    // if (fundFlows.length > 0) {
    //   fundFlows = this.filterFundFlowsByAmount(fundFlows);
    // }
    
    return { flashNews, whaleActions, fundFlows };
  }

  /**
   * 根据交易金额过滤鲸鱼动作
   * @param whaleActions 鲸鱼动作数组
   * @returns 过滤后的鲸鱼动作数组
   */
  private filterWhaleActionsByAmount(whaleActions: any[]): any[] {
    const minThreshold = 1000000; // $1,000,000 门槛
    
    return whaleActions.filter(action => {
      try {
        // 使用 positionValue 字段进行过滤，而不是 amount
        const positionValue = action.positionValue || action.amount;
        
        if (!positionValue) {
          // 没有金额信息的记录直接过滤掉，避免推送异常数据
          logger.debug('Filtering out whale action without position value', {
            action: JSON.stringify(action),
            address: action.address
          });
          return false;
        }
        
        let parsedAmount: number;
        
        // 如果 positionValue 是数字，直接使用
        if (typeof positionValue === 'number') {
          parsedAmount = positionValue;
        } 
        // 如果是字符串，进行解析
        else if (typeof positionValue === 'string') {
          const parsed = this.parseAmountToUSD(positionValue);
          if (parsed === null) {
            logger.debug('Failed to parse whale action position value, filtering out', {
              positionValue: positionValue,
              address: action.address
            });
            return false; // 解析失败的异常数据不推送
          }
          parsedAmount = parsed;
        } 
        // 其他类型直接过滤掉
        else {
          logger.debug('Invalid positionValue type, filtering out', {
            positionValue: positionValue,
            positionValueType: typeof positionValue,
            address: action.address
          });
          return false;
        }
        
        const shouldKeep = parsedAmount >= minThreshold;
        
        if (!shouldKeep) {
          logger.debug('Filtering out whale action below threshold', {
            positionValue: positionValue,
            parsedAmount: parsedAmount,
            threshold: minThreshold,
            address: action.address
          });
        }
        
        return shouldKeep;
        
      } catch (error) {
        logger.warn('Error filtering whale action by amount', {
          error: (error as Error).message,
          action
        });
        return false; // 出错时不保留记录，避免推送异常数据
      }
    });
  }

  /**
   * 根据交易金额过滤资金流向
   * @param fundFlows 资金流向数组
   * @returns 过滤后的资金流向数组
   */
  private filterFundFlowsByAmount(fundFlows: any[]): any[] {
    const minThreshold = 1000000; // $1,000,000 门槛
    
    return fundFlows.filter(flow => {
      try {
        // 资金流向可能使用 amount, value, 或者其他字段
        const flowAmount = flow.amount || flow.value || flow.positionValue;
        
        if (!flowAmount) {
          // 没有金额信息的记录直接过滤掉，避免推送异常数据
          logger.debug('Filtering out fund flow without amount value', {
            flow: JSON.stringify(flow),
            address: flow.address || flow.from || flow.to
          });
          return false;
        }
        
        let parsedAmount: number;
        
        // 如果金额是数字，直接使用
        if (typeof flowAmount === 'number') {
          parsedAmount = flowAmount;
        } 
        // 如果是字符串，进行解析
        else if (typeof flowAmount === 'string') {
          const parsed = this.parseAmountToUSD(flowAmount);
          if (parsed === null) {
            logger.debug('Failed to parse fund flow amount, filtering out', {
              amount: flowAmount,
              address: flow.address || flow.from || flow.to
            });
            return false; // 解析失败的异常数据不推送
          }
          parsedAmount = parsed;
        } 
        // 其他类型直接过滤掉
        else {
          logger.debug('Invalid fund flow amount type, filtering out', {
            amount: flowAmount,
            amountType: typeof flowAmount,
            address: flow.address || flow.from || flow.to
          });
          return false;
        }
        
        const shouldKeep = parsedAmount >= minThreshold;
        
        if (!shouldKeep) {
          logger.debug('Filtering out fund flow below threshold', {
            amount: flowAmount,
            parsedAmount: parsedAmount,
            threshold: minThreshold,
            address: flow.address || flow.from || flow.to
          });
        }
        
        return shouldKeep;
        
      } catch (error) {
        logger.warn('Error filtering fund flow by amount', {
          error: (error as Error).message,
          flow
        });
        return false; // 出错时不保留记录，避免推送异常数据
      }
    });
  }

  /**
   * 解析金额字符串为USD数值
   * 支持多种格式：1.56M, 1,560,000, $1560000, 1560000 USDT等
   * @param amountStr 金额字符串
   * @returns 解析后的USD数值，解析失败返回null
   */
  private parseAmountToUSD(amountStr: string): number | null {
    if (!amountStr || typeof amountStr !== 'string') {
      return null;
    }
    
    try {
      // 移除常见的非数字字符，保留数字、小数点、逗号、M、K、B等单位
      const cleanStr = amountStr.replace(/[^0-9.,MKBmkb]/g, '').trim();
      
      if (!cleanStr) {
        return null;
      }
      
      // 检查是否有单位后缀
      const hasM = /[Mm]$/.test(cleanStr);
      const hasK = /[Kk]$/.test(cleanStr);
      const hasB = /[Bb]$/.test(cleanStr);
      
      // 移除单位后缀，提取数字部分
      const numStr = cleanStr.replace(/[MKBmkb]$/, '').replace(/,/g, '');
      const baseNum = parseFloat(numStr);
      
      if (isNaN(baseNum)) {
        return null;
      }
      
      // 根据单位计算最终数值
      let finalAmount = baseNum;
      if (hasB) {
        finalAmount = baseNum * 1000000000; // 十亿
      } else if (hasM) {
        finalAmount = baseNum * 1000000; // 百万
      } else if (hasK) {
        finalAmount = baseNum * 1000; // 千
      }
      
      return finalAmount;
      
    } catch (error) {
      logger.debug('Failed to parse amount string', {
        amountStr,
        error: (error as Error).message
      });
      return null;
    }
  }
}

// 导出单例
export const pushDataService = new PushDataService();
export default pushDataService;