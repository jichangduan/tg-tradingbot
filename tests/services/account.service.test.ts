import { AccountService } from '../../src/services/account.service';
import { apiService } from '../../src/services/api.service';
import { logger } from '../../src/utils/logger';
import { 
  AccountBalanceApiResponse, 
  AccountBalanceData,
  FormattedAccountBalance,
  DetailedError,
  ApiErrorCode 
} from '../../src/types/api.types';

// Mock dependencies
jest.mock('../../src/services/api.service');
jest.mock('../../src/utils/logger');

describe('AccountService', () => {
  let accountService: AccountService;
  let mockApiService: jest.Mocked<typeof apiService>;
  let mockLogger: jest.Mocked<typeof logger>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create service instance
    accountService = new AccountService();
    
    // Setup mocks
    mockApiService = apiService as jest.Mocked<typeof apiService>;
    mockLogger = logger as jest.Mocked<typeof logger>;
  });

  describe('getAccountBalance', () => {
    const validTelegramId = '123456789';
    const mockApiResponse: AccountBalanceApiResponse = {
      code: '0',
      message: 'success',
      data: [{
        uTime: '1640995200000',
        totalEq: '1500.00',
        isoEq: '0.00',
        adjEq: '1500.00',
        availEq: '1200.00',
        ordFroz: '300.00',
        imr: '150.00',
        mmr: '75.00',
        mgnRatio: '10.0',
        notionalUsd: '1500.00'
      }],
      success: true,
      timestamp: new Date().toISOString()
    };

    it('should successfully get account balance', async () => {
      // Arrange
      mockApiService.get.mockResolvedValue(mockApiResponse);

      // Act
      const result = await accountService.getAccountBalance(validTelegramId);

      // Assert
      expect(mockApiService.get).toHaveBeenCalledWith(
        '/api/v5/account/balance',
        { telegram_id: validTelegramId },
        {
          timeout: 8000,
          retry: 2
        }
      );

      const expected: FormattedAccountBalance = {
        totalEquity: 1500,
        availableEquity: 1200,
        orderFrozen: 300,
        adjustedEquity: 1500,
        utilizationRate: 20, // (1500 - 1200) / 1500 * 100 = 20%
        lastUpdated: new Date(1640995200000),
        currency: 'USDT'
      };

      expect(result).toEqual(expected);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Account balance query started'),
        expect.any(Object)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Account balance query successful'),
        expect.any(Object)
      );
    });

    it('should handle invalid telegram ID', async () => {
      // Arrange
      const invalidId = '';

      // Act & Assert
      await expect(accountService.getAccountBalance(invalidId)).rejects.toMatchObject({
        code: ApiErrorCode.INVALID_SYMBOL,
        message: 'Telegram用户ID不能为空',
        retryable: true
      });

      expect(mockApiService.get).not.toHaveBeenCalled();
    });

    it('should handle non-numeric telegram ID', async () => {
      // Arrange
      const invalidId = 'abc123';

      // Act & Assert
      await expect(accountService.getAccountBalance(invalidId)).rejects.toMatchObject({
        code: ApiErrorCode.INVALID_SYMBOL,
        message: 'Telegram用户ID格式不正确',
        retryable: true
      });

      expect(mockApiService.get).not.toHaveBeenCalled();
    });

    it('should handle invalid API response format', async () => {
      // Arrange
      const invalidResponse = { code: 'error', message: 'failed' };
      mockApiService.get.mockResolvedValue(invalidResponse);

      // Act & Assert
      await expect(accountService.getAccountBalance(validTelegramId)).rejects.toMatchObject({
        code: ApiErrorCode.DATA_UNAVAILABLE,
        message: '余额数据格式不正确',
        retryable: true
      });
    });

    it('should handle empty balance data', async () => {
      // Arrange
      const emptyResponse = { ...mockApiResponse, data: [] };
      mockApiService.get.mockResolvedValue(emptyResponse);

      // Act & Assert
      await expect(accountService.getAccountBalance(validTelegramId)).rejects.toMatchObject({
        code: ApiErrorCode.TOKEN_NOT_FOUND,
        message: '未找到账户余额数据，请先完成交易账户初始化',
        retryable: true
      });
    });

    it('should handle network errors', async () => {
      // Arrange
      const networkError = { code: 'ECONNREFUSED', message: 'Connection refused' };
      mockApiService.get.mockRejectedValue(networkError);

      // Act & Assert
      await expect(accountService.getAccountBalance(validTelegramId)).rejects.toMatchObject({
        code: ApiErrorCode.NETWORK_ERROR,
        message: '网络连接失败，请检查网络连接',
        retryable: true
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Account balance query failed'),
        expect.any(Object)
      );
    });

    it('should handle timeout errors', async () => {
      // Arrange
      const timeoutError = { code: 'ECONNABORTED', message: 'timeout of 8000ms exceeded' };
      mockApiService.get.mockRejectedValue(timeoutError);

      // Act & Assert
      await expect(accountService.getAccountBalance(validTelegramId)).rejects.toMatchObject({
        code: ApiErrorCode.TIMEOUT_ERROR,
        message: '请求超时，请稍后重试',
        retryable: true
      });
    });

    it('should handle HTTP 404 errors', async () => {
      // Arrange
      const notFoundError = { status: 404, message: 'User not found' };
      mockApiService.get.mockRejectedValue(notFoundError);

      // Act & Assert
      await expect(accountService.getAccountBalance(validTelegramId)).rejects.toMatchObject({
        code: ApiErrorCode.TOKEN_NOT_FOUND,
        message: '未找到账户信息，请先完成交易账户初始化',
        retryable: true
      });
    });

    it('should handle HTTP 429 rate limit errors', async () => {
      // Arrange
      const rateLimitError = { status: 429, message: 'Too many requests' };
      mockApiService.get.mockRejectedValue(rateLimitError);

      // Act & Assert
      await expect(accountService.getAccountBalance(validTelegramId)).rejects.toMatchObject({
        code: ApiErrorCode.RATE_LIMIT_EXCEEDED,
        message: '请求过于频繁，请稍后重试',
        retryable: true
      });
    });

    it('should calculate utilization rate correctly', async () => {
      // Arrange
      const testCases = [
        { totalEq: '1000.00', availEq: '800.00', expectedRate: 20 },
        { totalEq: '0.00', availEq: '0.00', expectedRate: 0 },
        { totalEq: '500.00', availEq: '0.00', expectedRate: 100 },
        { totalEq: '100.00', availEq: '100.00', expectedRate: 0 },
        { totalEq: '1000.00', availEq: '750.00', expectedRate: 25 }
      ];

      for (const testCase of testCases) {
        const response = {
          ...mockApiResponse,
          data: [{
            ...mockApiResponse.data[0],
            totalEq: testCase.totalEq,
            availEq: testCase.availEq
          }]
        };
        mockApiService.get.mockResolvedValue(response);

        // Act
        const result = await accountService.getAccountBalance(validTelegramId);

        // Assert
        expect(result.utilizationRate).toBe(testCase.expectedRate);
      }
    });
  });

  describe('checkSufficientBalance', () => {
    it('should return true when balance is sufficient', async () => {
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

      const getBalanceSpy = jest.spyOn(accountService, 'getAccountBalance');
      getBalanceSpy.mockResolvedValue(mockBalance);

      // Act
      const result = await accountService.checkSufficientBalance('123456789', 500);

      // Assert
      expect(result).toBe(true);
      expect(getBalanceSpy).toHaveBeenCalledWith('123456789');
    });

    it('should return false when balance is insufficient', async () => {
      // Arrange
      const mockBalance: FormattedAccountBalance = {
        totalEquity: 1000,
        availableEquity: 300,
        orderFrozen: 700,
        adjustedEquity: 1000,
        utilizationRate: 70,
        lastUpdated: new Date(),
        currency: 'USDT'
      };

      const getBalanceSpy = jest.spyOn(accountService, 'getAccountBalance');
      getBalanceSpy.mockResolvedValue(mockBalance);

      // Act
      const result = await accountService.checkSufficientBalance('123456789', 500);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when balance check fails', async () => {
      // Arrange
      const getBalanceSpy = jest.spyOn(accountService, 'getAccountBalance');
      getBalanceSpy.mockRejectedValue(new Error('API Error'));

      // Act
      const result = await accountService.checkSufficientBalance('123456789', 500);

      // Assert
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to check balance for trading',
        expect.any(Object)
      );
    });
  });

  describe('getBalanceWarnings', () => {
    it('should return low balance warning', () => {
      // Arrange
      const lowBalanceData: FormattedAccountBalance = {
        totalEquity: 50,
        availableEquity: 50,
        orderFrozen: 0,
        adjustedEquity: 50,
        utilizationRate: 0,
        lastUpdated: new Date(),
        currency: 'USDT'
      };

      // Act
      const warnings = accountService.getBalanceWarnings(lowBalanceData);

      // Assert
      expect(warnings).toContain('⚠️ 可用余额不足$100，建议充值后进行交易');
    });

    it('should return high utilization warning', () => {
      // Arrange
      const highUtilizationData: FormattedAccountBalance = {
        totalEquity: 1000,
        availableEquity: 100,
        orderFrozen: 900,
        adjustedEquity: 1000,
        utilizationRate: 90,
        lastUpdated: new Date(),
        currency: 'USDT'
      };

      // Act
      const warnings = accountService.getBalanceWarnings(highUtilizationData);

      // Assert
      expect(warnings).toContain('🔴 资金使用率过高，请注意强平风险');
    });

    it('should return medium utilization warning', () => {
      // Arrange
      const mediumUtilizationData: FormattedAccountBalance = {
        totalEquity: 1000,
        availableEquity: 300,
        orderFrozen: 700,
        adjustedEquity: 1000,
        utilizationRate: 70,
        lastUpdated: new Date(),
        currency: 'USDT'
      };

      // Act
      const warnings = accountService.getBalanceWarnings(mediumUtilizationData);

      // Assert
      expect(warnings).toContain('🟡 资金使用率偏高，建议适当减仓');
    });

    it('should return frozen funds warning', () => {
      // Arrange
      const highFrozenData: FormattedAccountBalance = {
        totalEquity: 1000,
        availableEquity: 100,
        orderFrozen: 500,
        adjustedEquity: 1000,
        utilizationRate: 90,
        lastUpdated: new Date(),
        currency: 'USDT'
      };

      // Act
      const warnings = accountService.getBalanceWarnings(highFrozenData);

      // Assert
      expect(warnings).toContain('🔒 大量资金被订单冻结，考虑取消部分挂单');
    });

    it('should return multiple warnings when applicable', () => {
      // Arrange
      const problematicData: FormattedAccountBalance = {
        totalEquity: 50,
        availableEquity: 10,
        orderFrozen: 40,
        adjustedEquity: 50,
        utilizationRate: 80,
        lastUpdated: new Date(),
        currency: 'USDT'
      };

      // Act
      const warnings = accountService.getBalanceWarnings(problematicData);

      // Assert
      expect(warnings.length).toBeGreaterThan(1);
      expect(warnings.some(w => w.includes('可用余额不足'))).toBe(true);
      expect(warnings.some(w => w.includes('资金使用率过高'))).toBe(true);
    });

    it('should return no warnings for healthy balance', () => {
      // Arrange
      const healthyData: FormattedAccountBalance = {
        totalEquity: 5000,
        availableEquity: 4000,
        orderFrozen: 1000,
        adjustedEquity: 5000,
        utilizationRate: 20,
        lastUpdated: new Date(),
        currency: 'USDT'
      };

      // Act
      const warnings = accountService.getBalanceWarnings(healthyData);

      // Assert
      expect(warnings).toEqual([]);
    });
  });

  describe('healthCheck', () => {
    it('should return true when API service is healthy', async () => {
      // Arrange
      mockApiService.healthCheck.mockResolvedValue(true);

      // Act
      const result = await accountService.healthCheck();

      // Assert
      expect(result).toBe(true);
      expect(mockApiService.healthCheck).toHaveBeenCalledTimes(1);
    });

    it('should return false when API service is unhealthy', async () => {
      // Arrange
      mockApiService.healthCheck.mockResolvedValue(false);

      // Act
      const result = await accountService.healthCheck();

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when API service throws error', async () => {
      // Arrange
      mockApiService.healthCheck.mockRejectedValue(new Error('Service unavailable'));

      // Act
      const result = await accountService.healthCheck();

      // Assert
      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Account service health check failed',
        { error: 'Service unavailable' }
      );
    });
  });

  describe('getStats', () => {
    it('should return service statistics', () => {
      // Act
      const stats = accountService.getStats();

      // Assert
      expect(stats).toEqual({
        name: 'AccountService',
        version: '1.0.0',
        supportedEndpoints: ['/api/v5/account/balance'],
        features: [
          'Account balance query',
          'Balance validation',
          'Risk warnings',
          'Comprehensive error handling'
        ]
      });
    });
  });
});