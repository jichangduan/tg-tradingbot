// TEMPORARILY DISABLED - Orders command is not available
// import { Context } from 'telegraf';
// import { logger } from '../../utils/logger';
// import { apiService } from '../../services/api.service';
// import { cacheService } from '../../services/cache.service';
// import { MessageFormatter } from '../utils/message.formatter';
// import { Validator } from '../utils/validator';
// import { ExtendedContext } from '../index';
// import { getUserAccessToken } from '../../utils/auth';

/**
 * 订单信息接口 - TEMPORARILY DISABLED
 */
// interface Order {
//   orderId: string;
//   symbol: string;
//   side: 'buy' | 'sell';
//   orderType: string;
//   quantity: string;
//   price: string;
//   triggerCondition?: string;
//   triggerPrice?: string;
//   timestamp: number;
//   status: string;
// }

/**
 * 订单查询响应接口 - TEMPORARILY DISABLED
 */
// interface OrdersResponse {
//   code: number;
//   data: {
//     orders: Order[];
//     totalOrders: number;
//     openOrders: number;
//     partiallyFilledOrders: number;
//   };
//   message: string;
// }

/**
 * 订单查询命令处理器 - TEMPORARILY DISABLED
 * 处理用户的 /orders 命令，查询并显示当前所有未成交的挂单
 */
// export class OrdersHandler {
//   private formatter: MessageFormatter;
//   private validator: Validator;
//   private readonly cacheKey = 'tgbot:orders:';
//   private readonly cacheTTL = 15; // 15秒缓存（订单变化较快）

//   constructor() {
//     this.formatter = new MessageFormatter();
//     this.validator = new Validator();
//   }

//   /**
//    * 处理 /orders 命令 - TEMPORARILY DISABLED
//    */
//   public async handle(ctx: ExtendedContext, args: string[]): Promise<void> {
//     const userId = ctx.from?.id;
//     if (!userId) {
//       await ctx.reply('❌ 无法识别用户身份');
//       return;
//     }

//     // 发送加载消息
//     const loadingMessage = await ctx.reply(
//       '📋 正在查询您的挂单信息...\n' +
//       '⏳ 请稍候，正在获取最新数据'
//     );

//     try {
//       // 尝试从缓存获取数据
//       const cachedData = await this.getCachedOrders(userId);
//       if (cachedData) {
//         await ctx.telegram.editMessageText(
//           ctx.chat!.id,
//           loadingMessage.message_id,
//           undefined,
//           cachedData,
//           { parse_mode: 'HTML' }
//         );
//         return;
//       }

//       // 从API获取数据
//       const ordersData = await this.fetchOrdersFromAPI(userId, ctx);
//       const formattedMessage = this.formatOrdersMessage(ordersData);
      
//       // 缓存结果
//       await this.cacheOrders(userId, formattedMessage);

//       // 更新消息
//       await ctx.telegram.editMessageText(
//         ctx.chat!.id,
//         loadingMessage.message_id,
//         undefined,
//         formattedMessage,
//         { parse_mode: 'HTML' }
//       );

//     } catch (error) {
//       const errorMessage = this.handleError(error as Error);
      
//       try {
//         await ctx.telegram.editMessageText(
//           ctx.chat!.id,
//           loadingMessage.message_id,
//           undefined,
//           errorMessage,
//           { parse_mode: 'HTML' }
//         );
//       } catch (editError) {
//         await ctx.reply(errorMessage, { parse_mode: 'HTML' });
//       }

//       logger.error('Orders command failed', {
//         error: (error as Error).message,
//         userId,
//         requestId: ctx.requestId
//       });
//     }
//   }

//   /**
//    * 从API获取订单数据 - TEMPORARILY DISABLED
//    */
//   private async fetchOrdersFromAPI(userId: number, ctx?: ExtendedContext): Promise<OrdersResponse> {
//     // 获取用户的access token，支持fallback重新认证
//     const userToken = await this.getUserAccessToken(userId, ctx);
    
//     if (!userToken) {
//       throw new Error('用户未登录，请先使用 /start 命令登录');
//     }

//     const response = await apiService.getWithAuth<OrdersResponse>(
//       '/api/tgbot/trading/orders',
//       userToken,
//       {},
//       { timeout: 10000 }
//     );

//     if (response.code !== 200) {
//       throw new Error(response.message || '获取订单信息失败');
//     }

//     return response;
//   }

//   /**
//    * 格式化订单信息消息 - TEMPORARILY DISABLED
//    */
//   private formatOrdersMessage(data: OrdersResponse): string {
//     const { orders, totalOrders, openOrders, partiallyFilledOrders } = data.data;

//     if (totalOrders === 0) {
//       return `
// 📋 <b>挂单概览</b>

// 📊 <b>订单统计:</b>
// • 总订单数: 0
// • 开放订单: 0
// • 部分成交: 0

// 📝 <b>当前挂单:</b>
// 暂无挂单

// 💡 <i>您可以使用以下命令创建订单:</i>
// • <code>/long BTC 10x 100</code> - 做多BTC
// • <code>/short ETH 5x 50</code> - 做空ETH
// • <code>/price BTC</code> - 查询实时价格

// <i>🕐 查询时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</i>
//       `.trim();
//     }

//     let ordersText = '';
//     orders.forEach((order, index) => {
//       const sideIcon = order.side === 'buy' ? '🟢' : '🔴';
//       const sideText = order.side === 'buy' ? '买入' : '卖出';
      
//       // 格式化订单类型
//       let orderTypeText = order.orderType;
//       if (order.orderType === 'limit') {
//         orderTypeText = '限价单';
//       } else if (order.orderType === 'market') {
//         orderTypeText = '市价单';
//       } else if (order.orderType === 'stop') {
//         orderTypeText = '止损单';
//       } else if (order.orderType === 'stop_limit') {
//         orderTypeText = '止损限价';
//       }

//       // 格式化时间
//       const orderTime = new Date(order.timestamp * 1000).toLocaleString('zh-CN', { 
//         timeZone: 'Asia/Shanghai',
//         month: '2-digit',
//         day: '2-digit',
//         hour: '2-digit',
//         minute: '2-digit'
//       });
      
//       ordersText += `
// ${sideIcon} <b>${order.symbol} ${sideText}</b>
// • 订单ID: <code>${order.orderId}</code>
// • 类型: ${orderTypeText}
// • 数量: ${parseFloat(order.quantity).toFixed(4)}
// • 价格: $${parseFloat(order.price).toFixed(4)}`;

//       // 如果有触发条件，添加触发信息
//       if (order.triggerCondition && order.triggerPrice) {
//         ordersText += `\n• 触发条件: ${order.triggerCondition}`;
//         ordersText += `\n• 触发价格: $${parseFloat(order.triggerPrice).toFixed(4)}`;
//       }

//       ordersText += `\n• 创建时间: ${orderTime}`;
//       ordersText += `\n• 状态: ${order.status}`;
      
//       if (index < orders.length - 1) {
//         ordersText += '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
//       }
//     });

//     return `
// 📋 <b>挂单概览</b>

// 📊 <b>订单统计:</b>
// • 总订单数: ${totalOrders}
// • 开放订单: ${openOrders}
// • 部分成交: ${partiallyFilledOrders}

// 📝 <b>当前挂单:</b>
// ${ordersText}

// 💡 <i>管理订单:</i>
// • <code>/cancel 订单ID</code> - 取消指定订单
// • <code>/positions</code> - 查看持仓情况
// • <code>/price 代币</code> - 查询实时价格

// <i>🕐 查询时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</i>
//     `.trim();
//   }

//   /**
//    * 错误处理 - TEMPORARILY DISABLED
//    */
//   private handleError(error: Error): string {
//     logger.error('Orders handler error:', { error: error.message });

//     if (error.message.includes('未登录')) {
//       return `
// ❌ <b>用户未登录</b>

// 请先使用 /start 命令登录系统后再查询订单信息。

// <i>如果您已经登录但仍出现此错误，请联系管理员。</i>
//       `.trim();
//     }

//     if (error.message.includes('网络')) {
//       return `
// ❌ <b>网络连接失败</b>

// 请检查网络连接后重试，或稍后再试。

// <i>如果问题持续存在，请联系管理员。</i>
//       `.trim();
//     }

//     return `
// ❌ <b>查询失败</b>

// 获取订单信息时出现错误，请稍后重试。

// <b>错误详情:</b> ${error.message}

// <i>如果问题持续存在，请联系管理员。</i>
//     `.trim();
//   }

//   /**
//    * 获取缓存的订单数据 - TEMPORARILY DISABLED
//    */
//   private async getCachedOrders(userId: number): Promise<string | null> {
//     try {
//       const key = `${this.cacheKey}${userId}`;
//       const result = await cacheService.get<string>(key);
//       if (result.success && result.data) {
//         return result.data;
//       }
//       return null;
//     } catch (error) {
//       logger.warn('Failed to get cached orders', { error: (error as Error).message, userId });
//       return null;
//     }
//   }

//   /**
//    * 缓存订单数据 - TEMPORARILY DISABLED
//    */
//   private async cacheOrders(userId: number, data: string): Promise<void> {
//     try {
//       const key = `${this.cacheKey}${userId}`;
//       await cacheService.set(key, data, this.cacheTTL);
//     } catch (error) {
//       logger.warn('Failed to cache orders', { error: (error as Error).message, userId });
//     }
//   }

//   /**
//    * 获取用户的访问令牌 - TEMPORARILY DISABLED
//    * 支持从缓存获取，如果没有则尝试重新认证并缓存
//    */
//   private async getUserAccessToken(userId: number, ctx?: ExtendedContext): Promise<string | null> {
//     try {
//       // 方案1: 从缓存中获取用户token
//       const tokenKey = `user:token:${userId}`;
//       const result = await cacheService.get<string>(tokenKey);
      
//       if (result.success && result.data) {
//         logger.debug('AccessToken found in cache', { userId, tokenKey });
//         return result.data;
//       }

//       // 方案2: 如果缓存中没有token，尝试通过用户信息重新获取
//       if (ctx && ctx.from) {
//         logger.info('AccessToken not in cache, attempting to re-authenticate', { userId });
        
//         const userInfo = {
//           username: ctx.from.username,
//           first_name: ctx.from.first_name,
//           last_name: ctx.from.last_name
//         };

//         try {
//           const freshToken = await getUserAccessToken(userId.toString(), userInfo);
          
//           // 将新获取的token缓存起来
//           await this.cacheUserAccessToken(userId, freshToken);
          
//           logger.info('AccessToken re-authenticated and cached successfully', { userId });
//           return freshToken;
//         } catch (authError) {
//           logger.warn('Failed to re-authenticate user', {
//             userId,
//             error: (authError as Error).message
//           });
//         }
//       }

//       // 方案3: 如果所有方法都失败，返回null
//       logger.warn('No access token available for user', { userId });
//       return null;

//     } catch (error) {
//       logger.error('Failed to get user access token', { 
//         error: (error as Error).message, 
//         userId 
//       });
//       return null;
//     }
//   }

//   /**
//    * 缓存用户的accessToken - TEMPORARILY DISABLED
//    */
//   private async cacheUserAccessToken(userId: number, accessToken: string): Promise<void> {
//     try {
//       const tokenKey = `user:token:${userId}`;
//       const tokenTTL = 24 * 60 * 60; // 24小时过期
      
//       const result = await cacheService.set(tokenKey, accessToken, tokenTTL);
      
//       if (result.success) {
//         logger.debug('AccessToken cached in orders handler', {
//           userId,
//           tokenKey,
//           expiresIn: tokenTTL
//         });
//       } else {
//         logger.warn('Failed to cache accessToken in orders handler', {
//           userId,
//           tokenKey,
//           error: result.error
//         });
//       }
//     } catch (error) {
//       logger.error('Error caching accessToken in orders handler', {
//         userId,
//         error: (error as Error).message
//       });
//     }
//   }
// }

// 导出处理器实例 - TEMPORARILY DISABLED
// export const ordersHandler = new OrdersHandler();
// export default ordersHandler;