import crypto from 'crypto';
import { UserRoles, HTTP_STATUS, Response } from './types';
import appConfig from '../config/app';

/**
 * Returns number - binary representation of user's role for passed string
 * Anonym - 1 - 001
 * Registered - 2 - 010
 * Admin - 4 - 100
 * @param role enum UserRoles
 */
const getRoleCode = (role: string): UserRoles => {
  const enumValue = role[0].toUpperCase() + role.slice(1);

  return UserRoles[enumValue];
}

const getHashedValue = (text: string) => {
  return crypto
    .createHash('md5')
    .update(text + appConfig.hashSalt)
    .digest('hex');
}

// success codes are 2xx
const isErrorCode = (code: number) => !code.toString().startsWith('2');
const getStatusForError = (error) => {
  if (error.toString().toLowerCase().indexOf('validationerror') > -1) {
    return HTTP_STATUS.BAD_REQUEST;
  }

  return HTTP_STATUS.INTERNAL_SERVER_ERROR;
};

const defaultResponseHandler = (
  res: Response,
  { result, code, headers = [] }: { result: any; code: number; headers?: any[] }
) => {
  headers.forEach(({ name, value }) => {
    res.set(name, value);
  });

  return res.status(code).json({ result });
};

const stringifyError = (error) => {
  return `name=${error.name}:message=${error.message}`;
}

export {
  getRoleCode,
  getHashedValue,
  isErrorCode,
  getStatusForError,
  defaultResponseHandler,
  stringifyError,
};
