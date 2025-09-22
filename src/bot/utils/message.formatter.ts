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
import { i18nService } from '../../services/i18n.service';

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
  public async formatPriceMessage(tokenData: CachedTokenData, options?: Partial<FormatOptions>, locale: string = 'en'): Promise<string> {
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
    
    // Get translated labels
    const priceInfoLabel = await i18nService.__('price.priceInfoWithTrend', locale, { symbol });
    const currentPriceLabel = await i18nService.__('price.currentPrice', locale);
    const change24hLabel = await i18nService.__('price.change24hLabel', locale);
    const high24hLabel = await i18nService.__('price.high24hLabel', locale);
    const low24hLabel = await i18nService.__('price.low24hLabel', locale);
    const volumeLabel = await i18nService.__('price.volumeLabel', locale);
    const marketCapLabel = await i18nService.__('price.marketCapLabel', locale);
    const updatedLabel = await i18nService.__('price.updatedLabel', locale);
    const cachedDataNote = await i18nService.__('price.cachedDataNote', locale);
    const dataSource = await i18nService.__('price.dataSource', locale);
    
    // Build complete message
    let message = `<b>💰 ${symbol}`;
    if (name && name !== symbol) {
      message += ` (${name})`;
    }
    message += ` ${priceInfoLabel}</b> ${trendEmoji}\n\n`;
    
    message += `🏷️ <b>${currentPriceLabel}</b> ${priceText}\n`;
    message += `📊 <b>${change24hLabel}</b> ${changeText}\n`;
    
    // Show 24h high/low if available
    if (high24h && low24h && high24h > 0 && low24h > 0) {
      message += `📈 <b>${high24hLabel}</b> ${this.formatPrice(high24h, opts)}\n`;
      message += `📉 <b>${low24hLabel}</b> ${this.formatPrice(low24h, opts)}\n`;
    }
    
    message += `📈 <b>${volumeLabel}</b> $${volumeText}\n`;
    
    if (marketCap > 0) {
      message += `💎 <b>${marketCapLabel}</b> $${marketCapText}\n`;
    }
    
    // Add data source information
    message += `\n<i>🕐 ${updatedLabel} ${this.formatTimestamp(tokenData.updatedAt)}</i>\n`;
    
    if (isCached) {
      message += `<i>⚡ ${cachedDataNote}</i>\n`;
    }
    
    message += `<i>📡 ${dataSource}</i>`;
    
    return message;
  }

  /**
   * Format error message
   */
  public async formatErrorMessage(error: DetailedError | Error, locale: string = 'en'): Promise<string> {
    const queryFailedLabel = await i18nService.__('price.queryFailed', locale);
    let message = `❌ <b>${queryFailedLabel}</b>\n\n`;
    
    if ('code' in error && error.context) {
      // DetailedError - Provide more detailed error information
      message += error.message;
      
      if (error.retryable) {
        const retryLater = await i18nService.__('price.retryLater', locale);
        message += `\n\n💡 <i>${retryLater}</i>`;
      }
      
      // Provide specific suggestions based on error type
      switch (error.code) {
        case 'TOKEN_NOT_FOUND':
          const suggestionsLabel = await i18nService.__('price.suggestions', locale);
          const checkTokenSymbol = await i18nService.__('price.checkTokenSymbol', locale);
          const tryCommonTokens = await i18nService.__('price.tryCommonTokens', locale);
          const ensureUppercase = await i18nService.__('price.ensureUppercase', locale);
          
          message += `\n\n📝 <b>${suggestionsLabel}</b>\n`;
          message += `${checkTokenSymbol}\n`;
          message += `${tryCommonTokens}\n`;
          message += `${ensureUppercase}`;
          break;
          
        case 'RATE_LIMIT_EXCEEDED':
          const waitAndRetry = await i18nService.__('price.waitAndRetry', locale);
          message += `\n\n⏰ <i>${waitAndRetry}</i>`;
          break;
          
        case 'NETWORK_ERROR':
          const checkConnection = await i18nService.__('price.checkConnection', locale);
          message += `\n\n🌐 <i>${checkConnection}</i>`;
          break;
      }
    } else {
      // Regular Error
      message += error.message;
    }
    
    const contactAdmin = await i18nService.__('price.contactAdmin', locale);
    message += `\n\n<i>${contactAdmin}</i>`;
    
    return message;
  }

  /**
   * Format help message
   */
  public async formatHelpMessage(locale: string = 'en'): Promise<string> {
    const helpTitle = await i18nService.__('price.helpTitle', locale);
    const examples = await i18nService.__('price.helpExamples', locale);
    const getBtc = await i18nService.__('price.helpGetBtc', locale);
    const getEth = await i18nService.__('price.helpGetEth', locale);
    const getSol = await i18nService.__('price.helpGetSol', locale);
    const supportedTokens = await i18nService.__('price.helpSupportedTokens', locale);
    const supportedList = await i18nService.__('price.helpSupportedList', locale);
    const features = await i18nService.__('price.helpFeatures', locale);
    const realtimeData = await i18nService.__('price.helpRealtimeData', locale);
    const priceChanges = await i18nService.__('price.helpPriceChanges', locale);
    const volumeMarketcap = await i18nService.__('price.helpVolumeMarketcap', locale);
    const smartCaching = await i18nService.__('price.helpSmartCaching', locale);
    const fastResponse = await i18nService.__('price.helpFastResponse', locale);
    const caseInsensitive = await i18nService.__('price.helpCaseInsensitive', locale);
    
    return `
💡 <b>${helpTitle}</b>

<b>${examples}</b>
<code>/price BTC</code> ${getBtc}
<code>/price ETH</code> ${getEth}  
<code>/price SOL</code> ${getSol}

<b>${supportedTokens}</b>
${supportedList}

<b>${features}</b>
${realtimeData}
${priceChanges}
${volumeMarketcap}
${smartCaching}
${fastResponse}

<i>${caseInsensitive}</i>
    `.trim();
  }

  /**
   * Format "querying" message
   */
  public async formatLoadingMessage(symbol: string, locale: string = 'en'): Promise<string> {
    return await i18nService.__('price.loading', locale, { symbol: symbol.toUpperCase() });
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
  public async formatCompactPriceMessage(tokenData: TokenData, locale: string = 'en'): Promise<string> {
    const { symbol, price, change24h } = tokenData;
    const changeText = this.formatPercentage(change24h);
    const emoji = change24h >= 0 ? '🟢' : '🔴';
    
    const template = await i18nService.__('price.compactPriceFormat', locale);
    return template.replace('{emoji}', emoji)
                   .replace('{symbol}', `<b>${symbol}</b>`)
                   .replace('{price}', this.formatPrice(price, this.defaultOptions))
                   .replace('{change}', changeText);
  }

  /**
   * Format multi-token price message
   */
  public async formatMultiTokenMessage(tokens: CachedTokenData[], locale: string = 'en'): Promise<string> {
    if (tokens.length === 0) {
      const noTokensFound = await i18nService.__('price.noTokensFound', locale);
      return `❌ <b>${noTokensFound}</b>`;
    }
    
    const titleTemplate = await i18nService.__('price.multiTokenTitle', locale, { count: tokens.length });
    let message = `📈 <b>${titleTemplate}</b>\n\n`;
    
    for (const token of tokens) {
      const compactMessage = await this.formatCompactPriceMessage(token, locale);
      message += compactMessage + '\n';
    }
    
    const updatedLabel = await i18nService.__('price.updatedLabel', locale);
    const dataSource = await i18nService.__('price.dataSource', locale);
    
    message += `\n<i>🕐 ${updatedLabel} ${this.formatTimestamp(new Date())}</i>`;
    message += `\n<i>📡 ${dataSource}</i>`;
    
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
    
    // Format according to the requested structure
    let message = `🏦 <b>Your Account Info:</b>\n`;
    message += `👤 User ID: ${userId}\n`;
    message += `💎 Wallet Address: ${walletAddress}\n`;
    message += `🔗 Referral Code: ${referralCode}\n\n`;
    
    message += `💡 <b>Quick Start:</b>\n`;
    message += `• /price BTC - Check Bitcoin price\n`;
    message += `• /markets - View market overview\n`;
    message += `• /help - View all features\n\n`;
    
    message += `🚀 <b>Available Commands:</b>\n`;
    message += `• /wallet - View wallet balance\n`;
    message += `• /markets - View all tradable perpetual tokens\n`;
    message += `• /chart - View token price charts\n`;
    message += `• /price - Check token prices\n`;
    message += `• /long or /short - Open long or short positions\n`;
    message += `• /close - Close positions\n`;
    message += `• /positions - View current positions\n`;
    message += `• /pnl - View profit and loss charts\n`;
    message += `• /push - Set push notifications\n\n`;
    
    message += `🔐 Your wallet address and private key are securely managed by the system\n`;
    message += `💎 More features coming soon, stay tuned!`;
    
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
  public async formatWalletBalanceMessage(
    balance: FormattedWalletBalance | FormattedAccountBalance, 
    warnings?: string[], 
    locale: string = 'en'
  ): Promise<string> {
    // Check if it's new on-chain wallet format
    if ('address' in balance && 'network' in balance) {
      return await this.formatOnChainWalletMessage(balance as FormattedWalletBalance, warnings, locale);
    } else {
      // Legacy exchange account format (backward compatibility)
      return await this.formatExchangeAccountMessage(balance as FormattedAccountBalance, warnings, locale);
    }
  }

  /**
   * Format on-chain wallet balance message
   */
  private async formatOnChainWalletMessage(balance: FormattedWalletBalance, warnings?: string[], locale: string = 'en'): Promise<string> {
    // Determine wallet name based on network type
    const walletNameKey = balance.network.toLowerCase() === 'arbitrum' ? 'wallet.hyperliquidWallet' : 'wallet.solanaWallet';
    const walletName = await i18nService.__(walletNameKey, locale);
    let message = `💰 <b>${walletName}</b>\n\n`;
    
    // Wallet address information
    const addressLabel = await i18nService.__('wallet.address', locale);
    const networkLabel = await i18nService.__('wallet.network', locale);
    message += `${addressLabel} <code>${this.truncateAddress(balance.address)}</code>\n`;
    message += `${networkLabel} ${balance.network.toUpperCase()}\n\n`;
    
    // Special display for Hyperliquid wallet
    if (balance.network.toLowerCase() === 'arbitrum') {
      // Contract account balance (main funds)
      const contractAccountValueLabel = await i18nService.__('wallet.contractAccountValue', locale);
      message += `${contractAccountValueLabel} ${balance.nativeBalance.toFixed(2)} ${balance.nativeSymbol} ($${this.formatCurrency(balance.nativeBalance)})\n`;
      
      // Withdrawable amount (available margin)
      if (balance.withdrawableAmount !== undefined) {
        const occupiedMargin = balance.nativeBalance - balance.withdrawableAmount;
        const availableMarginLabel = await i18nService.__('wallet.availableMargin', locale);
        message += `${availableMarginLabel} ${balance.withdrawableAmount.toFixed(2)} ${balance.nativeSymbol} ($${this.formatCurrency(balance.withdrawableAmount)})\n`;
        if (occupiedMargin > 0) {
          const usedMarginLabel = await i18nService.__('wallet.usedMargin', locale);
          message += `${usedMarginLabel} ${occupiedMargin.toFixed(2)} ${balance.nativeSymbol} ($${this.formatCurrency(occupiedMargin)})\n`;
        }
      }
      
      // Fund usage description
      const fundUsageLabel = await i18nService.__('wallet.fundUsageDescription', locale);
      const contractAccountDesc = await i18nService.__('wallet.contractAccountDesc', locale);
      const availableMarginDesc = await i18nService.__('wallet.availableMarginDesc', locale);
      const usedMarginDesc = await i18nService.__('wallet.usedMarginDesc', locale);
      message += `\n${fundUsageLabel}\n`;
      message += `${contractAccountDesc}\n`;
      message += `${availableMarginDesc}\n`;
      message += `${usedMarginDesc}\n`;
    } else {
      // Original display for other networks (contract account only)
      const contractAccountBalanceLabel = await i18nService.__('wallet.contractAccountBalance', locale);
      message += `${contractAccountBalanceLabel} ${balance.nativeBalance.toFixed(6)} ${balance.nativeSymbol}\n`;
    }
    
    // Total value - always display, even if 0
    const totalValueLabel = await i18nService.__('wallet.totalValue', locale);
    message += `\n${totalValueLabel} $${this.formatCurrency(balance.totalUsdValue)}\n`;
    
    // Add notification if total value is 0
    if (balance.totalUsdValue === 0) {
      const noAssetsNote = await i18nService.__('wallet.noAssetsNote', locale);
      message += `\n${noAssetsNote}\n`;
    }
    
    // Last update time
    const lastUpdatedLabel = await i18nService.__('wallet.lastUpdated', locale);
    message += `${lastUpdatedLabel} ${this.formatTimestamp(balance.lastUpdated)}\n`;

    // Warning information
    if (warnings && warnings.length > 0) {
      const warningsLabel = await i18nService.__('wallet.warnings', locale);
      message += `\n<b>${warningsLabel}</b>\n`;
      warnings.forEach(warning => {
        message += `• ${warning}\n`;
      });
    }

    // Separator
    message += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    // Related operation suggestions
    const availableActionsLabel = await i18nService.__('wallet.availableActions', locale);
    message += `<b>${availableActionsLabel}</b>\n`;
    if (balance.nativeBalance > 0.01) {
      const sendTokensLabel = await i18nService.__('wallet.sendTokens', locale);
      const participateDefiLabel = await i18nService.__('wallet.participateDefi', locale);
      message += `${sendTokensLabel}\n`;
      message += `${participateDefiLabel}\n`;
    }
    const checkSolPrice = await i18nService.__('wallet.checkSolPrice', locale);
    const checkUsdtPrice = await i18nService.__('wallet.checkUsdtPrice', locale);
    message += `${checkSolPrice}\n`;
    message += `${checkUsdtPrice}\n`;
    
    if (balance.nativeBalance < 0.001) {
      const balanceTooLow = await i18nService.__('wallet.balanceTooLow', locale);
      message += `\n${balanceTooLow}`;
    }

    const realTimeData = await i18nService.__('wallet.realTimeData', locale);
    message += `\n\n⚡ <i>${realTimeData}</i>`;

    return message;
  }

  /**
   * Format exchange account balance message (legacy compatibility)
   */
  private async formatExchangeAccountMessage(balance: FormattedAccountBalance, warnings?: string[], locale: string = 'en'): Promise<string> {
    const titleLabel = await i18nService.__('wallet.title', locale);
    let message = `💰 <b>${titleLabel}</b>\n\n`;
    
    // Main balance information
    const totalAssetsLabel = await i18nService.__('wallet.totalAssets', locale, { amount: this.formatCurrency(balance.totalEquity) });
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
    const lastUpdatedLabel = await i18nService.__('wallet.lastUpdated', locale);
    message += `${lastUpdatedLabel} ${this.formatTimestamp(balance.lastUpdated)}\n`;

    // Warning information
    if (warnings && warnings.length > 0) {
      message += `\n<b>⚠️ Risk Warnings:</b>\n`;
      warnings.forEach(warning => {
        message += `• ${warning}\n`;
      });
    }

    // Separator
    message += `\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    // Related operation suggestions
    const availableActionsLabel = await i18nService.__('wallet.availableActions', locale);
    message += `💹 <b>${availableActionsLabel}</b>\n`;
    if (balance.availableEquity >= 100) {
      message += `• <code>/long BTC</code> - Open long position\n`;
      message += `• <code>/short ETH</code> - Open short position\n`;
    }
    message += `• <code>/positions</code> - View positions\n`;
    message += `• <code>/orders</code> - View orders\n`;
    
    if (balance.availableEquity < 100) {
      message += `\n💡 <i>Insufficient balance, recommend depositing funds before trading</i>`;
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
  public async formatWalletErrorMessage(error: DetailedError, locale: string = 'en'): Promise<string> {
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
   * Format insufficient balance warning message
   */
  public formatInsufficientBalanceMessage(
    requiredAmount: number, 
    availableAmount: number
  ): string {
    let message = `⚠️ <b>Insufficient Balance</b>\n\n`;
    
    message += `💰 <b>Required Amount:</b> $${this.formatCurrency(requiredAmount)} USDT\n`;
    message += `💳 <b>Available Balance:</b> $${this.formatCurrency(availableAmount)} USDT\n`;
    message += `📉 <b>Shortage:</b> $${this.formatCurrency(requiredAmount - availableAmount)} USDT\n\n`;
    
    message += `💡 <b>Suggested Actions:</b>\n`;
    message += `• 📈 Deposit more funds\n`;
    message += `• 📊 Reduce trading amount\n`;
    message += `• 🔄 Cancel some orders to free frozen funds\n\n`;
    
    message += `📱 Send <code>/wallet</code> to check latest balance`;
    
    return message;
  }

  /**
   * Format invitation statistics message
   */
  public formatInviteStatsMessage(stats: FormattedInviteStats): string {
    let message = `🎁 <b>Invitation Statistics</b>\n\n`;
    
    // Core statistics
    message += `👥 <b>Invitees:</b> ${stats.inviteeCount} users\n`;
    message += `💰 <b>Total Trading Volume:</b> $${this.formatCurrency(stats.totalTradingVolume)}\n`;
    message += `⭐ <b>Current Points:</b> ${this.formatPoints(stats.currentPoints)} pts\n`;
    
    // Invitation records
    if (stats.inviteRecords.length > 0) {
      message += `\n📊 <b>Invitation Records (Page ${stats.pagination.page}):</b>\n`;
      stats.inviteRecords.forEach((record, index) => {
        const number = (stats.pagination.page - 1) * 10 + index + 1;
        const address = this.truncateAddress(record.wallet_address);
        const date = this.formatTimestamp(new Date(record.createdAt));
        message += `${number}. <code>${address}</code> (${date})\n`;
      });
      
      // Pagination info
      if (stats.pagination.totalPages > 1) {
        message += `\n📖 <b>Pagination:</b> ${stats.pagination.page}/${stats.pagination.totalPages}`;
        
        if (stats.pagination.hasNext) {
          message += `\nUse <code>/invite ${stats.pagination.page + 1}</code> to view next page`;
        }
        if (stats.pagination.hasPrev) {
          message += `\nUse <code>/invite ${stats.pagination.page - 1}</code> to view previous page`;
        }
      }
    } else {
      message += `\n📭 <b>Invitation Records:</b> No invitations yet\n`;
      message += `💡 Start inviting friends to earn points rewards!`;
    }
    
    // Points explanation
    message += `\n\n🏆 <b>Points Rules:</b>\n`;
    message += `• Every $100 trading volume = 1 point\n`;
    message += `• Real-time statistics, instant crediting\n`;
    message += `• Points can be redeemed for rewards\n`;
    
    // Invitation link
    message += `\n\n🔗 <b>Your Exclusive Invitation Link:</b>\n`;
    if (stats.invitationLink) {
      message += `<code>${stats.invitationLink}</code>\n\n`;
      message += `💡 <b>How to use:</b>\n`;
      message += `• Copy the link above and share with friends\n`;
      message += `• Friends click the link to start using the Bot\n`;
      message += `• You earn points when friends trade`;
    } else {
      message += `<i>No available invitation link</i>`;
    }
    
    // Update time
    message += `\n\n🕐 <b>Updated:</b> ${this.formatTimestamp(stats.lastUpdated)}`;
    
    return message;
  }

  /**
   * Format invitation error message
   */
  public formatInviteErrorMessage(error: DetailedError): string {
    let message = `❌ <b>Invitation Statistics Query Failed</b>\n\n`;
    
    // Provide specific error information based on error type
    switch (error.code) {
      case 'TOKEN_NOT_FOUND':
        message += `🎁 No invitation records found\n\n`;
        message += `Possible reasons:\n`;
        message += `• You haven't invited other users yet\n`;
        message += `• Invitation data sync delay\n\n`;
        message += `💡 <b>Suggestion:</b> Start inviting friends to use the Bot`;
        break;
        
      case 'NETWORK_ERROR':
        message += `🌐 Network connection error\n\n`;
        message += `Possible reasons:\n`;
        message += `• Unstable network connection\n`;
        message += `• Server under maintenance\n\n`;
        message += `💡 <b>Suggestion:</b> Please resend <code>/invite</code> later`;
        break;
        
      case 'TIMEOUT_ERROR':
        message += `⏱️ Request timeout\n\n`;
        message += `Server response time too long, please try again later.\n\n`;
        message += `💡 <b>Suggestion:</b> Wait 30 seconds then resend <code>/invite</code>`;
        break;
        
      case 'SERVER_ERROR':
        message += `🛠️ Internal server error\n\n`;
        message += `Our technical team is handling this issue.\n\n`;
        message += `💡 <b>Suggestion:</b> Please retry later or contact support`;
        break;
        
      case 'RATE_LIMIT_EXCEEDED':
        message += `🚦 Too many requests\n\n`;
        message += `To protect system stability, please try again later.\n\n`;
        message += `💡 <b>Suggestion:</b> Wait 1-2 minutes then resend <code>/invite</code>`;
        break;
        
      case 'DATA_UNAVAILABLE':
        message += `📊 API data format exception\n\n`;
        message += `Server returned data format doesn't match expectations, possibly:\n`;
        message += `• API interface undergoing maintenance\n`;
        message += `• Temporary data synchronization issues\n`;
        message += `• Server configuration updates in progress\n\n`;
        message += `💡 <b>Suggestion:</b> Please resend <code>/invite</code> command later\n`;
        message += `If the problem persists, our technical team will fix it soon`;
        break;
        
      default:
        message += `${error.message}\n\n`;
        if (error.retryable) {
          message += `💡 <b>Suggestion:</b> Please resend <code>/invite</code> command`;
        } else {
          message += `💡 <b>Suggestion:</b> Please contact administrator for help`;
        }
    }
    
    message += `\n\n<b>🆘 Need Help?</b>\n`;
    message += `• 📱 Send <code>/help</code> to view usage guide\n`;
    message += `• 💰 Send <code>/wallet</code> to check wallet balance\n`;
    message += `• 📊 Send <code>/markets</code> to view market data\n\n`;
    
    message += `<i>If the problem persists, please contact administrator</i>`;
    
    return message;
  }

  /**
   * Format points value display
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
  public async formatTradingSymbolPrompt(action: 'long' | 'short', locale: string = 'en'): Promise<string> {
    const symbolPrompt = await i18nService.__('trading.symbolPrompt', locale, { action });
    const replyWithSymbol = await i18nService.__('trading.replyWithSymbol', locale, { action });
    const examples = await i18nService.__('trading.examples', locale);
    const supportedTokens = await i18nService.__('trading.supportedTokens', locale);
    const majorTokens = await i18nService.__('trading.majorTokens', locale);
    const popularTokens = await i18nService.__('trading.popularTokens', locale);
    const defiTokens = await i18nService.__('trading.defiTokens', locale);
    const replyWithSymbolNote = await i18nService.__('trading.replyWithSymbolNote', locale);
    
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `${actionEmoji} <b>${symbolPrompt}</b>\n\n`;
    message += `${replyWithSymbol}\n\n`;
    message += `💡 <b>${examples}</b> HYPE, BTC, ETH, SOL\n\n`;
    message += `<b>${supportedTokens}</b>\n`;
    message += `${majorTokens}\n`;
    message += `${popularTokens}\n`;
    message += `${defiTokens}\n\n`;
    message += `<i>💬 ${replyWithSymbolNote}</i>`;
    
    return message;
  }

  /**
   * Format trading guidance message - Select leverage
   */
  public async formatTradingLeveragePrompt(action: 'long' | 'short', symbol: string, currentPrice: number, availableMargin: number, locale: string = 'en'): Promise<string> {
    const leveragePrompt = await i18nService.__('trading.leveragePrompt', locale, { action, symbol });
    const selectLeverage = await i18nService.__('trading.selectLeverage', locale);
    const availableMarginLabel = await i18nService.__('trading.availableMarginLabel', locale);
    const maxLeverageLabel = await i18nService.__('trading.maxLeverageLabel', locale);
    const currentPriceLabel = await i18nService.__('trading.currentPriceLabel', locale);
    
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `${actionEmoji} <b>${leveragePrompt}</b>\n`;
    message += `${currentPriceLabel} <b>${this.formatPrice(currentPrice, this.defaultOptions)}</b>\n\n`;
    
    message += `<b>${selectLeverage}</b>\n`;
    message += `${availableMarginLabel} <b>${this.formatPrice(availableMargin, this.defaultOptions)}</b>\n`;
    message += `${maxLeverageLabel} <b>3x</b>\n\n`;
    
    return message;
  }

  /**
   * Format trading guidance message - Enter amount
   */
  public async formatTradingAmountPrompt(action: 'long' | 'short', symbol: string, leverage: string, availableMargin: number, locale: string = 'en'): Promise<string> {
    const amountPrompt = await i18nService.__('trading.amountPrompt', locale, { action, symbol });
    const leverageSelected = await i18nService.__('trading.leverageSelected', locale, { leverage });
    const selectPositionSize = await i18nService.__('trading.selectPositionSize', locale);
    const availableMarginLabel = await i18nService.__('trading.availableMarginLabel', locale);
    const enterMarginAmount = await i18nService.__('trading.enterMarginAmount', locale, { action, symbol });
    const replyWithNumber = await i18nService.__('trading.replyWithNumber', locale);
    
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `${actionEmoji} <b>${amountPrompt}</b>\n`;
    message += `${leverageSelected}\n\n`;
    
    message += `<b>${selectPositionSize}</b>\n\n`;
    message += `${availableMarginLabel} <b>${this.formatPrice(availableMargin, this.defaultOptions)}</b>\n\n`;
    message += `${enterMarginAmount}\n\n`;
    message += `<i>${replyWithNumber}</i>`;
    
    return message;
  }

  /**
   * Format trading order preview
   */
  public async formatTradingOrderPreview(
    action: 'long' | 'short', 
    symbol: string, 
    leverage: string, 
    amount: string,
    currentPrice: number,
    orderSize: number,
    liquidationPrice: number,
    locale: string = 'en'
  ): Promise<string> {
    const orderPreview = await i18nService.__('trading.orderPreview', locale);
    const market = await i18nService.__('trading.market', locale);
    const leverageLabel = await i18nService.__('trading.leverage', locale);
    const orderSizeLabel = await i18nService.__('trading.orderSize', locale);
    const currentPriceLabel = await i18nService.__('trading.currentPriceLabel', locale);
    const liquidationPriceLabel = await i18nService.__('trading.liquidationPrice', locale);
    const confirmTrade = await i18nService.__('trading.confirmTrade', locale);
    
    const actionText = action === 'long' ? 'LONG' : 'SHORT';
    const actionEmoji = action === 'long' ? '📈' : '📉';
    const leverageNum = parseFloat(leverage.replace('x', ''));
    const positionValue = parseFloat(amount) * leverageNum;
    
    let message = `💰 <b>${orderPreview}</b>\n\n`;
    message += `${market} <b>${actionText} ${symbol}</b> ${actionEmoji}\n`;
    message += `${leverageLabel} <b>${leverage}</b>\n`;
    message += `${orderSizeLabel} <b>${orderSize.toFixed(6)} ${symbol} / $${this.formatCurrency(parseFloat(amount))}</b>\n`;
    message += `${currentPriceLabel} <b>$${this.formatCurrency(currentPrice)}</b>\n`;
    message += `${liquidationPriceLabel} <b>$${this.formatCurrency(liquidationPrice)}</b>\n\n`;
    message += `${confirmTrade}`;
    
    return message;
  }

  /**
   * Format trading insufficient funds error message
   */
  public async formatTradingInsufficientFundsMessage(locale: string = 'en'): Promise<string> {
    const insufficientBalance = await i18nService.__('trading.insufficientBalance', locale);
    const cannotTrade = await i18nService.__('trading.cannotTrade', locale);
    const solutions = await i18nService.__('trading.solutions', locale);
    const useWalletCheck = await i18nService.__('trading.useWalletCheck', locale);
    const depositFunds = await i18nService.__('trading.depositFunds', locale);
    const reduceAmount = await i18nService.__('trading.reduceAmount', locale);
    
    let message = `💰 <b>${insufficientBalance}</b>\n\n`;
    message += `${cannotTrade}\n\n`;
    message += `💡 <b>${solutions}</b>\n`;
    message += `${useWalletCheck}\n`;
    message += `${depositFunds}\n`;
    message += `${reduceAmount}`;
    
    return message;
  }

  /**
   * Format trading command format error message
   */
  public async formatTradingCommandErrorMessage(action: 'long' | 'short', locale: string = 'en'): Promise<string> {
    const commandError = await i18nService.__('trading.commandError', locale);
    const correctFormat = await i18nService.__('trading.correctFormat', locale);
    const commandTemplate = await i18nService.__('trading.commandTemplate', locale, { action });
    const examples = await i18nService.__('trading.examples', locale);
    const exampleFormat1 = await i18nService.__('trading.exampleFormat', locale, { action, token: 'BTC', leverage: '10x', amount: '100' });
    const exampleFormat2 = await i18nService.__('trading.exampleFormat', locale, { action, token: 'ETH', leverage: '5x', amount: '50' });
    const importantNotes = await i18nService.__('trading.importantNotes', locale);
    const minimumTrade = await i18nService.__('trading.minimumTrade', locale);
    const supportedLeverage = await i18nService.__('trading.supportedLeverage', locale);
    const supportedTokensNote = await i18nService.__('trading.supportedTokensNote', locale);
    const testSmallAmounts = await i18nService.__('trading.testSmallAmounts', locale);
    
    const actionLower = action.toLowerCase();
    
    let message = `❌ <b>${commandError}</b>\n\n`;
    message += `<b>${correctFormat}</b>\n`;
    message += `<code>${commandTemplate}</code>\n\n`;
    message += `<b>${examples}</b>\n`;
    message += `<code>/${actionLower} BTC 10x 100</code> - ${exampleFormat1}\n`;
    message += `<code>/${actionLower} ETH 5x 50</code> - ${exampleFormat2}\n\n`;
    message += `<b>${importantNotes}</b>\n`;
    message += `${minimumTrade}\n`;
    message += `${supportedLeverage}\n`;
    message += `${supportedTokensNote}\n\n`;
    message += `💡 ${testSmallAmounts}`;
    
    return message;
  }

  /**
   * Format trading processing message
   */
  public async formatTradingProcessingMessage(action: 'long' | 'short', symbol: string, leverage: string, amount: string, locale: string = 'en'): Promise<string> {
    const processing = await i18nService.__('trading.processing', locale, { action });
    const tokenLabel = await i18nService.__('trading.tokenLabel', locale);
    const leverageLabel = await i18nService.__('trading.leverageLabel', locale);
    const amountLabel = await i18nService.__('trading.amountLabel', locale);
    
    const actionEmoji = action === 'long' ? '📈' : '📉';
    
    let message = `🔄 <b>${processing}</b>\n\n`;
    message += `${actionEmoji} ${tokenLabel} <code>${symbol.toUpperCase()}</code>\n`;
    message += `📊 ${leverageLabel} <code>${leverage}</code>\n`;
    message += `💰 ${amountLabel} <code>${amount}</code>`;
    
    return message;
  }
}

// 导出单例实例
export const messageFormatter = new MessageFormatter();

// 默认导出
export default messageFormatter;