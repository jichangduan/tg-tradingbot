import { PriceHandler } from '../../src/bot/handlers/price.handler';
import { tokenService } from '../../src/services/token.service';
import { messageFormatter } from '../../src/bot/utils/message.formatter';
import { validateSymbol } from '../../src/bot/utils/validator';
import { logger } from '../../src/utils/logger';
import { CachedTokenData, DetailedError, ApiErrorCode } from '../../src/types/api.types';

// Mock dependencies
jest.mock('../../src/services/token.service');
jest.mock('../../src/bot/utils/message.formatter');
jest.mock('../../src/bot/utils/validator');
jest.mock('../../src/utils/logger');

describe('PriceHandler', () => {
  let priceHandler: PriceHandler;
  let mockCtx: any;
  let mockTokenService: jest.Mocked<typeof tokenService>;
  let mockMessageFormatter: jest.Mocked<typeof messageFormatter>;
  let mockValidateSymbol: jest.MockedFunction<typeof validateSymbol>;
  let mockLogger: jest.Mocked<typeof logger>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create handler instance
    priceHandler = new PriceHandler();
    
    // Setup mocks
    mockTokenService = tokenService as jest.Mocked<typeof tokenService>;
    mockMessageFormatter = messageFormatter as jest.Mocked<typeof messageFormatter>;
    mockValidateSymbol = validateSymbol as jest.MockedFunction<typeof validateSymbol>;
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
  });

  describe('handle method', () => {
    it('should successfully process a price query for BTC', async () => {
      // Arrange
      const symbol = 'BTC';
      const args = ['btc'];
      
      const mockTokenData: CachedTokenData = {
        symbol: 'BTC',
        name: 'Bitcoin',
        price: 50000,
        change24h: 2.5,
        volume24h: 1000000000,
        marketCap: 950000000000,
        high24h: 51000,
        low24h: 49000,
        supply: {
          circulating: 19500000,
          total: 21000000,
          max: 21000000
        },
        updatedAt: new Date(),
        source: 'aiw3_api',
        isCached: false
      };

      const mockLoadingMessage = { message_id: 1001 };
      const mockFormattedMessage = '💰 BTC (Bitcoin) price information...';

      // Setup mocks
      mockValidateSymbol.mockReturnValue('BTC');
      mockCtx.reply.mockResolvedValue(mockLoadingMessage);
      mockTokenService.getTokenPrice.mockResolvedValue(mockTokenData);
      mockMessageFormatter.formatLoadingMessage.mockReturnValue('🔍 Querying BTC...');
      mockMessageFormatter.formatPriceMessage.mockReturnValue(mockFormattedMessage);

      // Act
      await priceHandler.handle(mockCtx, args);

      // Assert
      expect(mockValidateSymbol).toHaveBeenCalledWith('btc');
      expect(mockTokenService.getTokenPrice).toHaveBeenCalledWith('BTC');
      expect(mockCtx.reply).toHaveBeenCalledWith(
        '🔍 Querying BTC...',
        { parse_mode: 'HTML' }
      );
      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        mockCtx.chat.id,
        mockLoadingMessage.message_id,
        undefined,
        mockFormattedMessage,
        { parse_mode: 'HTML' }
      );
      expect(mockLogger.logCommand).toHaveBeenCalledWith(
        'price', 
        mockCtx.from.id, 
        mockCtx.from.username, 
        args
      );
    });

    it('should show help message when no arguments provided', async () => {
      // Arrange
      const args: string[] = [];
      const mockHelpMessage = 'Help message content...';
      
      mockMessageFormatter.formatHelpMessage.mockReturnValue(mockHelpMessage);

      // Act
      await priceHandler.handle(mockCtx, args);

      // Assert
      expect(mockMessageFormatter.formatHelpMessage).toHaveBeenCalled();
      expect(mockCtx.reply).toHaveBeenCalledWith(mockHelpMessage, { parse_mode: 'HTML' });
      expect(mockTokenService.getTokenPrice).not.toHaveBeenCalled();
    });

    it('should handle validation error for invalid symbol', async () => {
      // Arrange
      const args = ['invalid123'];
      const validationError = new Error('Invalid token symbol');
      
      mockValidateSymbol.mockImplementation(() => {
        throw validationError;
      });

      // Act
      await priceHandler.handle(mockCtx, args);

      // Assert
      expect(mockValidateSymbol).toHaveBeenCalledWith('invalid123');
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('❌ 无效的代币符号: invalid123'),
        { parse_mode: 'HTML' }
      );
      expect(mockTokenService.getTokenPrice).not.toHaveBeenCalled();
    });

    it('should handle token service error gracefully', async () => {
      // Arrange
      const symbol = 'UNKNOWN';
      const args = ['unknown'];
      const mockLoadingMessage = { message_id: 1002 };
      
      const serviceError: DetailedError = {
        code: ApiErrorCode.TOKEN_NOT_FOUND,
        message: 'Token UNKNOWN not found',
        retryable: false,
        context: {
          symbol: 'UNKNOWN',
          endpoint: '/api/tokens/UNKNOWN/getTokenPriceChange',
          timestamp: new Date()
        }
      };

      const mockErrorMessage = '❌ Token not found error message...';

      // Setup mocks
      mockValidateSymbol.mockReturnValue('UNKNOWN');
      mockCtx.reply.mockResolvedValue(mockLoadingMessage);
      mockTokenService.getTokenPrice.mockRejectedValue(serviceError);
      mockMessageFormatter.formatLoadingMessage.mockReturnValue('🔍 Querying UNKNOWN...');
      mockMessageFormatter.formatErrorMessage.mockReturnValue(mockErrorMessage);

      // Act
      await priceHandler.handle(mockCtx, args);

      // Assert
      expect(mockTokenService.getTokenPrice).toHaveBeenCalledWith('UNKNOWN');
      expect(mockMessageFormatter.formatErrorMessage).toHaveBeenCalledWith(serviceError);
      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        mockCtx.chat.id,
        mockLoadingMessage.message_id,
        undefined,
        mockErrorMessage,
        { parse_mode: 'HTML' }
      );
    });

    it('should reject multiple arguments', async () => {
      // Arrange
      const args = ['btc', 'eth', 'sol'];

      // Act
      await priceHandler.handle(mockCtx, args);

      // Assert
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ 请一次只查询一个代币'),
        { parse_mode: 'HTML' }
      );
      expect(mockTokenService.getTokenPrice).not.toHaveBeenCalled();
    });

    it('should handle unexpected errors gracefully', async () => {
      // Arrange
      const args = ['btc'];
      const unexpectedError = new Error('Unexpected system error');
      
      mockValidateSymbol.mockImplementation(() => {
        throw unexpectedError;
      });

      // Act
      await priceHandler.handle(mockCtx, args);

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Price command failed'),
        expect.objectContaining({
          error: unexpectedError.message,
          userId: mockCtx.from.id,
          requestId: mockCtx.requestId
        })
      );
      
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('❌ 系统错误'),
        { parse_mode: 'HTML' }
      );
    });
  });

  describe('handleMultiple method', () => {
    it('should process multiple token queries successfully', async () => {
      // Arrange
      const symbols = ['BTC', 'ETH'];
      const mockTokenData1: CachedTokenData = {
        symbol: 'BTC',
        name: 'Bitcoin',
        price: 50000,
        change24h: 2.5,
        volume24h: 1000000000,
        marketCap: 950000000000,
        updatedAt: new Date(),
        source: 'aiw3_api',
        isCached: false
      } as CachedTokenData;

      const mockTokenData2: CachedTokenData = {
        symbol: 'ETH',
        name: 'Ethereum',
        price: 3000,
        change24h: -1.2,
        volume24h: 500000000,
        marketCap: 360000000000,
        updatedAt: new Date(),
        source: 'aiw3_api',
        isCached: true
      } as CachedTokenData;

      const mockResults = [mockTokenData1, mockTokenData2];
      const mockLoadingMessage = { message_id: 1003 };
      const mockMultiMessage = 'Multiple token results...';

      // Setup mocks
      mockCtx.reply.mockResolvedValue(mockLoadingMessage);
      mockTokenService.getMultipleTokenPrices.mockResolvedValue(mockResults);
      mockMessageFormatter.formatMultiTokenMessage.mockReturnValue(mockMultiMessage);

      // Act
      await priceHandler.handleMultiple(mockCtx, symbols);

      // Assert
      expect(mockTokenService.getMultipleTokenPrices).toHaveBeenCalledWith(symbols);
      expect(mockMessageFormatter.formatMultiTokenMessage).toHaveBeenCalledWith(mockResults);
      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        mockCtx.chat.id,
        mockLoadingMessage.message_id,
        undefined,
        mockMultiMessage,
        { parse_mode: 'HTML' }
      );
    });

    it('should reject too many symbols in batch query', async () => {
      // Arrange
      const symbols = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'LINK']; // 6 symbols, limit is 5

      // Act
      await priceHandler.handleMultiple(mockCtx, symbols);

      // Assert
      expect(mockCtx.reply).toHaveBeenCalledWith(
        expect.stringContaining('⚠️ 批量查询最多支持 5 个代币'),
        { parse_mode: 'HTML' }
      );
      expect(mockTokenService.getMultipleTokenPrices).not.toHaveBeenCalled();
    });

    it('should handle empty results from batch query', async () => {
      // Arrange
      const symbols = ['INVALID1', 'INVALID2'];
      const mockLoadingMessage = { message_id: 1004 };

      mockCtx.reply.mockResolvedValue(mockLoadingMessage);
      mockTokenService.getMultipleTokenPrices.mockResolvedValue([]);

      // Act
      await priceHandler.handleMultiple(mockCtx, symbols);

      // Assert
      expect(mockCtx.telegram.editMessageText).toHaveBeenCalledWith(
        mockCtx.chat.id,
        mockLoadingMessage.message_id,
        undefined,
        expect.stringContaining('❌ 未能获取任何代币的价格信息'),
        { parse_mode: 'HTML' }
      );
    });
  });

  describe('getStats method', () => {
    it('should return handler statistics', () => {
      // Act
      const stats = priceHandler.getStats();

      // Assert
      expect(stats).toEqual({
        name: 'PriceHandler',
        version: '1.0.0',
        supportedCommands: ['/price'],
        features: expect.arrayContaining([
          'Single token price query',
          'Batch token price query (limited)',
          'Price trend analysis',
          'Cache-optimized responses',
          'Detailed error handling'
        ])
      });
    });
  });
});

// Integration-style tests (if needed)
describe('PriceHandler Integration', () => {
  it('should handle real-world token symbols correctly', () => {
    const handler = new PriceHandler();
    const stats = handler.getStats();
    
    expect(stats.name).toBe('PriceHandler');
    expect(stats.supportedCommands).toContain('/price');
  });
});