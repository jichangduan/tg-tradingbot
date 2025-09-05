import { apiService } from './api.service';
import { logger } from '../utils/logger';
import { symbolExtractor } from '../utils/symbol-extractor';

/**
 * 推送数据接口
 */
export interface PushData {
  flash_news?: FlashNewsWithSymbol[];
  whale_actions?: WhaleActionWithSymbol[];
  fund_flows?: FundFlowWithSymbol[];
}

/**
 * 快讯数据（包含提取的符号）
 */
export interface FlashNewsWithSymbol {
  title: string;
  content: string;
  timestamp: string;
  symbol?: string;
}

/**
 * 鲸鱼动向数据（包含提取的符号）
 */
export interface WhaleActionWithSymbol {
  address: string;
  action: string;
  amount: string;
  timestamp: string;
  symbol?: string;
}

/**
 * 资金流向数据（包含提取的符号）
 */
export interface FundFlowWithSymbol {
  from: string;
  to: string;
  amount: string;
  timestamp: string;
  symbol?: string;
}

/**
 * API响应数据格式
 */
export interface PushContentApiResponse {
  code: string;
  message: string;
  data: {
    flash_news: Array<{
      title: string;
      content: string;
      timestamp: string;
    }>;
    whale_actions: Array<{
      address: string;
      action: string;
      amount: string;
      timestamp: string;
    }>;
    fund_flows: Array<{
      from: string;
      to: string;
      amount: string;
      timestamp: string;
    }>;
  };
}

/**
 * 推送内容服务
 * 负责获取和处理推送内容数据
 */
export class PushContentService {
  
  /**
   * 为用户获取推送数据
   * 从后端API获取各种推送内容并进行符号提取处理
   * @param userId 用户ID（可选，用于个性化推送）
   * @returns 处理后的推送数据
   */
  public async getPushDataForUser(userId?: string): Promise<PushData | undefined> {
    const startTime = Date.now();
    
    try {
      logger.debug('Fetching push data for user', { 
        userId: userId ? parseInt(userId) : undefined,
        timestamp: new Date().toISOString()
      });
      
      // 调用后端API获取推送内容
      const response = await apiService.get<PushContentApiResponse>('/api/tgbot/push/content');
      
      if (response.code !== '0' || !response.data) {
        logger.warn('Invalid push content API response', { 
          code: response.code,
          hasData: !!response.data,
          userId: userId ? parseInt(userId) : undefined
        });
        return undefined;
      }

      const rawData = response.data;
      
      logger.debug('Raw push content fetched successfully', {
        userId: userId ? parseInt(userId) : undefined,
        flashNewsCount: rawData.flash_news?.length || 0,
        whaleActionsCount: rawData.whale_actions?.length || 0,
        fundFlowsCount: rawData.fund_flows?.length || 0,
        duration: Date.now() - startTime
      });

      // 处理数据并提取符号
      const processedData = await this.processPushData(rawData, userId);
      
      const totalDuration = Date.now() - startTime;
      logger.info('Push data processing completed', {
        userId: userId ? parseInt(userId) : undefined,
        totalDuration,
        processedCounts: {
          flashNews: processedData.flash_news?.length || 0,
          whaleActions: processedData.whale_actions?.length || 0,
          fundFlows: processedData.fund_flows?.length || 0
        }
      });
      
      return processedData;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.warn('Failed to fetch push data for user', {
        userId: userId ? parseInt(userId) : undefined,
        duration,
        error: (error as Error).message
      });
      return undefined;
    }
  }

  /**
   * 处理推送数据，提取相关代币符号
   * @param rawData 原始API数据
   * @param userId 用户ID（用于日志）
   * @returns 处理后的推送数据
   */
  private async processPushData(
    rawData: PushContentApiResponse['data'], 
    userId?: string
  ): Promise<PushData> {
    const processStartTime = Date.now();
    
    try {
      const processedData: PushData = {};

      // 处理快讯数据
      if (rawData.flash_news && rawData.flash_news.length > 0) {
        processedData.flash_news = rawData.flash_news.map(news => ({
          ...news,
          symbol: this.extractSymbolFromFlashNews(news)
        }));
        
        logger.debug('Flash news processed', {
          count: processedData.flash_news.length,
          symbolsFound: processedData.flash_news.filter(n => n.symbol).length
        });
      }

      // 处理鲸鱼动向数据
      if (rawData.whale_actions && rawData.whale_actions.length > 0) {
        processedData.whale_actions = rawData.whale_actions.map(action => ({
          ...action,
          symbol: this.extractSymbolFromWhaleAction(action)
        }));
        
        logger.debug('Whale actions processed', {
          count: processedData.whale_actions.length,
          symbolsFound: processedData.whale_actions.filter(a => a.symbol).length
        });
      }

      // 处理资金流向数据
      if (rawData.fund_flows && rawData.fund_flows.length > 0) {
        processedData.fund_flows = rawData.fund_flows.map(flow => ({
          ...flow,
          symbol: this.extractSymbolFromFundFlow(flow)
        }));
        
        logger.debug('Fund flows processed', {
          count: processedData.fund_flows.length,
          symbolsFound: processedData.fund_flows.filter(f => f.symbol).length
        });
      }

      const processDuration = Date.now() - processStartTime;
      logger.debug('Push data symbol extraction completed', {
        userId: userId ? parseInt(userId) : undefined,
        processDuration,
        totalSymbolsExtracted: [
          ...(processedData.flash_news?.filter(n => n.symbol) || []),
          ...(processedData.whale_actions?.filter(a => a.symbol) || []),
          ...(processedData.fund_flows?.filter(f => f.symbol) || [])
        ].length
      });
      
      return processedData;
      
    } catch (error) {
      logger.error('Failed to process push data', {
        userId: userId ? parseInt(userId) : undefined,
        error: (error as Error).message,
        processDuration: Date.now() - processStartTime
      });
      
      // 返回原始数据（不带符号提取）作为fallback
      return {
        flash_news: rawData.flash_news?.map(news => ({ ...news })) || [],
        whale_actions: rawData.whale_actions?.map(action => ({ ...action })) || [],
        fund_flows: rawData.fund_flows?.map(flow => ({ ...flow })) || []
      };
    }
  }

  /**
   * 从快讯数据中提取代币符号
   * @param news 快讯数据
   * @returns 提取到的符号或undefined
   */
  private extractSymbolFromFlashNews(news: { title: string; content: string }): string | undefined {
    try {
      // 先从标题提取
      const symbolFromTitle = symbolExtractor.extractFromText(news.title);
      if (symbolFromTitle) {
        return symbolFromTitle;
      }
      
      // 再从内容提取
      if (news.content) {
        const symbolFromContent = symbolExtractor.extractFromText(news.content);
        if (symbolFromContent) {
          return symbolFromContent;
        }
      }
      
      // 尝试从标题+内容的组合文本中提取
      const combinedText = `${news.title} ${news.content || ''}`;
      return symbolExtractor.extractFromText(combinedText);
      
    } catch (error) {
      logger.debug('Failed to extract symbol from flash news', {
        title: news.title?.substring(0, 50),
        error: (error as Error).message
      });
      return undefined;
    }
  }

  /**
   * 从鲸鱼动向数据中提取代币符号
   * @param action 鲸鱼动向数据
   * @returns 提取到的符号或undefined
   */
  private extractSymbolFromWhaleAction(action: {
    address: string;
    action: string;
    amount: string;
  }): string | undefined {
    try {
      return symbolExtractor.extractFromWhaleAction({
        address: action.address,
        action: action.action,
        amount: action.amount,
        timestamp: '' // 这里不需要timestamp
      });
    } catch (error) {
      logger.debug('Failed to extract symbol from whale action', {
        action: action.action?.substring(0, 50),
        error: (error as Error).message
      });
      return undefined;
    }
  }

  /**
   * 从资金流向数据中提取代币符号
   * @param flow 资金流向数据
   * @returns 提取到的符号或undefined
   */
  private extractSymbolFromFundFlow(flow: {
    from: string;
    to: string;
    amount: string;
  }): string | undefined {
    try {
      // 优先从金额信息中提取
      const symbolFromAmount = symbolExtractor.extractFromText(flow.amount);
      if (symbolFromAmount) {
        return symbolFromAmount;
      }
      
      // 尝试从流向信息中提取
      const combinedText = `${flow.from} ${flow.to} ${flow.amount}`;
      return symbolExtractor.extractFromText(combinedText);
      
    } catch (error) {
      logger.debug('Failed to extract symbol from fund flow', {
        amount: flow.amount?.substring(0, 50),
        error: (error as Error).message
      });
      return undefined;
    }
  }

  /**
   * 检查是否有新的推送内容
   * @param pushData 推送数据
   * @returns 如果有新内容返回true
   */
  public hasNewPushContent(pushData: PushData | undefined): boolean {
    if (!pushData) {
      return false;
    }
    
    // 简化的检查逻辑：只要有任何数据就认为是新的
    // 实际实现中应该检查时间戳或ID来判断是否为新内容
    const hasFlashNews = pushData.flash_news && pushData.flash_news.length > 0;
    const hasWhaleActions = pushData.whale_actions && pushData.whale_actions.length > 0;
    const hasFundFlows = pushData.fund_flows && pushData.fund_flows.length > 0;
    
    const hasContent = !!(hasFlashNews || hasWhaleActions || hasFundFlows);
    
    logger.debug('Checking for new push content', {
      hasFlashNews: !!hasFlashNews,
      hasWhaleActions: !!hasWhaleActions,
      hasFundFlows: !!hasFundFlows,
      hasContent
    });
    
    return hasContent;
  }

  /**
   * 健康检查 - 测试推送内容API连接
   * @returns 如果API可用返回true
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await apiService.get<{ code: string }>('/api/tgbot/push/content');
      
      const isHealthy = response.code === '0';
      
      logger.debug('Push content service health check', { 
        isHealthy,
        responseCode: response.code
      });
      
      return isHealthy;
      
    } catch (error) {
      logger.warn('Push content service health check failed', {
        error: (error as Error).message
      });
      return false;
    }
  }
}

// 导出单例
export const pushContentService = new PushContentService();
export default pushContentService;