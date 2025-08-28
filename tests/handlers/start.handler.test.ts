import { StartHandler } from '../../src/bot/handlers/start.handler';
import { userService } from '../../src/services/user.service';
import { messageFormatter } from '../../src/bot/utils/message.formatter';
import { ExtendedContext } from '../../src/bot';
import { UserInitData, UserInitRequest } from '../../src/types/api.types';

// Mock依赖
jest.mock('../../src/services/user.service');
jest.mock('../../src/bot/utils/message.formatter');
jest.mock('../../src/utils/logger', () => ({
  logger: {
    logCommand: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('StartHandler', () => {
  let startHandler: StartHandler;
  let mockUserService: jest.Mocked<typeof userService>;
  let mockMessageFormatter: jest.Mocked<typeof messageFormatter>;
  let mockContext: jest.Mocked<ExtendedContext>;

  beforeEach(() => {
    startHandler = new StartHandler();
    mockUserService = userService as jest.Mocked<typeof userService>;
    mockMessageFormatter = messageFormatter as jest.Mocked<typeof messageFormatter>;
    
    // 设置默认的Context mock
    mockContext = {
      from: {
        id: 745628192,
        username: 'test_user',
        first_name: 'Test',
        last_name: 'User'
      },
      requestId: 'test_request_123',
      reply: jest.fn().mockResolvedValue({ message_id: 1 }),
      chat: { id: 123456789 }
    } as any;

    // 重置所有mock
    jest.clearAllMocks();
  });

  describe('handle', () => {
    it('should handle successful new user initialization', async () => {
      // 设置测试数据
      const mockUserData: UserInitData = {
        userId: 111923,
        walletAddress: '2WakqTUYaTHkWZHrYJZLmT9GSiT9s9TCoyHGuCy82RKZ',
        nickname: 'Test',
        profilePhotoUrl: 'https://static.aiw3.ai/avatars/6.png',
        referralCode: 'REFQ0KGB',
        energy: 100,
        isNewUser: true
      };

      mockUserService.initializeUser.mockResolvedValue(mockUserData);
      mockMessageFormatter.formatUserInitSuccessMessage.mockReturnValue('Success message');

      // 执行测试
      await startHandler.handle(mockContext, []);

      // 验证结果
      expect(mockContext.reply).toHaveBeenCalledTimes(2); // 欢迎消息 + 初始化成功消息
      expect(mockUserService.initializeUser).toHaveBeenCalledWith({
        telegram_id: '745628192',
        username: 'test_user',
        first_name: 'Test',
        last_name: 'User',
        invitation_code: undefined
      });
      expect(mockMessageFormatter.formatUserInitSuccessMessage).toHaveBeenCalledWith(mockUserData);
    });

    it('should handle successful existing user initialization', async () => {
      // 设置测试数据 - 现有用户
      const mockUserData: UserInitData = {
        userId: 111923,
        walletAddress: '2WakqTUYaTHkWZHrYJZLmT9GSiT9s9TCoyHGuCy82RKZ',
        nickname: 'Test',
        profilePhotoUrl: 'https://static.aiw3.ai/avatars/6.png',
        referralCode: 'REFQ0KGB',
        energy: 150,
        isNewUser: false
      };

      mockUserService.initializeUser.mockResolvedValue(mockUserData);
      mockMessageFormatter.formatUserInitSuccessMessage.mockReturnValue('Welcome back message');

      // 执行测试
      await startHandler.handle(mockContext, []);

      // 验证结果
      expect(mockContext.reply).toHaveBeenCalledTimes(2);
      expect(mockUserService.initializeUser).toHaveBeenCalledWith({
        telegram_id: '745628192',
        username: 'test_user',
        first_name: 'Test',
        last_name: 'User',
        invitation_code: undefined
      });
      expect(mockMessageFormatter.formatUserInitSuccessMessage).toHaveBeenCalledWith(mockUserData);
    });

    it('should handle user initialization with invitation code', async () => {
      const mockUserData: UserInitData = {
        userId: 111924,
        walletAddress: '3XakqTUYaTHkWZHrYJZLmT9GSiT9s9TCoyHGuCy82RKZ',
        nickname: 'Test',
        profilePhotoUrl: 'https://static.aiw3.ai/avatars/7.png',
        referralCode: 'REFX1ABC',
        energy: 120, // 邀请奖励
        isNewUser: true
      };

      mockUserService.initializeUser.mockResolvedValue(mockUserData);
      mockUserService.parseInvitationCode.mockReturnValue('ABC123');
      mockMessageFormatter.formatUserInitSuccessMessage.mockReturnValue('Invitation success message');

      // 执行测试 - 带邀请码
      await startHandler.handle(mockContext, ['ABC123']);

      // 验证结果
      expect(mockUserService.parseInvitationCode).toHaveBeenCalledWith('ABC123');
      expect(mockUserService.initializeUser).toHaveBeenCalledWith({
        telegram_id: '745628192',
        username: 'test_user',
        first_name: 'Test',
        last_name: 'User',
        invitation_code: 'ABC123'
      });
    });

    it('should handle user initialization failure', async () => {
      const mockError = {
        code: 'NETWORK_ERROR',
        message: 'Network connection failed',
        retryable: true,
        context: {
          endpoint: '/api/tgbot/user/init',
          timestamp: new Date()
        }
      };

      mockUserService.initializeUser.mockRejectedValue(mockError);
      mockMessageFormatter.formatUserInitErrorMessage.mockReturnValue('Error message');

      // 执行测试
      await startHandler.handle(mockContext, []);

      // 验证结果
      expect(mockContext.reply).toHaveBeenCalledTimes(2); // 欢迎消息 + 错误消息
      expect(mockMessageFormatter.formatUserInitErrorMessage).toHaveBeenCalledWith(mockError);
    });

    it('should handle context without user information', async () => {
      // 设置没有用户信息的context
      const contextWithoutUser = {
        ...mockContext,
        from: undefined
      } as any;

      // 执行测试
      await startHandler.handle(contextWithoutUser, []);

      // 验证结果 - 只发送欢迎消息，不调用用户初始化
      expect(contextWithoutUser.reply).toHaveBeenCalledTimes(1);
      expect(mockUserService.initializeUser).not.toHaveBeenCalled();
    });

    it('should handle system errors gracefully', async () => {
      const systemError = new Error('System error');
      mockUserService.initializeUser.mockRejectedValue(systemError);
      mockMessageFormatter.formatUserInitErrorMessage.mockReturnValue('❌ 账户初始化失败');

      // 执行测试
      await startHandler.handle(mockContext, []);

      // 验证结果 - 应该发送欢迎消息，然后在后台发送错误消息
      expect(mockContext.reply).toHaveBeenCalledTimes(2);
      expect(mockMessageFormatter.formatUserInitErrorMessage).toHaveBeenCalled();
    });
  });

  describe('handleWithInvitation', () => {
    it('should handle invitation flow correctly', async () => {
      const mockUserData: UserInitData = {
        userId: 111925,
        walletAddress: '4YakqTUYaTHkWZHrYJZLmT9GSiT9s9TCoyHGuCy82RKZ',
        nickname: 'Invited User',
        profilePhotoUrl: 'https://static.aiw3.ai/avatars/8.png',
        referralCode: 'REFY2DEF',
        energy: 150,
        isNewUser: true
      };

      mockUserService.initializeUser.mockResolvedValue(mockUserData);
      mockUserService.parseInvitationCode.mockReturnValue('ABC123'); // 模拟解析后的邀请码
      mockMessageFormatter.formatUserInitSuccessMessage.mockReturnValue('Invitation success');

      // 执行测试
      await startHandler.handleWithInvitation(mockContext, 'DEF456');

      // 验证结果
      expect(mockContext.reply).toHaveBeenCalledTimes(2); // 邀请欢迎消息 + 成功消息
      expect(mockUserService.parseInvitationCode).toHaveBeenCalledWith('DEF456');
      expect(mockUserService.initializeUser).toHaveBeenCalledWith({
        telegram_id: '745628192',
        username: 'test_user',
        first_name: 'Test',
        last_name: 'User',
        invitation_code: 'ABC123' // 使用解析后的邀请码
      });
    });
  });

  describe('parseInvitationCodeFromArgs', () => {
    it('should parse invitation code from first argument', async () => {
      mockUserService.parseInvitationCode.mockReturnValue('VALID123');
      mockUserService.initializeUser.mockResolvedValue({
        userId: 111928,
        walletAddress: '7BakqTUYaTHkWZHrYJZLmT9GSiT9s9TCoyHGuCy82RKZ',
        nickname: 'Test',
        profilePhotoUrl: 'https://static.aiw3.ai/avatars/11.png',
        referralCode: 'REFB5MNO',
        energy: 100,
        isNewUser: true
      });
      
      // 使用私有方法的测试需要通过public方法间接测试
      // 这里我们通过handle方法来测试
      await startHandler.handle(mockContext, ['invite_VALID123']);

      expect(mockUserService.parseInvitationCode).toHaveBeenCalledWith('invite_VALID123');
    });

    it('should handle empty arguments array', async () => {
      await startHandler.handle(mockContext, []);

      // 验证没有邀请码的情况下正常工作
      expect(mockUserService.initializeUser).toHaveBeenCalledWith({
        telegram_id: '745628192',
        username: 'test_user',
        first_name: 'Test',
        last_name: 'User',
        invitation_code: undefined
      });
    });
  });

  describe('getStats', () => {
    it('should return handler statistics', () => {
      const stats = startHandler.getStats();

      expect(stats).toEqual({
        name: 'StartHandler',
        version: '1.0.0',
        supportedCommands: ['/start'],
        features: [
          'User initialization',
          'Invitation code processing',
          'Automatic wallet creation',
          'Background processing',
          'Comprehensive error handling'
        ]
      });
    });
  });

  describe('private methods behavior', () => {
    it('should handle message sending failures gracefully', async () => {
      mockContext.reply.mockRejectedValue(new Error('Message send failed'));
      mockUserService.initializeUser.mockResolvedValue({
        userId: 111926,
        walletAddress: '5ZakqTUYaTHkWZHrYJZLmT9GSiT9s9TCoyHGuCy82RKZ',
        nickname: 'Test',
        profilePhotoUrl: 'https://static.aiw3.ai/avatars/9.png',
        referralCode: 'REFZ3GHI',
        energy: 100,
        isNewUser: true
      });

      // 执行测试 - 应该不抛出异常
      await expect(startHandler.handle(mockContext, [])).resolves.not.toThrow();
    });

    it('should handle both reply failures gracefully', async () => {
      // Mock both reply calls to fail
      mockContext.reply
        .mockRejectedValueOnce(new Error('First reply failed'))
        .mockRejectedValueOnce(new Error('Second reply failed'));

      mockUserService.initializeUser.mockResolvedValue({
        userId: 111927,
        walletAddress: '6AakqTUYaTHkWZHrYJZLmT9GSiT9s9TCoyHGuCy82RKZ',
        nickname: 'Test',
        profilePhotoUrl: 'https://static.aiw3.ai/avatars/10.png',
        referralCode: 'REFA4JKL',
        energy: 100,
        isNewUser: true
      });

      // 执行测试 - 应该不抛出异常
      await expect(startHandler.handle(mockContext, [])).resolves.not.toThrow();
    });
  });
});