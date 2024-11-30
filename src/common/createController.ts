import { RateLimiterRedis } from 'rate-limiter-flexible';
import requestIp from 'request-ip';

import { container } from '../infra/loaders/diContainer';
import logger from '../infra/loaders/logger';
import { BINDINGS } from './constants';
import Operation from './operation';
import {
  HTTP_STATUS,
  interfaces,
  Knex,
  NextFunction,
  Request,
  Response,
  z,
} from './types';
import {
  defaultResponseHandler,
  getStatusForError,
  formatValidationError,
} from './utils';

/**
 * Creates an express.js controller function for handling API requests.
 * This function adheres to Clean Architecture principles, where `paramsCb` serves as an interactor
 * to pass parameters to the service (use case).
 *
 * @param {interfaces.Newable<Operation>} serviceConstructor - The constructor of the service (operation) to be executed.
 * @param {Function} [paramsCb=() => {}] - A callback function to extract and transform parameters from the request. According to clean architecture paramsCb serves as interactor - it passes params to service(use case)
 * @param {Function} [resCb=defaultResponseHandler] - A callback function to handle the response.
 * @param {Knex.Transaction} [parentTransaction] - An optional parent transaction to be used for database operations.
 *
 * @returns {Function} An Express.js middleware function that processes the request, executes the service, and handles the response.
 *
 * @throws {Error} Throws an error if JWT is already expired, rate limits are exceeded, or any unexpected error occurs during the operation.
 */
export const createController =
  (
    serviceConstructor: interfaces.Newable<Operation>,
    paramsCb: Function = () => {},
    resCb: Function = defaultResponseHandler,
    parentTransaction?: Knex.Transaction | undefined
  ) =>
  async (req: Request, res: Response, next: NextFunction) => {
    // 1. check jwt token if it is already expired
    logger.info(
      `createController:start auth=${!!req.headers['authorization']}`
    );

    let transaction: Knex.Transaction | undefined;
    try {
      if (req.headers['authorization']) {
        const memoryStorage: any = container.get(BINDINGS.MemoryStorage);
        // check for already expired token
        const jwt = req.headers['authorization']!.split(' ')[1];
        const jwtSign = jwt.split('.')[2];
        const tokenExpired = await memoryStorage.getValue(jwtSign);

        logger.info(
          `createController:check expired jwtSign:${jwtSign} tokenExpired=${tokenExpired}`
        );

        if (tokenExpired) {
          return resCb(res, {
            result: { error: 'JWT_ALREADY_EXPIRED' },
            code: HTTP_STATUS.BAD_REQUEST,
          });
        }
      }

      // 2. process rate limiters
      const ipAddr = requestIp.getClientIp(req);

      const { retrySecs, currentRateLimiters } = await processRateLimiters(
        ipAddr,
        serviceConstructor['rateLimiters']
          ? serviceConstructor['rateLimiters']
          : []
      );

      if (retrySecs > 0) {
        return resCb(res, {
          result: { error: 'TOO_MANY_REQUESTS' },
          code: HTTP_STATUS.TOO_MANY_REQUESTS,
          headers: [{ name: 'Retry-After', value: `${String(retrySecs)}sec` }],
        });
      }

      logger.info(
        `createController:before consume rate limiters count=${currentRateLimiters.length}`
      );

      // update rateLimiters
      await Promise.all(currentRateLimiters.map((tr) => tr.consume(ipAddr)));

      // 3. process use case service logic
      logger.info(`createController:init`);

      // create transaction if needed, and share it between all repositories used by controller
      if (!parentTransaction && serviceConstructor['useTransaction']) {
        logger.info(`createController:start:transaction`);

        const db: Knex = container.get<Knex>(BINDINGS.DbAccess);
        transaction = await db.transaction();
      } else if (parentTransaction) {
        logger.info(`createController:use:parent:transaction`);
        transaction = parentTransaction;
      }

      logger.info(`createController:use transaction=${!!transaction}`);

      const service: Operation = container.resolve(serviceConstructor);

      // according to pattern "unit of work" perform all operation changes in transaction if needed
      // https://www.martinfowler.com/eaaCatalog/unitOfWork.html
      if (transaction !== undefined) {
        // get all used repositories for controller
        const repositories = service.getRepositories();
        repositories.forEach((repo) => repo.setDbAccess(transaction!));

        logger.info(`createController:repositories=${repositories.length}`);
      }

      const params = await paramsCb(req, res);
      const result = await service.run(params);

      if (!parentTransaction && transaction !== undefined) {
        logger.info(`createController:transaction commit`);

        await transaction.commit();
      }

      logger.info(`createController:completed`);

      if (!resCb) {
        return res.json({ result }).status(HTTP_STATUS.OK);
      }

      return resCb(res, { result, code: HTTP_STATUS.OK }, req);
    } catch (ex) {
      if (!parentTransaction && transaction !== undefined) {
        logger.warn(`createController:transaction rollback`);

        await transaction.rollback();
      } else if (parentTransaction) {
        logger.warn(`createController:skip parentTransaction rollback`);
      }

      if (ex instanceof z.ZodError) {
        logger.error(`createController:error=${formatValidationError(ex)}`);
        return resCb(res, {
          result: formatValidationError(ex),
          code: HTTP_STATUS.BAD_REQUEST,
          message: ex.message,
        });
      }
      if (
        !(ex instanceof Error) &&
        (ex as { msBeforeNext: number }).msBeforeNext
      ) {
        logger.error(
          `createController:error:TOO_MANY_REQUESTS:=${JSON.stringify(ex)}`
        );
        return resCb(res, {
          result: { error: 'TOO_MANY_REQUESTS' },
          code: HTTP_STATUS.TOO_MANY_REQUESTS,
          headers: [
            {
              name: 'Retry-After',
              value: `${
                String(Math.round((ex as any).msBeforeNext / 1000)) || '1'
              }sec`,
            },
          ],
        });
      }
      logger.error(`createController:error ${ex} \r\n ${(ex as any).stack}`);

      return resCb(res, {
        result: { error: (ex as any).toString(), message: (ex as any).message },
        code: (ex as any).status || getStatusForError(ex),
      });
    }
  };

const processRateLimiters = async (ipAddr, rateLimiters: any[]) => {
  const redis = container.get(BINDINGS.Redis);

  // create rate limiters if needed for current class
  const currentRateLimiters: any[] = rateLimiters.reduce((result, params) => {
    let rt;
    if (container.isBound(params.keyPrefix)) {
      rt = container.get(params.keyPrefix);
    } else {
      rt = new RateLimiterRedis({
        storeClient: redis,
        ...params,
      });

      container.bind(params.keyPrefix).toConstantValue(rt);
    }

    return result.concat([rt]);
  }, []);
  let retrySecs = 0;

  const rtResults = await Promise.all(
    currentRateLimiters.map((tr) => tr.get(ipAddr))
  );

  rtResults.forEach((resByIP, ind) => {
    // check if IP address is already blocked
    if (
      retrySecs === 0 &&
      resByIP !== null &&
      resByIP.consumedPoints > rateLimiters[ind].points
    ) {
      retrySecs = Math.round(resByIP.msBeforeNext / 1000) || 1;
    }
  });

  return {
    retrySecs,
    currentRateLimiters,
  };
};
