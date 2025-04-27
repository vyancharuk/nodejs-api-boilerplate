
// make sure JWT_SECRET is not empty
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';

module.exports = {
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)',
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  setupFilesAfterEnv: ['<rootDir>/src/tests/test-setup.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  transformIgnorePatterns: [
    '[/\\\\]node_modules[/\\\\].+\\.(js|jsx|mjs|ts|tsx)$',
  ],
  testEnvironment: 'node'
};
