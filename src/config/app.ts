import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const { NODE_ENV = 'dev' } = process.env;

const envPath =
  NODE_ENV === 'test'
    ? path.resolve(__dirname + '/../../.env.test')
    : path.resolve(__dirname + '/../../.env');

const envFileExists = fs.existsSync(envPath);

if (envFileExists && ['dev', 'test'].includes(NODE_ENV)) {
  const result = dotenv.config({
    path: envPath,
  });

  if (result.error) {
    throw result.error;
  }
}

const {
  DB_URI,
  JWT_SECRET,
  LOG_LEVEL = 'info',
  AWS_BUCKET,
  AWS_ACCESS_KEY,
  AWS_SECRET,
  AWS_REGION,

  REDIS_URI,

  PORT = 3000,
} = process.env;

type AppConfig = {
  [key: string]: any;
};

const appConfig: AppConfig = {
  awsBucket: AWS_BUCKET,
  awsRegion: AWS_REGION,
  awsAccessKey: AWS_ACCESS_KEY,
  awsSecretAccessKey: AWS_SECRET,

  hashSalt: 'r4yw2!',
  env: NODE_ENV,
  /**
   * Your favorite port
   */
  //   port: parseInt(PORT as string, 10),
  port: Number(PORT),

  /**
   * That long string from mlab
   */
  databaseURL: DB_URI,

  /**
   * Redis connection string
   */
  redisUri: REDIS_URI,
  /**
   * Identifies each client app which requests JWT
   */
  defaultClientId: '9781',

  /**
   * Duration period for refresh token in seconds, set it to 90 days by default
   */
  refreshTokenDuration: 90 * 24 * 60 * 60,

  /**
   * Your secret sauce for JWT token
   */
  jwtSecret: JWT_SECRET,

  /**
   * Duration period for JWT token in seconds, set it to 8h
   */
  jwtDuration: 8 * 60 * 60,

  /**
   * Used by winston logger
   */
  logs: {
    level: LOG_LEVEL,
  },

  /**
   * API configs
   */
  api: {
    prefix: '/api',
  },
};

export default appConfig;
