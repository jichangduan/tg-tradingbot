module.exports = {
  // 测试环境
  testEnvironment: 'node',
  
  // TypeScript支持
  preset: 'ts-jest',
  
  // 测试文件匹配模式
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/tests/**/*.spec.ts',
    '**/__tests__/**/*.ts'
  ],
  
  // 覆盖率收集
  collectCoverage: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts', // 入口文件通常不需要测试覆盖率
    '!**/node_modules/**'
  ],
  
  // 覆盖率报告格式
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'json-summary'
  ],
  
  // 覆盖率输出目录
  coverageDirectory: 'coverage',
  
  // 覆盖率阈值
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  
  // 模块映射（支持路径别名）
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/bot/(.*)$': '<rootDir>/src/bot/$1',
    '^@/services/(.*)$': '<rootDir>/src/services/$1',
    '^@/types/(.*)$': '<rootDir>/src/types/$1',
    '^@/utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@/config/(.*)$': '<rootDir>/src/config/$1'
  },
  
  // 设置文件
  setupFilesAfterEnv: [
    '<rootDir>/tests/setup.ts'
  ],
  
  // 转换配置
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  
  // 模块文件扩展名
  moduleFileExtensions: [
    'ts',
    'js',
    'json'
  ],
  
  // 测试超时时间
  testTimeout: 30000,
  
  // 清除模拟
  clearMocks: true,
  
  // 恢复模拟
  restoreMocks: true,
  
  // 详细输出
  verbose: true,
  
  // 忽略的路径
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/'
  ],
  
  // 全局配置
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json'
    }
  }
};