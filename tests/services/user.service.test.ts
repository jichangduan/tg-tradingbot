import { UserService } from '../../src/services/user.service';
import { apiService } from '../../src/services/api.service';
import { UserInitRequest, UserInitData, UserInitApiResponse, ApiErrorCode } from '../../src/types/api.types';

// Mock依赖
jest.mock('../../src/services/api.service');
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    logPerformance: jest.fn()
  }
}));

describe('UserService', () => {
  let userService: UserService;
  let mockApiService: jest.Mocked<typeof apiService>;

  beforeEach(() => {
    userService = new UserService();
    mockApiService = apiService as jest.Mocked<typeof apiService>;
    jest.clearAllMocks();
  });

  describe('initializeUser', () => {
    const validRequest: UserInitRequest = {
      telegram_id: '745628192',
      username: 'test_user',
      first_name: 'Test',
      last_name: 'User'
    };

    const mockApiResponse: UserInitApiResponse = {
      success: true,
      code: 200,
      message: 'User created successfully',
      data: {
        userId: 111923,
        walletAddress: '2WakqTUYaTHkWZHrYJZLmT9GSiT9s9TCoyHGuCy82RKZ',
        nickname: 'Test',
        profilePhotoUrl: 'https://static.aiw3.ai/avatars/6.png',
        referralCode: 'REFQ0KGB',
        energy: 100,
        isNewUser: true,
        accessToken: 'test_access_token_123'
      }
    };

    it('should successfully initialize a new user', async () => {
      mockApiService.post.mockResolvedValue(mockApiResponse);

      const result = await userService.initializeUser(validRequest);

      expect(mockApiService.post).toHaveBeenCalledWith(
        '/api/tgbot/user/init',
        validRequest,
        {
          timeout: 10000,
          retry: 2
        }
      );
      expect(result).toEqual(mockApiResponse.data);
    });

    it('should successfully initialize an existing user', async () => {
      const existingUserResponse = {
        ...mockApiResponse,
        message: 'User found successfully',
        data: {
          ...mockApiResponse.data,
          isNewUser: false,
          energy: 150
        }
      };

      mockApiService.post.mockResolvedValue(existingUserResponse);

      const result = await userService.initializeUser(validRequest);

      expect(result.isNewUser).toBe(false);
      expect(result.energy).toBe(150);
    });

    it('should handle user initialization with invitation code', async () => {
      const requestWithInvitation = {
        ...validRequest,
        invitation_code: 'ABC123'
      };

      mockApiService.post.mockResolvedValue(mockApiResponse);

      await userService.initializeUser(requestWithInvitation);

      expect(mockApiService.post).toHaveBeenCalledWith(
        '/api/tgbot/user/init',
        requestWithInvitation,
        expect.any(Object)
      );
    });

    describe('request validation', () => {
      it('should throw error when telegram_id is missing', async () => {
        const invalidRequest = { ...validRequest, telegram_id: '' };

        await expect(userService.initializeUser(invalidRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.INVALID_SYMBOL,
            message: 'Telegram用户ID不能为空'
          });
      });

      it('should throw error when telegram_id format is invalid', async () => {
        const invalidRequest = { ...validRequest, telegram_id: 'invalid_id' };

        await expect(userService.initializeUser(invalidRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.INVALID_SYMBOL,
            message: 'Telegram用户ID格式不正确'
          });
      });

      it('should throw error when username is too long', async () => {
        const invalidRequest = { 
          ...validRequest, 
          username: 'a'.repeat(33) // 超过32字符限制
        };

        await expect(userService.initializeUser(invalidRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.INVALID_SYMBOL,
            message: '用户名过长，最多32个字符'
          });
      });

      it('should throw error when first_name is too long', async () => {
        const invalidRequest = { 
          ...validRequest, 
          first_name: 'a'.repeat(65) // 超过64字符限制
        };

        await expect(userService.initializeUser(invalidRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.INVALID_SYMBOL,
            message: '名字过长，最多64个字符'
          });
      });

      it('should throw error when last_name is too long', async () => {
        const invalidRequest = { 
          ...validRequest, 
          last_name: 'a'.repeat(65) // 超过64字符限制
        };

        await expect(userService.initializeUser(invalidRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.INVALID_SYMBOL,
            message: '姓氏过长，最多64个字符'
          });
      });
    });

    describe('response validation', () => {
      it('should throw error when API response format is invalid', async () => {
        const invalidResponse = {
          code: 200,
          message: 'Success',
          data: {
            // 缺少必要字段
            userId: 123
          }
        };

        mockApiService.post.mockResolvedValue(invalidResponse);

        await expect(userService.initializeUser(validRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.DATA_UNAVAILABLE,
            message: 'API返回数据格式不正确'
          });
      });

      it('should handle missing data field in response', async () => {
        const invalidResponse = {
          code: 200,
          message: 'Success'
          // 缺少data字段
        };

        mockApiService.post.mockResolvedValue(invalidResponse);

        await expect(userService.initializeUser(validRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.DATA_UNAVAILABLE,
            message: 'API返回数据格式不正确'
          });
      });
    });

    describe('error handling', () => {
      it('should handle network errors', async () => {
        const networkError = new Error('Connection refused');
        (networkError as any).code = 'ECONNREFUSED';

        mockApiService.post.mockRejectedValue(networkError);

        await expect(userService.initializeUser(validRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.NETWORK_ERROR,
            message: '网络连接失败，请检查网络连接',
            retryable: true
          });
      });

      it('should handle timeout errors', async () => {
        const timeoutError = new Error('Request timeout');
        (timeoutError as any).code = 'ECONNABORTED';

        mockApiService.post.mockRejectedValue(timeoutError);

        await expect(userService.initializeUser(validRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.TIMEOUT_ERROR,
            message: '请求超时，请稍后重试',
            retryable: true
          });
      });

      it('should handle HTTP 400 errors', async () => {
        const badRequestError = {
          status: 400,
          message: 'Bad request',
          response: {
            data: {
              message: 'telegram_id is required'
            }
          }
        };

        mockApiService.post.mockRejectedValue(badRequestError);

        await expect(userService.initializeUser(validRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.INVALID_SYMBOL,
            message: '请求参数错误，请检查输入信息'
          });
      });

      it('should handle HTTP 401 errors', async () => {
        const unauthorizedError = {
          status: 401,
          message: 'Unauthorized'
        };

        mockApiService.post.mockRejectedValue(unauthorizedError);

        await expect(userService.initializeUser(validRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.UNAUTHORIZED,
            message: 'API认证失败，请联系管理员'
          });
      });

      it('should handle HTTP 429 errors (rate limiting)', async () => {
        const rateLimitError = {
          status: 429,
          message: 'Too many requests'
        };

        mockApiService.post.mockRejectedValue(rateLimitError);

        await expect(userService.initializeUser(validRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.RATE_LIMIT_EXCEEDED,
            message: '请求过于频繁，请稍后重试'
          });
      });

      it('should handle HTTP 500 server errors', async () => {
        const serverError = {
          status: 500,
          message: 'Internal server error'
        };

        mockApiService.post.mockRejectedValue(serverError);

        await expect(userService.initializeUser(validRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.SERVER_ERROR,
            message: '服务器内部错误，请稍后重试'
          });
      });

      it('should handle unknown errors', async () => {
        const unknownError = new Error('Unknown error occurred');

        mockApiService.post.mockRejectedValue(unknownError);

        await expect(userService.initializeUser(validRequest))
          .rejects
          .toMatchObject({
            code: ApiErrorCode.UNKNOWN_ERROR,
            message: '用户初始化失败，请稍后重试'
          });
      });
    });
  });

  describe('parseInvitationCode', () => {
    it('should parse valid invitation codes', () => {
      expect(userService.parseInvitationCode('invite_ABC123')).toBe('ABC123');
      expect(userService.parseInvitationCode('XYZ789')).toBe('XYZ789');
      expect(userService.parseInvitationCode('test123')).toBe('TEST123');
    });

    it('should return undefined for invalid invitation codes', () => {
      expect(userService.parseInvitationCode('short')).toBeUndefined(); // 太短(5字符)
      expect(userService.parseInvitationCode('toolongcode123')).toBeUndefined(); // 太长
      expect(userService.parseInvitationCode('inv@lid')).toBeUndefined(); // 包含特殊字符
      expect(userService.parseInvitationCode('')).toBeUndefined(); // 空字符串
      expect(userService.parseInvitationCode()).toBeUndefined(); // undefined参数
    });

    it('should handle edge cases', () => {
      expect(userService.parseInvitationCode('   ')).toBeUndefined(); // 只有空格
      expect(userService.parseInvitationCode('123456')).toBe('123456'); // 只有数字
      expect(userService.parseInvitationCode('ABCDEF')).toBe('ABCDEF'); // 只有字母
    });
  });

  describe('getUserPhotoUrl', () => {
    it('should return undefined (feature not implemented)', async () => {
      const result = await userService.getUserPhotoUrl('745628192');
      expect(result).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
      // 即使内部有错误，也应该返回undefined而不是抛出异常
      const result = await userService.getUserPhotoUrl('invalid_id');
      expect(result).toBeUndefined();
    });
  });

  describe('healthCheck', () => {
    it('should return true when API service is healthy', async () => {
      mockApiService.healthCheck.mockResolvedValue(true);

      const result = await userService.healthCheck();

      expect(result).toBe(true);
      expect(mockApiService.healthCheck).toHaveBeenCalled();
    });

    it('should return false when API service is unhealthy', async () => {
      mockApiService.healthCheck.mockResolvedValue(false);

      const result = await userService.healthCheck();

      expect(result).toBe(false);
    });

    it('should handle health check errors', async () => {
      mockApiService.healthCheck.mockRejectedValue(new Error('Health check failed'));

      const result = await userService.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return service statistics', () => {
      const stats = userService.getStats();

      expect(stats).toEqual({
        name: 'UserService',
        version: '1.0.0',
        supportedEndpoints: ['/api/tgbot/user/init'],
        features: [
          'User initialization',
          'Automatic wallet creation',
          'Invitation code support',
          'Comprehensive error handling'
        ]
      });
    });
  });
});