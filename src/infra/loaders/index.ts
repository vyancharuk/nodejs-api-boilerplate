import { Application } from '../../common/types';
import { initDI } from './diContainer';
import expressLoader from './express';
import checkEnvs from './checkenvs';
import { initCronTasks } from './cronjobs';

const { NODE_ENV } = process.env;

const init = async ({ expressApp }: { expressApp: Application }) => {
  await initDI();
  await expressLoader({ app: expressApp });

  // skip env vars check for tests setup
  if (NODE_ENV !== 'test') {
    await checkEnvs();
  }

  await initCronTasks();
};

export default { init };
