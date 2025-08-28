import { WalletHandler } from '../../src/bot/handlers/wallet.handler';
import { accountService } from '../../src/services/account.service';
import { messageFormatter } from '../../src/bot/utils/message.formatter';
import { logger } from '../../src/utils/logger';
import { FormattedAccountBalance, DetailedError, ApiErrorCode } from '../../src/types/api.types';

// Mock dependencies
jest.mock('../../src/services/account.service');
jest.mock('../../src/bot/utils/message.formatter');
jest.mock('../../src/utils/logger');

describe('WalletHandler', () => {
  let walletHandler: WalletHandler;
  let mockCtx: any;
  let mockAccountService: jest.Mocked<typeof accountService>;
  let mockMessageFormatter: jest.Mocked<typeof messageFormatter>;
  let mockLogger: jest.Mocked<typeof logger>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create handler instance
    walletHandler = new WalletHandler();
    
    // Setup mocks
    mockAccountService = accountService as jest.Mocked<typeof accountService>;
    mockMessageFormatter = messageFormatter as jest.Mocked<typeof messageFormatter>;
    mockLogger = logger as jest.Mocked<typeof logger>;

    // Setup context mock
    mockCtx = {
      from: {
        id: 123456789,
        username: 'testuser',
        first_name: 'Test'
      },
      chat: {
        id: 987654321
      },
      reply: jest.fn(),
      telegram: {
        editMessageText: jest.fn()
      },
      requestId: 'test_req_123'
    };

    // Mock reply to return a message object
    mockCtx.reply.mockResolvedValue({
      message_id: 999,
      date: Date.now() / 1000,
      chat: mockCtx.chat
    });
  });

  describe('handle', () => {
    it('should successfully handle wallet command and display balance', async () => {
      // Arrange
      const mockBalance: FormattedAccountBalance = {
        totalEquity: 1000,
        availableEquity: 800,
        orderFrozen: 200,
        adjustedEquity: 1000,
        utilizationRate: 20,
        lastUpdated: new Date(),
        currency: 'USDT'
      };

      const mockWarnings = ['⚠️ 可用余额不足$100，建议充值后进行交易'];
      const mockLoadingMessage = '🔍 正在查询钱包余额...';
      const mockBalanceMessage = '💰 钱包余额信息...';

      mockMessageFormatter.formatWalletLoadingMessage.mockReturnValue(mockLoadingMessage);
      mockMessageFormatter.formatWalletBalanceMessage.mockReturnValue(mockBalanceMessage);
      mockAccountService.getAccountBalance.mockResolvedValue(mockBalance);
      mockAccountService.getBalanceWarnings.mockReturnValue(mockWarnings);

      // Act
      await walletHandler.handle(mockCtx, []);

      // Assert
      expect(mockMessageFormatter.formatWalletLoadingMessage).toHaveBeenCalledTimes(1);
      expect(mockCtx.reply).toHaveBeenCalledWith(mockLoadingMessage, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      
      expect(mockAccountService.getAccountBalance).toHaveBeenCalledWith('123456789');
      expect(mockAccountService.getBalanceWarnings).toHaveBeenCalledWith(mockBalance);
      expect(mockMessageFormatter.formatWalletBalanceMessage).toHaveBeenCalledWith(mockBalance, mockWarnings);
      
      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        987654321,
        999,
        undefined,
        mockBalanceMessage,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Wallet command started'),
        expect.any(Object)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Wallet command completed successfully'),
        expect.any(Object)
      );
    });

    it('should handle missing telegram ID error', async () => {
      // Arrange
      const mockCtxNoId = { ...mockCtx, from: { ...mockCtx.from, id: undefined } };
      const mockErrorMessage = '❌ 钱包余额查询失败';

      mockMessageFormatter.formatWalletLoadingMessage.mockReturnValue('加载中...');
      mockMessageFormatter.formatWalletErrorMessage.mockReturnValue(mockErrorMessage);

      // Act
      await walletHandler.handle(mockCtxNoId, []);

      // Assert
      expect(mockAccountService.getAccountBalance).not.toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(mockErrorMessage, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    });

    it('should handle account service errors', async () => {
      // Arrange
      const mockError: DetailedError = {
        code: ApiErrorCode.TOKEN_NOT_FOUND,
        message: '未找到账户信息',
        retryable: true,
        context: {
          endpoint: '/api/v5/account/balance',
          timestamp: new Date()
        }
      };

      const mockLoadingMessage = '🔍 正在查询钱包余额...';
      const mockErrorMessage = '❌ 钱包余额查询失败 - 未找到账户信息';

      mockMessageFormatter.formatWalletLoadingMessage.mockReturnValue(mockLoadingMessage);
      mockMessageFormatter.formatWalletErrorMessage.mockReturnValue(mockErrorMessage);
      mockAccountService.getAccountBalance.mockRejectedValue(mockError);

      // Act
      await walletHandler.handle(mockCtx, []);

      // Assert
      expect(mockCtx.reply).toHaveBeenCalledWith(mockLoadingMessage, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      
      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        987654321,
        999,
        undefined,
        mockErrorMessage,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }
      );

      expect(mockMessageFormatter.formatWalletErrorMessage).toHaveBeenCalledWith(mockError);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Wallet command failed'),
        expect.any(Object)
      );
    });

    it('should handle network timeout errors', async () => {
      // Arrange
      const networkError = new Error('Request timeout');
      const mockLoadingMessage = '🔍 正在查询钱包余额...';
      const mockErrorMessage = '❌ 网络超时，请稍后重试';

      mockMessageFormatter.formatWalletLoadingMessage.mockReturnValue(mockLoadingMessage);
      mockMessageFormatter.formatWalletErrorMessage.mockReturnValue(mockErrorMessage);
      mockAccountService.getAccountBalance.mockRejectedValue(networkError);

      // Act
      await walletHandler.handle(mockCtx, []);

      // Assert
      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        987654321,
        999,
        undefined,
        mockErrorMessage,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        }
      );
    });

    it('should handle telegram API failures gracefully', async () => {
      // Arrange
      const telegramError = new Error('Bad Request: message is not modified');
      mockCtx.telegram.editMessageText.mockRejectedValue(telegramError);
      mockCtx.reply.mockRejectedValue(telegramError);

      const mockBalance: FormattedAccountBalance = {
        totalEquity: 1000,
        availableEquity: 800,
        orderFrozen: 200,
        adjustedEquity: 1000,
        utilizationRate: 20,
        lastUpdated: new Date(),
        currency: 'USDT'
      };

      mockMessageFormatter.formatWalletLoadingMessage.mockReturnValue('加载中...');
      mockMessageFormatter.formatWalletBalanceMessage.mockReturnValue('余额信息');
      mockAccountService.getAccountBalance.mockResolvedValue(mockBalance);
      mockAccountService.getBalanceWarnings.mockReturnValue([]);

      // Act
      await walletHandler.handle(mockCtx, []);

      // Assert - Should not throw error, but log the failure
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Wallet handler error'),
        expect.any(Object)
      );
    });

    it('should log performance metrics for successful requests', async () => {
      // Arrange
      const mockBalance: FormattedAccountBalance = {
        totalEquity: 1500,
        availableEquity: 1200,
        orderFrozen: 300,
        adjustedEquity: 1500,
        utilizationRate: 20,
        lastUpdated: new Date(),
        currency: 'USDT'
      };

      mockMessageFormatter.formatWalletLoadingMessage.mockReturnValue('加载中...');
      mockMessageFormatter.formatWalletBalanceMessage.mockReturnValue('余额信息');
      mockAccountService.getAccountBalance.mockResolvedValue(mockBalance);
      mockAccountService.getBalanceWarnings.mockReturnValue([]);

      // Act
      await walletHandler.handle(mockCtx, []);

      // Assert
      expect(mockLogger.logPerformance).toHaveBeenCalledWith(
        'wallet_success',
        expect.any(Number),
        expect.objectContaining({
          telegramId: '123456789',
          requestId: expect.any(String)
        })
      );
    });

    it('should include warnings in successful response', async () => {
      // Arrange
      const mockBalance: FormattedAccountBalance = {
        totalEquity: 50,
        availableEquity: 40,
        orderFrozen: 10,
        adjustedEquity: 50,
        utilizationRate: 90,
        lastUpdated: new Date(),
        currency: 'USDT'
      };

      const mockWarnings = [
        '⚠️ 可用余额不足$100，建议充值后进行交易',
        '🔴 资金使用率过高，请注意强平风险'
      ];

      mockMessageFormatter.formatWalletLoadingMessage.mockReturnValue('加载中...');
      mockMessageFormatter.formatWalletBalanceMessage.mockReturnValue('余额信息含警告');
      mockAccountService.getAccountBalance.mockResolvedValue(mockBalance);
      mockAccountService.getBalanceWarnings.mockReturnValue(mockWarnings);

      // Act
      await walletHandler.handle(mockCtx, []);

      // Assert
      expect(mockAccountService.getBalanceWarnings).toHaveBeenCalledWith(mockBalance);
      expect(mockMessageFormatter.formatWalletBalanceMessage).toHaveBeenCalledWith(mockBalance, mockWarnings);
      
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Wallet command completed successfully'),
        expect.objectContaining({
          warningCount: 2
        })
      );
    });
  });

  describe('getUsage', () => {
    it('should return wallet command usage instructions', () => {
      // Act
      const usage = walletHandler.getUsage();

      // Assert
      expect(usage).toContain('/wallet');
      expect(usage).toContain('钱包余额');
      expect(usage).toContain('使用方法');
      expect(usage).toContain('显示信息包括');
      expect(usage).toContain('注意事项');
    });
  });

  describe('getStats', () => {
    it('should return handler statistics', () => {
      // Act
      const stats = walletHandler.getStats();

      // Assert
      expect(stats).toEqual({
        name: 'WalletHandler',
        command: '/wallet',
        version: '1.0.0',
        features: [
          'Account balance query',
          'Risk warnings',
          'Real-time balance updates',
          'Comprehensive error handling',
          'Performance logging'
        ],
        supportedArgs: [],
        requiresAuth: true
      });
    });
  });

  describe('healthCheck', () => {
    it('should return true when account service is healthy', async () => {
      // Arrange
      mockAccountService.healthCheck.mockResolvedValue(true);

      // Act
      const isHealthy = await walletHandler.healthCheck();

      // Assert
      expect(isHealthy).toBe(true);
      expect(mockAccountService.healthCheck).toHaveBeenCalledTimes(1);
    });

    it('should return false when account service is unhealthy', async () => {
      // Arrange
      mockAccountService.healthCheck.mockResolvedValue(false);

      // Act
      const isHealthy = await walletHandler.healthCheck();

      // Assert
      expect(isHealthy).toBe(false);
      expect(mockAccountService.healthCheck).toHaveBeenCalledTimes(1);
    });

    it('should return false when account service throws error', async () => {
      // Arrange
      mockAccountService.healthCheck.mockRejectedValue(new Error('Service unavailable'));

      // Act
      const isHealthy = await walletHandler.healthCheck();

      // Assert
      expect(isHealthy).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'WalletHandler health check failed',
        { error: 'Service unavailable' }
      );
    });
  });
});