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
        message += `🛠️ Internal server error\n\n`;
        message += `Our technical team is handling this issue.\n\n`;
        message += `💡 <b>Suggestion:</b> Please retry later or contact support`;
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
    
    message += `<b>🏦 Your Account Info:</b>\n`;
    message += `👤 <b>User ID:</b> <code>${userData.userId}</code>\n`;
    message += `💎 <b>Wallet Address:</b> <code>${this.truncateAddress(userData.walletAddress)}</code>\n`;
    message += `⚡ <b>Current Energy:</b> ${userData.energy} ⚡\n`;
    message += `🔗 <b>Your Referral Code:</b> <code>${userData.referralCode}</code>\n\n`;
    
    message += `<b>💡 Quick Start:</b>\n`;
    message += `• <code>/price BTC</code> - Check Bitcoin price\n`;
    message += `• <code>/markets</code> - Market overview\n`;
    message += `• Share your referral code <code>${userData.referralCode}</code> to earn rewards\n\n`;
    
    message += `<i>🎊 Thank you for choosing AIW3, happy trading!</i>`;
    
    return message;
  }

  /**
   * Truncate wallet address (show only first and last few characters)
   * Modified to show full address for testing
   */
  private truncateAddress(address: string): string {
    // Display full wallet address
    return address;
  }

  /**
   * Format energy value display
   */
  public formatEnergyDisplay(energy: number): string {
    if (energy >= 1000) {
      return `${(energy / 1000).toFixed(1)}K ⚡`;
    }
    return `${energy} ⚡`;
  }

  /**
   * Format user statistics information (reserved)
   */
  public formatUserStatsMessage(userStats: any): string {
    // Reserved for future user statistics feature
    return `📊 <b>User Statistics</b>\n\nFeature in development...`;
  }

  /**
   * Format wallet balance message (supports new on-chain wallet and legacy exchange account)
   */
  public formatWalletBalanceMessage(balance: FormattedWalletBalance | FormattedAccountBalance, warnings?: string[]): string {
    // Check if it's new on-chain wallet format
    if ('address' in balance && 'network' in balance) {
      return this.formatOnChainWalletMessage(balance as FormattedWalletBalance, warnings);
    } else {
      // Legacy exchange account format (backward compatibility)
      return this.formatExchangeAccountMessage(balance as FormattedAccountBalance, warnings);
    }
  }

  /**
   * Format on-chain wallet balance message
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
   * Format exchange account balance message (legacy compatibility)
   */
  private formatExchangeAccountMessage(balance: FormattedAccountBalance, warnings?: string[]): string {
    let message = `💰 <b>Wallet Balance</b>\n\n`;
    
    // Main balance information
    message += `📈 <b>Total Assets:</b> $${this.formatCurrency(balance.totalEquity)} ${balance.currency}\n`;
    message += `💳 <b>Available Balance:</b> $${this.formatCurrency(balance.availableEquity)} ${balance.currency}\n`;
    
    if (balance.orderFrozen > 0) {
      message += `🔒 <b>Frozen Funds:</b> $${this.formatCurrency(balance.orderFrozen)} ${balance.currency}\n`;
    }
    
    if (balance.adjustedEquity !== balance.totalEquity && balance.adjustedEquity > 0) {
      message += `📊 <b>Adjusted Equity:</b> $${this.formatCurrency(balance.adjustedEquity)} ${balance.currency}\n`;
    }

    // Fund utilization rate
    const utilizationEmoji = this.getUtilizationEmoji(balance.utilizationRate);
    message += `\n💡 <b>Fund Utilization:</b> ${utilizationEmoji} ${balance.utilizationRate}%\n`;
    
    // Last update time
    message += `🕐 <b>Updated:</b> ${this.formatTimestamp(balance.lastUpdated)}\n`;

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
   * Format currency values
   */
  private formatCurrency(amount: number): string {
    if (amount === 0) {
      return '0.00';
    }
    
    // Display compact format for amounts > 1000
    if (amount >= 1000) {
      return this.formatLargeNumber(amount);
    }
    
    // Display full values for amounts < 1000
    return amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Get corresponding emoji based on fund utilization rate
   */
  private getUtilizationEmoji(utilizationRate: number): string {
    if (utilizationRate >= 80) {
      return '🔴'; // High risk
    } else if (utilizationRate >= 60) {
      return '🟡'; // Medium risk
    } else if (utilizationRate >= 30) {
      return '🟢'; // Normal
    } else {
      return '⚪'; // Low utilization
    }
  }

  /**
   * Format wallet balance loading message
   */
  public formatWalletLoadingMessage(): string {
    return `🔍 <b>Querying wallet balance...</b>\n\n💡 <i>Fetching your account information</i>`;
  }

  /**
   * Format wallet balance error message
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
        message += `🛠️ Internal server error\n\n`;
        message += `Our technical team is handling this issue.\n\n`;
        message += `💡 <b>Suggestion:</b> Please retry later or contact support`;
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
    let message = `📊 <b>${symbol}/USDT Candlestick Data</b> (${timeFrame.toUpperCase()}) ${trendEmoji}\n\n`;
    
    message += `🕐 <b>Latest Price:</b> ${this.formatPrice(latestPrice, this.defaultOptions)}\n`;
    message += `📊 <b>24h Change:</b> ${changeText}\n`;
    message += `📈 <b>24h High:</b> ${this.formatPrice(high24h, this.defaultOptions)}\n`;
    message += `📉 <b>24h Low:</b> ${this.formatPrice(low24h, this.defaultOptions)}\n`;
    message += `💰 <b>24h Volume:</b> ${this.formatLargeNumber(volume24h)}\n\n`;
    
    // 简单的ASCII趋势图
    const asciiChart = this.generateSimpleAsciiChart(candles.slice(-10)); // 最近10个数据点
    message += `<b>Recent Trend:</b>\n<pre>${asciiChart}</pre>\n\n`;
    
    // K线统计信息
    message += `📋 <b>Data Statistics:</b>\n`;
    message += `• Candle Count: ${candles.length}\n`;
    message += `• Timeframe: ${this.formatTimeFrame(timeFrame)}\n`;
    message += `• Price Range: ${this.formatPrice(low24h, this.defaultOptions)} - ${this.formatPrice(high24h, this.defaultOptions)}\n\n`;
    
    // 时间框架选择按钮提示
    message += `⏰ <b>Switch Timeframe:</b>\n`;
    message += `<code>/chart ${symbol} 1m</code> - 1 minute\n`;
    message += `<code>/chart ${symbol} 5m</code> - 5 minutes\n`;
    message += `<code>/chart ${symbol} 1h</code> - 1 hour\n`;
    message += `<code>/chart ${symbol} 1d</code> - 1 day\n`;
    
    // 添加数据来源信息
    message += `\n<i>🕐 Updated: ${this.formatTimestamp(candleData.updatedAt)}</i>\n`;
    
    if (isCached) {
      message += `<i>⚡ Cached data (refresh interval: 5 minutes)</i>\n`;
    }
    
    message += `<i>📡 Data source: Hyperliquid</i>`;
    
    return message;
  }

  /**
   * 格式化K线帮助消息
   */
  public formatChartHelpMessage(): string {
    return `
📊 <b>Candlestick Chart Usage</b>

<code>/chart BTC</code> - Query BTC 1-hour chart
<code>/chart ETH 1d</code> - Query ETH daily chart
<code>/chart SOL 5m</code> - Query SOL 5-minute chart

<b>Supported Timeframes:</b>
• 1m - 1 minute
• 5m - 5 minutes  
• 15m - 15 minutes
• 1h - 1 hour (default)
• 4h - 4 hours
• 1d - 1 day

<b>Supported Trading Pairs:</b>
BTC, ETH, SOL, ETC, LINK, AVAX, UNI and other major cryptocurrencies

<b>Features:</b>
• 🕯️ Real-time candlestick data
• 📈 ASCII trend visualization
• 📊 24-hour statistics
• ⚡ 5-minute smart caching
• 🎯 Millisecond response time

<i>💡 Tip: Trading pair symbols are case-insensitive</i>
    `.trim();
  }

  /**
   * 格式化K线"正在查询"消息
   */
  public formatChartLoadingMessage(symbol: string, timeFrame: TimeFrame): string {
    return `🔍 Querying ${symbol.toUpperCase()} ${timeFrame.toUpperCase()} candlestick data...`;
  }

  /**
   * 生成简单的ASCII趋势图
   */
  private generateSimpleAsciiChart(candles: CandleData[]): string {
    if (candles.length === 0) {
      return 'No data available';
    }

    // 获取价格范围
    const prices = candles.map(c => c.close);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    
    if (minPrice === maxPrice) {
      return '━━━━━━━━━━ (Price stable)';
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
    
    caption += `💰 <b>Latest:</b> ${this.formatPrice(latestPrice, this.defaultOptions)}\n`;
    caption += `📊 <b>24h:</b> ${changeText}\n`;
    caption += `📈 <b>High:</b> ${this.formatPrice(high24h, this.defaultOptions)} `;
    caption += `📉 <b>Low:</b> ${this.formatPrice(low24h, this.defaultOptions)}\n`;
    caption += `💹 <b>Volume:</b> ${this.formatLargeNumber(volume24h)}\n\n`;
    
    // 快速切换时间周期提示
    caption += `⚡ Switch timeframe: <code>/chart ${symbol} 1m|5m|1h|1d</code>\n`;
    
    // 数据来源
    caption += `\n<i>📡 TradingView Professional Chart • `;
    if (isCached) {
      caption += `⚡ Cached data</i>`;
    } else {
      caption += `🔄 Real-time data</i>`;
    }
    
    return caption;
  }

  /**
   * 格式化时间框架显示
   */
  private formatTimeFrame(timeFrame: TimeFrame): string {
    const timeFrameMap: { [key in TimeFrame]: string } = {
      '1m': '1 minute',
      '5m': '5 minutes',
      '15m': '15 minutes',
      '1h': '1 hour',
      '4h': '4 hours',
      '1d': '1 day'
    };
    
    return timeFrameMap[timeFrame] || timeFrame;
  }

  /**
   * Format trading guidance message - Select token
   */
  public formatTradingSymbolPrompt(action: 'long' | 'short'): string {
    const actionText = action === 'long' ? 'Long' : 'Short';
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `${actionEmoji} <b>Start ${actionText} Trading</b>\n\n`;
    message += `Please reply with the token symbol you want to ${actionText.toLowerCase()}\n\n`;
    message += `💡 <b>Examples:</b> HYPE, BTC, ETH, SOL\n\n`;
    message += `<b>Supported Tokens:</b>\n`;
    message += `• Major: BTC, ETH, SOL, BNB\n`;
    message += `• Popular: HYPE, PEPE, DOGE\n`;
    message += `• DeFi: UNI, LINK, AAVE\n\n`;
    message += `<i>💬 Simply reply with token symbol, case insensitive</i>`;
    
    return message;
  }

  /**
   * Format trading guidance message - Select leverage
   */
  public formatTradingLeveragePrompt(action: 'long' | 'short', symbol: string, currentPrice: number, availableMargin: number): string {
    const actionText = action === 'long' ? 'Long' : 'Short';
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `${actionEmoji} <b>${actionText} ${symbol}</b>\n`;
    message += `Current Price: <b>${this.formatPrice(currentPrice, this.defaultOptions)}</b>\n\n`;
    
    message += `<b>Select Your Leverage:</b>\n`;
    message += `Available Margin: <b>${this.formatPrice(availableMargin, this.defaultOptions)}</b>\n`;
    message += `Max Leverage: <b>3x</b>\n\n`;
    
    return message;
  }

  /**
   * Format trading guidance message - Enter amount
   */
  public formatTradingAmountPrompt(action: 'long' | 'short', symbol: string, leverage: string, availableMargin: number): string {
    const actionText = action === 'long' ? 'Long' : 'Short';
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `${actionEmoji} <b>${actionText} ${symbol}</b>\n`;
    message += `Leverage: <b>${leverage}</b>\n\n`;
    
    message += `<b>Select Position Size</b>\n\n`;
    message += `Available Margin: <b>${this.formatPrice(availableMargin, this.defaultOptions)}</b>\n\n`;
    message += `Please reply with the margin amount ($) for ${actionText.toLowerCase()} ${symbol}\n\n`;
    message += `<i>💡 Simply reply with number, e.g.: 30</i>`;
    
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
   * Format trading insufficient funds error message
   */
  public formatTradingInsufficientFundsMessage(): string {
    let message = `💰 <b>Insufficient Account Balance</b>\n\n`;
    message += `Your account cannot currently trade. You may need to deposit funds first.\n\n`;
    message += `💡 <b>Solutions:</b>\n`;
    message += `• Use /wallet to check current balance\n`;
    message += `• Deposit more funds to wallet\n`;
    message += `• Reduce trading amount`;
    
    return message;
  }

  /**
   * Format trading command format error message
   */
  public formatTradingCommandErrorMessage(action: 'long' | 'short'): string {
    const actionText = action === 'long' ? 'Long' : 'Short';
    const actionLower = action.toLowerCase();
    
    let message = `❌ <b>Command Format Error</b>\n\n`;
    message += `<b>Correct Format:</b>\n`;
    message += `<code>/${actionLower} &lt;token&gt; &lt;leverage&gt; &lt;amount&gt;</code>\n\n`;
    message += `<b>Examples:</b>\n`;
    message += `<code>/${actionLower} BTC 10x 100</code> - ${actionText} BTC, 10x leverage, $100\n`;
    message += `<code>/${actionLower} ETH 5x 50</code> - ${actionText} ETH, 5x leverage, $50\n\n`;
    message += `<b>⚠️ Important Notes:</b>\n`;
    message += `• Minimum trade amount: $10\n`;
    message += `• Supported leverage: 1x-20x\n`;
    message += `• Supported tokens: BTC, ETH, SOL and other major coins\n\n`;
    message += `💡 First-time traders should test with small amounts`;
    
    return message;
  }

  /**
   * Format trading processing message
   */
  public formatTradingProcessingMessage(action: 'long' | 'short', symbol: string, leverage: string, amount: string): string {
    const actionText = action === 'long' ? 'Long' : 'Short';
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `🔄 <b>Processing ${actionText} Trade...</b>\n\n`;
    message += `${actionEmoji} Token: <code>${symbol.toUpperCase()}</code>\n`;
    message += `📊 Leverage: <code>${leverage}</code>\n`;
    message += `💰 Amount: <code>${amount}</code>`;
    
    return message;
  }
}

// 导出单例实例
export const messageFormatter = new MessageFormatter();

// 默认导出
export default messageFormatter;