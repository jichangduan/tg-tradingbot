import {
  TokenData,
  CachedTokenData,
  PriceChangeType,
  DetailedError,
  FormatOptions,
  UserInitData,
  FormattedWalletBalance,
  FormattedAccountBalance,
  FormattedInviteStats,
  CachedCandleData,
  TimeFrame,
  CandleData
} from '../../types/api.types';

/**
 * Telegram Message Formatter Utility Class
 * Responsible for formatting data into user-friendly Telegram messages
 */
export class MessageFormatter {
  private readonly defaultOptions: FormatOptions = {
    currency: 'USD',
    precision: 2,
    compact: false,
    showSymbol: true
  };

  /**
   * Format token price message
   */
  public formatPriceMessage(tokenData: CachedTokenData, options?: Partial<FormatOptions>): string {
    const opts = { ...this.defaultOptions, ...options };
    const { symbol, name, price, change24h, volume24h, marketCap, high24h, low24h, isCached } = tokenData;
    
    // Calculate price trend
    const trend = this.calculateTrend(change24h);
    
    // Choose appropriate emoji and color
    const trendEmoji = this.getTrendEmoji(trend.type);
    const changeText = this.formatPercentage(change24h, true);
    
    // Build main information
    const priceText = this.formatPrice(price, opts);
    const volumeText = this.formatLargeNumber(volume24h);
    const marketCapText = this.formatLargeNumber(marketCap);
    
    // Build complete message
    let message = `<b>💰 ${symbol}`;
    if (name && name !== symbol) {
      message += ` (${name})`;
    }
    message += ` Price Info</b> ${trendEmoji}\n\n`;
    
    message += `🏷️ <b>Current Price:</b> ${priceText}\n`;
    message += `📊 <b>24h Change:</b> ${changeText}\n`;
    
    // Show 24h high/low if available
    if (high24h && low24h && high24h > 0 && low24h > 0) {
      message += `📈 <b>24h High:</b> ${this.formatPrice(high24h, opts)}\n`;
      message += `📉 <b>24h Low:</b> ${this.formatPrice(low24h, opts)}\n`;
    }
    
    message += `📈 <b>24h Volume:</b> $${volumeText}\n`;
    
    if (marketCap > 0) {
      message += `💎 <b>Market Cap:</b> $${marketCapText}\n`;
    }
    
    // Add data source information
    message += `\n<i>🕐 Updated: ${this.formatTimestamp(tokenData.updatedAt)}</i>\n`;
    
    if (isCached) {
      message += `<i>⚡ Cached data (refresh every 5 minutes)</i>\n`;
    }
    
    message += `<i>📡 Data source: AIW3</i>`;
    
    return message;
  }

  /**
   * Format error message
   */
  public formatErrorMessage(error: DetailedError | Error): string {
    let message = `❌ <b>Query Failed</b>\n\n`;
    
    if ('code' in error && error.context) {
      // DetailedError - Provide more detailed error information
      message += error.message;
      
      if (error.retryable) {
        message += `\n\n💡 <i>Please retry later</i>`;
      }
      
      // Provide specific suggestions based on error type
      switch (error.code) {
        case 'TOKEN_NOT_FOUND':
          message += `\n\n📝 <b>Suggestions:</b>\n`;
          message += `• Check if the token symbol is correct\n`;
          message += `• Try common tokens: BTC, ETH, SOL\n`;
          message += `• Ensure token symbol is in uppercase`;
          break;
          
        case 'RATE_LIMIT_EXCEEDED':
          message += `\n\n⏰ <i>Please wait 30-60 seconds before retrying</i>`;
          break;
          
        case 'NETWORK_ERROR':
          message += `\n\n🌐 <i>Please check your connection and try again later</i>`;
          break;
      }
    } else {
      // Regular Error
      message += error.message;
    }
    
    message += `\n\n<i>If the problem persists, please contact administrator</i>`;
    
    return message;
  }

  /**
   * Format help message
   */
  public formatHelpMessage(): string {
    return `
💡 <b>Price Query Usage</b>

<code>/price BTC</code> - Get BTC price
<code>/price ETH</code> - Get ETH price  
<code>/price SOL</code> - Get SOL price

<b>Supported Major Tokens:</b>
BTC, ETH, SOL, USDT, USDC, BNB, ADA, DOT, LINK, MATIC, AVAX, UNI

<b>Features:</b>
• 🚀 Real-time price data
• 📊 24-hour price changes
• 💹 Trading volume and market cap
• ⚡ 5-minute smart caching
• 🎯 Lightning-fast response

<i>💡 Tip: Token symbols are case insensitive</i>
    `.trim();
  }

  /**
   * Format "querying" message
   */
  public formatLoadingMessage(symbol: string): string {
    return `🔍 Querying ${symbol.toUpperCase()} price information...`;
  }

  /**
   * Format price number
   */
  private formatPrice(price: number, options: FormatOptions): string {
    const { precision, showSymbol, compact } = options;
    
    if (price === 0) {
      return showSymbol ? '$0.00' : '0.00';
    }
    
    let formatted: string;
    
    if (compact && price >= 1000) {
      formatted = this.formatLargeNumber(price);
    } else if (price >= 1) {
      // Prices >= 1, show 2 decimal places
      formatted = price.toLocaleString('en-US', {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision
      });
    } else if (price >= 0.01) {
      // Between 0.01-1, show 4 decimal places
      formatted = price.toFixed(4);
    } else {
      // Less than 0.01, show 6+ decimal places
      formatted = price.toFixed(8).replace(/\.?0+$/, '');
    }
    
    return showSymbol ? `$${formatted}` : formatted;
  }

  /**
   * Format large numbers (using K, M, B, T suffixes)
   */
  private formatLargeNumber(num: number): string {
    if (num === 0) return '0';
    
    const units = [
      { value: 1e12, suffix: 'T' },
      { value: 1e9, suffix: 'B' },
      { value: 1e6, suffix: 'M' },
      { value: 1e3, suffix: 'K' }
    ];
    
    for (const unit of units) {
      if (Math.abs(num) >= unit.value) {
        const formatted = (num / unit.value).toFixed(1);
        // Remove unnecessary .0
        return formatted.replace(/\.0$/, '') + unit.suffix;
      }
    }
    
    return num.toFixed(2);
  }

  /**
   * Format percentage
   */
  private formatPercentage(value: number, withSign: boolean = false): string {
    const sign = value >= 0 ? '+' : '';
    const emoji = value >= 0 ? '📈' : '📉';
    const absValue = Math.abs(value);
    
    let formatted: string;
    if (absValue >= 100) {
      formatted = `${sign}${value.toFixed(0)}%`;
    } else if (absValue >= 10) {
      formatted = `${sign}${value.toFixed(1)}%`;
    } else {
      formatted = `${sign}${value.toFixed(2)}%`;
    }
    
    return withSign ? `${emoji} ${formatted}` : formatted;
  }

  /**
   * Format timestamp
   */
  private formatTimestamp(date: Date): string {
    return date.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Calculate price trend
   */
  private calculateTrend(change24h: number): { type: PriceChangeType; isSignificant: boolean } {
    const absChange = Math.abs(change24h);
    
    let type: PriceChangeType;
    if (change24h > 0.1) {
      type = PriceChangeType.UP;
    } else if (change24h < -0.1) {
      type = PriceChangeType.DOWN;
    } else {
      type = PriceChangeType.STABLE;
    }
    
    return {
      type,
      isSignificant: absChange >= 5 // 5% or more considered significant change
    };
  }

  /**
   * Get emoji based on trend type
   */
  private getTrendEmoji(type: PriceChangeType): string {
    switch (type) {
      case PriceChangeType.UP:
        return '🚀';
      case PriceChangeType.DOWN:
        return '📉';
      case PriceChangeType.STABLE:
        return '➡️';
      default:
        return '📊';
    }
  }

  /**
   * Format compact price message (for batch queries)
   */
  public formatCompactPriceMessage(tokenData: TokenData): string {
    const { symbol, price, change24h } = tokenData;
    const changeText = this.formatPercentage(change24h);
    const emoji = change24h >= 0 ? '🟢' : '🔴';
    
    return `${emoji} <b>${symbol}</b>: ${this.formatPrice(price, this.defaultOptions)} (${changeText})`;
  }

  /**
   * Format multi-token price message
   */
  public formatMultiTokenMessage(tokens: CachedTokenData[]): string {
    if (tokens.length === 0) {
      return '❌ <b>No token price information found</b>';
    }
    
    let message = `📈 <b>Token Price Overview</b> (${tokens.length} tokens)\n\n`;
    
    tokens.forEach(token => {
      message += this.formatCompactPriceMessage(token) + '\n';
    });
    
    message += `\n<i>🕐 Updated: ${this.formatTimestamp(new Date())}</i>`;
    message += `\n<i>📡 Data source: AIW3</i>`;
    
    return message;
  }

  /**
   * Escape HTML special characters (Telegram HTML mode)
   */
  public escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /**
   * Format system status message
   */
  public formatSystemStatusMessage(apiHealthy: boolean, cacheHealthy: boolean): string {
    const apiStatus = apiHealthy ? '🟢 Normal' : '🔴 Error';
    const cacheStatus = cacheHealthy ? '🟢 Normal' : '🟡 Degraded';
    
    let message = `⚙️ <b>System Status</b>\n\n`;
    message += `📡 <b>API Service:</b> ${apiStatus}\n`;
    message += `⚡ <b>Cache Service:</b> ${cacheStatus}\n`;
    
    if (!apiHealthy) {
      message += `\n⚠️ <i>API service error, some features may be unavailable</i>`;
    }
    
    if (!cacheHealthy) {
      message += `\n💡 <i>Cache service error, response may be slower</i>`;
    }
    
    message += `\n\n<i>🕐 Check time: ${this.formatTimestamp(new Date())}</i>`;
    
    return message;
  }

  /**
   * Format user initialization success message
   */
  public formatUserInitSuccessMessage(userData: UserInitData): string {
    const { userId, walletAddress, nickname, referralCode, energy, isNewUser } = userData;
    
    let message: string;
    
    if (isNewUser) {
      // New user welcome message
      message = `✅ <b>Account Created Successfully!</b>\n\n`;
      message += `🎉 Welcome to AIW3 Community, ${this.escapeHtml(nickname)}!\n\n`;
      
      message += `<b>🏦 Your Account Info:</b>\n`;
      message += `👤 <b>User ID:</b> <code>${userId}</code>\n`;
      message += `💎 <b>Wallet Address:</b> <code>${this.truncateAddress(walletAddress)}</code>\n`;
      message += `⚡ <b>Initial Energy:</b> ${energy} ⚡\n`;
      message += `🔗 <b>Referral Code:</b> <code>${referralCode}</code>\n\n`;
      
      message += `<b>🚀 Now you can:</b>\n`;
      message += `• 💰 Check live prices: <code>/price BTC</code>\n`;
      message += `• 📊 View market overview: <code>/markets</code>\n`;
      message += `• 📱 Share your referral code to earn rewards\n`;
      message += `• 💡 Get help info: <code>/help</code>\n\n`;
      
      message += `<b>🎁 Refer Friends Rewards:</b>\n`;
      message += `Share referral code <code>${referralCode}</code> with friends, both get extra rewards!\n\n`;
      
    } else {
      // Returning user welcome message  
      message = `👋 <b>Welcome back, ${this.escapeHtml(nickname)}!</b>\n\n`;
      
      message += `<b>🏦 Your Account Info:</b>\n`;
      message += `👤 <b>User ID:</b> <code>${userId}</code>\n`;
      message += `💎 <b>Wallet Address:</b> <code>${this.truncateAddress(walletAddress)}</code>\n`;
      message += `⚡ <b>Current Energy:</b> ${energy} ⚡\n`;
      message += `🔗 <b>Referral Code:</b> <code>${referralCode}</code>\n\n`;
      
      message += `<b>💡 Quick Start:</b>\n`;
      message += `• <code>/price BTC</code> - Check Bitcoin price\n`;
      message += `• <code>/markets</code> - View market overview\n`;
      message += `• <code>/help</code> - View all features\n\n`;
    }
    
    message += `<i>🔐 Your wallet address and private key are securely managed by the system</i>\n`;
    message += `<i>💎 More features coming soon, stay tuned!</i>`;
    
    return message;
  }

  /**
   * Format user initialization error message
   */
  public formatUserInitErrorMessage(error: DetailedError): string {
    let message = `❌ <b>Account Initialization Failed</b>\n\n`;
    
    // Provide specific error information based on error type
    switch (error.code) {
      case 'NETWORK_ERROR':
        message += `🌐 Network connection error\n\n`;
        message += `Possible causes:\n`;
        message += `• Unstable network connection\n`;
        message += `• Server under maintenance\n\n`;
        message += `💡 <b>Suggestion:</b> Please check your network and resend <code>/start</code>`;
        break;
        
      case 'TIMEOUT_ERROR':
        message += `⏱️ Request timeout\n\n`;
        message += `Server response time too long, please try again later.\n\n`;
        message += `💡 <b>Suggestion:</b> Wait 30 seconds and resend <code>/start</code>`;
        break;
        
      case 'SERVER_ERROR':
        message += `🛠️ 服务器内部错误\n\n`;
        message += `我们的技术团队正在处理此问题。\n\n`;
        message += `💡 <b>建议:</b> 请稍后重试或联系客服`;
        break;
        
      case 'RATE_LIMIT_EXCEEDED':
        message += `🚦 Requests too frequent\n\n`;
        message += `To protect system stability, please try again later.\n\n`;
        message += `💡 <b>Suggestion:</b> Wait 1-2 minutes and resend <code>/start</code>`;
        break;
        
      default:
        message += `${error.message}\n\n`;
        if (error.retryable) {
          message += `💡 <b>Suggestion:</b> Please resend <code>/start</code> command`;
        } else {
          message += `💡 <b>Suggestion:</b> Please contact administrator for help`;
        }
    }
    
    message += `\n\n<b>🆘 Need Help?</b>\n`;
    message += `• 📱 Send <code>/help</code> to view usage guide\n`;
    message += `• 💰 Try <code>/price BTC</code> directly to start\n`;
    message += `• 💬 Contact support for technical help\n\n`;
    
    message += `<i>If the problem persists, please contact administrator</i>`;
    
    return message;
  }

  /**
   * Format invitation success message
   */
  public formatInvitationSuccessMessage(invitationCode: string, userData: UserInitData): string {
    let message = `🎁 <b>Invitation Success! Welcome to AIW3!</b>\n\n`;
    
    message += `Used invitation code: <code>${invitationCode}</code>\n`;
    message += `Welcome new member: <b>${this.escapeHtml(userData.nickname)}</b>\n\n`;
    
    message += `<b>🎉 Invitation rewards distributed:</b>\n`;
    message += `• ⚡ Extra energy bonus\n`;
    message += `• 🎯 Exclusive user badge\n`;
    message += `• 🚀 Priority feature access\n\n`;
    
    message += `<b>🏦 您的账户信息:</b>\n`;
    message += `👤 <b>用户ID:</b> <code>${userData.userId}</code>\n`;
    message += `💎 <b>钱包地址:</b> <code>${this.truncateAddress(userData.walletAddress)}</code>\n`;
    message += `⚡ <b>当前能量:</b> ${userData.energy} ⚡\n`;
    message += `🔗 <b>您的邀请码:</b> <code>${userData.referralCode}</code>\n\n`;
    
    message += `<b>💡 立即开始:</b>\n`;
    message += `• <code>/price BTC</code> - 查询币价\n`;
    message += `• <code>/markets</code> - 市场概况\n`;
    message += `• 分享您的邀请码 <code>${userData.referralCode}</code> 赚取奖励\n\n`;
    
    message += `<i>🎊 感谢您选择 AIW3，祝您交易愉快！</i>`;
    
    return message;
  }

  /**
   * Truncate wallet address (show only first and last few characters)
   * Modified to show full address for testing
   */
  private truncateAddress(address: string): string {
    // 显示完整钱包地址
    return address;
  }

  /**
   * 格式化能量值显示
   */
  public formatEnergyDisplay(energy: number): string {
    if (energy >= 1000) {
      return `${(energy / 1000).toFixed(1)}K ⚡`;
    }
    return `${energy} ⚡`;
  }

  /**
   * 格式化用户统计信息（预留）
   */
  public formatUserStatsMessage(userStats: any): string {
    // 预留给未来的用户统计功能
    return `📊 <b>用户统计</b>\n\n功能开发中...`;
  }

  /**
   * 格式化钱包余额消息 (支持新版链上钱包和旧版交易所账户)
   */
  public formatWalletBalanceMessage(balance: FormattedWalletBalance | FormattedAccountBalance, warnings?: string[]): string {
    // 检查是否为新版链上钱包格式
    if ('address' in balance && 'network' in balance) {
      return this.formatOnChainWalletMessage(balance as FormattedWalletBalance, warnings);
    } else {
      // 旧版交易所账户格式 (向后兼容)
      return this.formatExchangeAccountMessage(balance as FormattedAccountBalance, warnings);
    }
  }

  /**
   * 格式化链上钱包余额消息
   */
  private formatOnChainWalletMessage(balance: FormattedWalletBalance, warnings?: string[]): string {
    // Determine wallet name based on network type
    const walletName = balance.network.toLowerCase() === 'arbitrum' ? 'Hyperliquid Wallet' : 'Solana Wallet';
    let message = `💰 <b>${walletName}</b>\n\n`;
    
    // Wallet address information
    message += `📍 <b>Wallet Address:</b> <code>${this.truncateAddress(balance.address)}</code>\n`;
    message += `🌐 <b>Network:</b> ${balance.network.toUpperCase()}\n\n`;
    
    // Special display for Hyperliquid wallet
    if (balance.network.toLowerCase() === 'arbitrum') {
      // Contract account balance (main funds)
      message += `💎 <b>Contract Account Value:</b> ${balance.nativeBalance.toFixed(2)} ${balance.nativeSymbol} ($${this.formatCurrency(balance.nativeBalance)})\n`;
      
      // Withdrawable amount (available margin)
      if (balance.withdrawableAmount !== undefined) {
        const occupiedMargin = balance.nativeBalance - balance.withdrawableAmount;
        message += `💸 <b>Available Margin:</b> ${balance.withdrawableAmount.toFixed(2)} ${balance.nativeSymbol} ($${this.formatCurrency(balance.withdrawableAmount)})\n`;
        if (occupiedMargin > 0) {
          message += `🔒 <b>Used Margin:</b> ${occupiedMargin.toFixed(2)} ${balance.nativeSymbol} ($${this.formatCurrency(occupiedMargin)})\n`;
        }
      }
      
      // Fund usage description
      message += `\n📝 <b>Fund Usage Description:</b>\n`;
      message += `• <b>Contract Account:</b> Used for >1x leverage trading\n`;
      message += `• <b>Available Margin:</b> Available funds for new leverage trades\n`;
      message += `• <b>Used Margin:</b> Margin locked by current positions\n`;
    } else {
      // Original display for other networks (contract account only)
      message += `💎 <b>Contract Account Balance:</b> ${balance.nativeBalance.toFixed(6)} ${balance.nativeSymbol}\n`;
    }
    
    // Total value - always display, even if 0
    message += `\n📈 <b>Total Value:</b> $${this.formatCurrency(balance.totalUsdValue)}\n`;
    
    // Add notification if total value is 0
    if (balance.totalUsdValue === 0) {
      message += `\n💡 <b>Note:</b> Wallet has no assets, please deposit USDC to trading wallet address first\n`;
    }
    
    // Last update time
    message += `🕐 <b>Updated:</b> ${this.formatTimestamp(balance.lastUpdated)}\n`;

    // Warning information
    if (warnings && warnings.length > 0) {
      message += `\n<b>⚠️ Warnings:</b>\n`;
      warnings.forEach(warning => {
        message += `• ${warning}\n`;
      });
    }

    // Separator
    message += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    // Related operation suggestions
    message += `🔧 <b>Available Actions:</b>\n`;
    if (balance.nativeBalance > 0.01) {
      message += `• Send tokens to other addresses\n`;
      message += `• Participate in DeFi protocols\n`;
    }
    message += `• <code>/price SOL</code> - Check SOL price\n`;
    message += `• <code>/price USDT</code> - Check USDT price\n`;
    
    if (balance.nativeBalance < 0.001) {
      message += `\n💡 <i>SOL balance too low, may affect transaction fee payment</i>`;
    }

    message += `\n\n⚡ <i>Real-time on-chain data</i>`;

    return message;
  }

  /**
   * 格式化交易所账户余额消息 (旧版兼容)
   */
  private formatExchangeAccountMessage(balance: FormattedAccountBalance, warnings?: string[]): string {
    let message = `💰 <b>钱包余额</b>\n\n`;
    
    // 主要余额信息
    message += `📈 <b>总资产:</b> $${this.formatCurrency(balance.totalEquity)} ${balance.currency}\n`;
    message += `💳 <b>可用余额:</b> $${this.formatCurrency(balance.availableEquity)} ${balance.currency}\n`;
    
    if (balance.orderFrozen > 0) {
      message += `🔒 <b>冻结资金:</b> $${this.formatCurrency(balance.orderFrozen)} ${balance.currency}\n`;
    }
    
    if (balance.adjustedEquity !== balance.totalEquity && balance.adjustedEquity > 0) {
      message += `📊 <b>调整权益:</b> $${this.formatCurrency(balance.adjustedEquity)} ${balance.currency}\n`;
    }

    // 资金使用率
    const utilizationEmoji = this.getUtilizationEmoji(balance.utilizationRate);
    message += `\n💡 <b>资金使用率:</b> ${utilizationEmoji} ${balance.utilizationRate}%\n`;
    
    // 最后更新时间
    message += `🕐 <b>更新时间:</b> ${this.formatTimestamp(balance.lastUpdated)}\n`;

    // 警告信息
    if (warnings && warnings.length > 0) {
      message += `\n<b>⚠️ 风险提醒:</b>\n`;
      warnings.forEach(warning => {
        message += `• ${warning}\n`;
      });
    }

    // 分割线
    message += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    // 相关操作建议
    message += `💹 <b>可用操作:</b>\n`;
    if (balance.availableEquity >= 100) {
      message += `• <code>/long BTC</code> - 开多仓\n`;
      message += `• <code>/short ETH</code> - 开空仓\n`;
    }
    message += `• <code>/positions</code> - 查看持仓\n`;
    message += `• <code>/orders</code> - 查看订单\n`;
    
    if (balance.availableEquity < 100) {
      message += `\n💡 <i>余额不足，建议先充值后进行交易</i>`;
    }

    return message;
  }

  /**
   * 格式化货币数值
   */
  private formatCurrency(amount: number): string {
    if (amount === 0) {
      return '0.00';
    }
    
    // 大于1000的显示紧凑格式
    if (amount >= 1000) {
      return this.formatLargeNumber(amount);
    }
    
    // 小于1000的显示完整数值
    return amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * 根据资金使用率获取相应的emoji
   */
  private getUtilizationEmoji(utilizationRate: number): string {
    if (utilizationRate >= 80) {
      return '🔴'; // 高风险
    } else if (utilizationRate >= 60) {
      return '🟡'; // 中风险
    } else if (utilizationRate >= 30) {
      return '🟢'; // 正常
    } else {
      return '⚪'; // 低使用率
    }
  }

  /**
   * 格式化钱包余额加载消息
   */
  public formatWalletLoadingMessage(): string {
    return `🔍 <b>Querying wallet balance...</b>\n\n💡 <i>Fetching your account information</i>`;
  }

  /**
   * 格式化钱包余额错误消息
   */
  public formatWalletErrorMessage(error: DetailedError): string {
    let message = `❌ <b>Wallet Balance Query Failed</b>\n\n`;
    
    // Provide specific error information based on error type
    switch (error.code) {
      case 'TOKEN_NOT_FOUND':
        message += `🏦 Trading account not found\n\n`;
        message += `Possible reasons:\n`;
        message += `• You haven't created a trading account yet\n`;
        message += `• Account information sync delay\n\n`;
        message += `💡 <b>Suggestion:</b> Please send <code>/start</code> to initialize your account first`;
        break;
        
      case 'NETWORK_ERROR':
        message += `🌐 Network connection error\n\n`;
        message += `Possible reasons:\n`;
        message += `• Unstable network connection\n`;
        message += `• Server under maintenance\n\n`;
        message += `💡 <b>Suggestion:</b> Please retry <code>/wallet</code> later`;
        break;
        
      case 'TIMEOUT_ERROR':
        message += `⏱️ Request timeout\n\n`;
        message += `Server response time too long, please retry later.\n\n`;
        message += `💡 <b>Suggestion:</b> Wait 30 seconds then retry <code>/wallet</code>`;
        break;
        
      case 'SERVER_ERROR':
        message += `🛠️ Internal server error\n\n`;
        message += `Our technical team is handling this issue.\n\n`;
        message += `💡 <b>Suggestion:</b> Please retry later or contact support`;
        break;
        
      case 'RATE_LIMIT_EXCEEDED':
        message += `🚦 Too many requests\n\n`;
        message += `To protect system stability, please retry later.\n\n`;
        message += `💡 <b>Suggestion:</b> Wait 1-2 minutes then retry <code>/wallet</code>`;
        break;
        
      default:
        message += `${error.message}\n\n`;
        if (error.retryable) {
          message += `💡 <b>Suggestion:</b> Please retry <code>/wallet</code> command`;
        } else {
          message += `💡 <b>Suggestion:</b> Please contact administrator for help`;
        }
    }
    
    message += `\n\n<b>🆘 Need Help?</b>\n`;
    message += `• 📱 Send <code>/help</code> for usage guide\n`;
    message += `• 💰 Send <code>/start</code> to initialize account\n`;
    message += `• 💬 Contact support for technical assistance\n\n`;
    
    message += `<i>If the problem persists, please contact administrator</i>`;
    
    return message;
  }

  /**
   * 格式化余额不足警告消息
   */
  public formatInsufficientBalanceMessage(
    requiredAmount: number, 
    availableAmount: number
  ): string {
    let message = `⚠️ <b>余额不足</b>\n\n`;
    
    message += `💰 <b>所需金额:</b> $${this.formatCurrency(requiredAmount)} USDT\n`;
    message += `💳 <b>可用余额:</b> $${this.formatCurrency(availableAmount)} USDT\n`;
    message += `📉 <b>缺少金额:</b> $${this.formatCurrency(requiredAmount - availableAmount)} USDT\n\n`;
    
    message += `💡 <b>建议操作:</b>\n`;
    message += `• 📈 充值更多资金\n`;
    message += `• 📊 减少交易数量\n`;
    message += `• 🔄 取消部分挂单释放冻结资金\n\n`;
    
    message += `📱 发送 <code>/wallet</code> 查看最新余额`;
    
    return message;
  }

  /**
   * 格式化邀请统计消息
   */
  public formatInviteStatsMessage(stats: FormattedInviteStats): string {
    let message = `🎁 <b>邀请统计</b>\n\n`;
    
    // 核心统计数据
    message += `👥 <b>邀请人数:</b> ${stats.inviteeCount} 人\n`;
    message += `💰 <b>总交易量:</b> $${this.formatCurrency(stats.totalTradingVolume)}\n`;
    message += `⭐ <b>当前积分:</b> ${this.formatPoints(stats.currentPoints)} 分\n`;
    
    // 邀请记录
    if (stats.inviteRecords.length > 0) {
      message += `\n📊 <b>邀请记录 (第${stats.pagination.page}页):</b>\n`;
      stats.inviteRecords.forEach((record, index) => {
        const number = (stats.pagination.page - 1) * 10 + index + 1;
        const address = this.truncateAddress(record.wallet_address);
        const date = this.formatTimestamp(new Date(record.createdAt));
        message += `${number}. <code>${address}</code> (${date})\n`;
      });
      
      // 分页信息
      if (stats.pagination.totalPages > 1) {
        message += `\n📖 <b>分页:</b> ${stats.pagination.page}/${stats.pagination.totalPages}`;
        
        if (stats.pagination.hasNext) {
          message += `\n使用 <code>/invite ${stats.pagination.page + 1}</code> 查看下一页`;
        }
        if (stats.pagination.hasPrev) {
          message += `\n使用 <code>/invite ${stats.pagination.page - 1}</code> 查看上一页`;
        }
      }
    } else {
      message += `\n📭 <b>邀请记录:</b> 暂无邀请记录\n`;
      message += `💡 开始邀请朋友使用Bot获得积分奖励！`;
    }
    
    // 积分说明
    message += `\n\n🏆 <b>积分规则:</b>\n`;
    message += `• 每$100交易量 = 1积分\n`;
    message += `• 实时统计，及时到账\n`;
    message += `• 积分可用于兑换奖励\n`;
    
    // 邀请链接
    message += `\n\n🔗 <b>您的专属邀请链接:</b>\n`;
    if (stats.invitationLink) {
      message += `<code>${stats.invitationLink}</code>\n\n`;
      message += `💡 <b>如何使用:</b>\n`;
      message += `• 复制上方链接分享给朋友\n`;
      message += `• 朋友点击链接开始使用Bot\n`;
      message += `• 朋友交易时您将获得积分奖励`;
    } else {
      message += `<i>暂无可用的邀请链接</i>`;
    }
    
    // 更新时间
    message += `\n\n🕐 <b>更新时间:</b> ${this.formatTimestamp(stats.lastUpdated)}`;
    
    return message;
  }

  /**
   * 格式化邀请错误消息
   */
  public formatInviteErrorMessage(error: DetailedError): string {
    let message = `❌ <b>邀请统计查询失败</b>\n\n`;
    
    // 根据错误类型提供特定的错误信息
    switch (error.code) {
      case 'TOKEN_NOT_FOUND':
        message += `🎁 未找到邀请记录\n\n`;
        message += `可能的原因：\n`;
        message += `• 您还没有邀请过其他用户\n`;
        message += `• 邀请数据同步延迟\n\n`;
        message += `💡 <b>建议:</b> 开始邀请朋友使用Bot`;
        break;
        
      case 'NETWORK_ERROR':
        message += `🌐 网络连接异常\n\n`;
        message += `可能的原因：\n`;
        message += `• 网络连接不稳定\n`;
        message += `• 服务器正在维护\n\n`;
        message += `💡 <b>建议:</b> 请稍后重新发送 <code>/invite</code>`;
        break;
        
      case 'TIMEOUT_ERROR':
        message += `⏱️ 请求超时\n\n`;
        message += `服务器响应时间过长，请稍后重试。\n\n`;
        message += `💡 <b>建议:</b> 等待30秒后重新发送 <code>/invite</code>`;
        break;
        
      case 'SERVER_ERROR':
        message += `🛠️ 服务器内部错误\n\n`;
        message += `我们的技术团队正在处理此问题。\n\n`;
        message += `💡 <b>建议:</b> 请稍后重试或联系客服`;
        break;
        
      case 'RATE_LIMIT_EXCEEDED':
        message += `🚦 请求过于频繁\n\n`;
        message += `为了保护系统稳定性，请稍后重试。\n\n`;
        message += `💡 <b>建议:</b> 等待1-2分钟后重新发送 <code>/invite</code>`;
        break;
        
      case 'DATA_UNAVAILABLE':
        message += `📊 API数据格式异常\n\n`;
        message += `服务器返回的数据格式不符合预期，可能是：\n`;
        message += `• API接口正在升级维护\n`;
        message += `• 数据同步出现临时问题\n`;
        message += `• 服务器配置更新中\n\n`;
        message += `💡 <b>建议:</b> 请稍后重新发送 <code>/invite</code> 命令\n`;
        message += `如果问题持续存在，我们的技术团队将尽快修复`;
        break;
        
      default:
        message += `${error.message}\n\n`;
        if (error.retryable) {
          message += `💡 <b>建议:</b> 请重新发送 <code>/invite</code> 命令`;
        } else {
          message += `💡 <b>建议:</b> 请联系管理员获取帮助`;
        }
    }
    
    message += `\n\n<b>🆘 需要帮助？</b>\n`;
    message += `• 📱 发送 <code>/help</code> 查看使用指南\n`;
    message += `• 💰 发送 <code>/wallet</code> 查看钱包余额\n`;
    message += `• 📊 发送 <code>/markets</code> 查看市场行情\n\n`;
    
    message += `<i>如果问题持续存在，请联系管理员</i>`;
    
    return message;
  }

  /**
   * 格式化积分数值显示
   */
  private formatPoints(points: number): string {
    if (points === 0) {
      return '0.00';
    }
    
    if (points < 0.01) {
      return '< 0.01';
    }
    
    return points.toFixed(2);
  }

  /**
   * 格式化K线数据消息
   */
  public formatChartMessage(candleData: CachedCandleData): string {
    const { symbol, timeFrame, candles, latestPrice, priceChangePercent24h, high24h, low24h, volume24h, isCached } = candleData;
    
    // 计算价格趋势
    const trend = this.calculateTrend(priceChangePercent24h);
    const trendEmoji = this.getTrendEmoji(trend.type);
    const changeText = this.formatPercentage(priceChangePercent24h, true);
    
    // 构建主要信息
    let message = `📊 <b>${symbol}/USDT K线数据</b> (${timeFrame.toUpperCase()}) ${trendEmoji}\n\n`;
    
    message += `🕐 <b>最新价格:</b> ${this.formatPrice(latestPrice, this.defaultOptions)}\n`;
    message += `📊 <b>24h涨跌:</b> ${changeText}\n`;
    message += `📈 <b>24h最高:</b> ${this.formatPrice(high24h, this.defaultOptions)}\n`;
    message += `📉 <b>24h最低:</b> ${this.formatPrice(low24h, this.defaultOptions)}\n`;
    message += `💰 <b>24h成交量:</b> ${this.formatLargeNumber(volume24h)}\n\n`;
    
    // 简单的ASCII趋势图
    const asciiChart = this.generateSimpleAsciiChart(candles.slice(-10)); // 最近10个数据点
    message += `<b>近期趋势:</b>\n<pre>${asciiChart}</pre>\n\n`;
    
    // K线统计信息
    message += `📋 <b>数据统计:</b>\n`;
    message += `• K线数量: ${candles.length} 根\n`;
    message += `• 时间范围: ${this.formatTimeFrame(timeFrame)}\n`;
    message += `• 价格区间: ${this.formatPrice(low24h, this.defaultOptions)} - ${this.formatPrice(high24h, this.defaultOptions)}\n\n`;
    
    // 时间框架选择按钮提示
    message += `⏰ <b>切换时间周期:</b>\n`;
    message += `<code>/chart ${symbol} 1m</code> - 1分钟\n`;
    message += `<code>/chart ${symbol} 5m</code> - 5分钟\n`;
    message += `<code>/chart ${symbol} 1h</code> - 1小时\n`;
    message += `<code>/chart ${symbol} 1d</code> - 1天\n`;
    
    // 添加数据来源信息
    message += `\n<i>🕐 更新时间: ${this.formatTimestamp(candleData.updatedAt)}</i>\n`;
    
    if (isCached) {
      message += `<i>⚡ 缓存数据 (更新间隔: 5分钟)</i>\n`;
    }
    
    message += `<i>📡 数据来源: Hyperliquid</i>`;
    
    return message;
  }

  /**
   * 格式化K线帮助消息
   */
  public formatChartHelpMessage(): string {
    return `
📊 <b>K线图表使用方法</b>

<code>/chart BTC</code> - 查询BTC 1小时K线
<code>/chart ETH 1d</code> - 查询ETH 日线
<code>/chart SOL 5m</code> - 查询SOL 5分钟线

<b>支持的时间周期:</b>
• 1m - 1分钟
• 5m - 5分钟  
• 15m - 15分钟
• 1h - 1小时 (默认)
• 4h - 4小时
• 1d - 1天

<b>支持的交易对:</b>
BTC, ETH, SOL, ETC, LINK, AVAX, UNI等主流币种

<b>功能特点:</b>
• 🕯️ 实时K线数据
• 📈 ASCII趋势图展示
• 📊 24小时统计信息
• ⚡ 5分钟智能缓存
• 🎯 毫秒级响应

<i>💡 提示: 交易对符号不区分大小写</i>
    `.trim();
  }

  /**
   * 格式化K线"正在查询"消息
   */
  public formatChartLoadingMessage(symbol: string, timeFrame: TimeFrame): string {
    return `🔍 正在查询 ${symbol.toUpperCase()} ${timeFrame.toUpperCase()} K线数据...`;
  }

  /**
   * 生成简单的ASCII趋势图
   */
  private generateSimpleAsciiChart(candles: CandleData[]): string {
    if (candles.length === 0) {
      return '暂无数据';
    }

    // 获取价格范围
    const prices = candles.map(c => c.close);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    
    if (minPrice === maxPrice) {
      return '━━━━━━━━━━ (价格平稳)';
    }

    // 将价格映射到5个高度级别
    const height = 5;
    const priceRange = maxPrice - minPrice;
    const symbols = ['▁', '▂', '▃', '▅', '▇'];
    
    let chart = '';
    for (const candle of candles) {
      const normalizedPrice = (candle.close - minPrice) / priceRange;
      const level = Math.min(Math.floor(normalizedPrice * height), height - 1);
      chart += symbols[level];
    }
    
    return `${chart} ($${this.formatPrice(minPrice, { ...this.defaultOptions, showSymbol: false })} - $${this.formatPrice(maxPrice, { ...this.defaultOptions, showSymbol: false })})`;
  }

  /**
   * 格式化TradingView图表图像的说明文字
   */
  public formatChartImageCaption(candleData: CachedCandleData): string {
    const { symbol, timeFrame, latestPrice, priceChangePercent24h, high24h, low24h, volume24h, isCached } = candleData;
    
    // 计算价格趋势
    const trend = this.calculateTrend(priceChangePercent24h);
    const trendEmoji = this.getTrendEmoji(trend.type);
    const changeText = this.formatPercentage(priceChangePercent24h, true);
    
    // 构建简洁的图表说明
    let caption = `📊 <b>${symbol}/USDT</b> (${timeFrame.toUpperCase()}) ${trendEmoji}\n\n`;
    
    caption += `💰 <b>最新:</b> ${this.formatPrice(latestPrice, this.defaultOptions)}\n`;
    caption += `📊 <b>24h:</b> ${changeText}\n`;
    caption += `📈 <b>最高:</b> ${this.formatPrice(high24h, this.defaultOptions)} `;
    caption += `📉 <b>最低:</b> ${this.formatPrice(low24h, this.defaultOptions)}\n`;
    caption += `💹 <b>成交量:</b> ${this.formatLargeNumber(volume24h)}\n\n`;
    
    // 快速切换时间周期提示
    caption += `⚡ 切换周期: <code>/chart ${symbol} 1m|5m|1h|1d</code>\n`;
    
    // 数据来源
    caption += `\n<i>📡 TradingView专业图表 • `;
    if (isCached) {
      caption += `⚡ 缓存数据</i>`;
    } else {
      caption += `🔄 实时数据</i>`;
    }
    
    return caption;
  }

  /**
   * 格式化时间框架显示
   */
  private formatTimeFrame(timeFrame: TimeFrame): string {
    const timeFrameMap: { [key in TimeFrame]: string } = {
      '1m': '1分钟',
      '5m': '5分钟',
      '15m': '15分钟',
      '1h': '1小时',
      '4h': '4小时',
      '1d': '1天'
    };
    
    return timeFrameMap[timeFrame] || timeFrame;
  }

  /**
   * 格式化交易引导消息 - 选择代币
   */
  public formatTradingSymbolPrompt(action: 'long' | 'short'): string {
    const actionText = action === 'long' ? '做多' : '做空';
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `${actionEmoji} <b>开始${actionText}交易</b>\n\n`;
    message += `请回复您想要${actionText}的代币符号\n\n`;
    message += `💡 <b>例如:</b> HYPE, BTC, ETH, SOL\n\n`;
    message += `<b>支持的代币:</b>\n`;
    message += `• 主流币: BTC, ETH, SOL, BNB\n`;
    message += `• 热门币: HYPE, PEPE, DOGE\n`;
    message += `• DeFi: UNI, LINK, AAVE\n\n`;
    message += `<i>💬 直接回复代币符号即可，不区分大小写</i>`;
    
    return message;
  }

  /**
   * 格式化交易引导消息 - 选择杠杆
   */
  public formatTradingLeveragePrompt(action: 'long' | 'short', symbol: string, currentPrice: number, availableMargin: number): string {
    const actionText = action === 'long' ? '做多' : '做空';
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `${actionEmoji} <b>${actionText} ${symbol}</b>\n`;
    message += `当前价格: <b>${this.formatPrice(currentPrice, this.defaultOptions)}</b>\n\n`;
    
    message += `<b>选择您的杠杆倍数:</b>\n`;
    message += `可用保证金: <b>${this.formatPrice(availableMargin, this.defaultOptions)}</b>\n`;
    message += `最大杠杆: <b>3x</b>\n\n`;
    
    return message;
  }

  /**
   * 格式化交易引导消息 - 输入金额
   */
  public formatTradingAmountPrompt(action: 'long' | 'short', symbol: string, leverage: string, availableMargin: number): string {
    const actionText = action === 'long' ? '做多' : '做空';
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `${actionEmoji} <b>${actionText} ${symbol}</b>\n`;
    message += `杠杆倍数: <b>${leverage}</b>\n\n`;
    
    message += `<b>选择仓位大小</b>\n\n`;
    message += `可用保证金: <b>${this.formatPrice(availableMargin, this.defaultOptions)}</b>\n\n`;
    message += `请回复您要用于${actionText} ${symbol} 的保证金金额($)\n\n`;
    message += `<i>💡 直接回复数字即可，例如: 30</i>`;
    
    return message;
  }

  /**
   * 格式化交易订单预览
   */
  public formatTradingOrderPreview(
    action: 'long' | 'short', 
    symbol: string, 
    leverage: string, 
    amount: string,
    currentPrice: number,
    orderSize: number,
    liquidationPrice: number
  ): string {
    const actionText = action === 'long' ? 'LONG' : 'SHORT';
    const actionEmoji = action === 'long' ? '📈' : '📉';
    const leverageNum = parseFloat(leverage.replace('x', ''));
    const positionValue = parseFloat(amount) * leverageNum;
    
    let message = `💰 <b>Order Preview</b>\n\n`;
    message += `Market: <b>${actionText} ${symbol}</b> ${actionEmoji}\n`;
    message += `Leverage: <b>${leverage}</b>\n`;
    message += `Order Size: <b>${orderSize.toFixed(6)} ${symbol} / $${this.formatCurrency(parseFloat(amount))}</b>\n`;
    message += `Current Price: <b>$${this.formatCurrency(currentPrice)}</b>\n`;
    message += `Forced Liquidation Price: <b>$${this.formatCurrency(liquidationPrice)}</b>\n\n`;
    message += `Click the button below to confirm your trade`;
    
    return message;
  }

  /**
   * 格式化余额不足的交易错误消息
   */
  public formatTradingInsufficientFundsMessage(): string {
    let message = `💰 <b>账户余额不足</b>\n\n`;
    message += `您的账户暂时无法进行交易。您可能需要先向账户充值。\n\n`;
    message += `💡 <b>解决方案:</b>\n`;
    message += `• 使用 /wallet 查看当前余额\n`;
    message += `• 向钱包充值更多资金\n`;
    message += `• 减少交易金额`;
    
    return message;
  }

  /**
   * 格式化交易命令格式错误消息
   */
  public formatTradingCommandErrorMessage(action: 'long' | 'short'): string {
    const actionText = action === 'long' ? '做多' : '做空';
    const actionLower = action.toLowerCase();
    
    let message = `❌ <b>命令格式错误</b>\n\n`;
    message += `<b>正确格式:</b>\n`;
    message += `<code>/${actionLower} &lt;代币&gt; &lt;杠杆&gt; &lt;金额&gt;</code>\n\n`;
    message += `<b>示例:</b>\n`;
    message += `<code>/${actionLower} BTC 10x 100</code> - ${actionText}BTC，10倍杠杆，$100\n`;
    message += `<code>/${actionLower} ETH 5x 50</code> - ${actionText}ETH，5倍杠杆，$50\n\n`;
    message += `<b>⚠️ 重要提醒:</b>\n`;
    message += `• 最小交易金额: $10\n`;
    message += `• 支持杠杆: 1x-20x\n`;
    message += `• 支持代币: BTC, ETH, SOL 等主流币\n\n`;
    message += `💡 首次交易建议先用小金额测试`;
    
    return message;
  }

  /**
   * 格式化交易处理中消息
   */
  public formatTradingProcessingMessage(action: 'long' | 'short', symbol: string, leverage: string, amount: string): string {
    const actionText = action === 'long' ? '做多' : '做空';
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `🔄 <b>正在处理${actionText}交易...</b>\n\n`;
    message += `${actionEmoji} 代币: <code>${symbol.toUpperCase()}</code>\n`;
    message += `📊 杠杆: <code>${leverage}</code>\n`;
    message += `💰 金额: <code>${amount}</code>`;
    
    return message;
  }
}

// 导出单例实例
export const messageFormatter = new MessageFormatter();

// 默认导出
export default messageFormatter;