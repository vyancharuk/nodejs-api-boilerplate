import 'dotenv/config';

import readlineSync from 'readline-sync';
import yargs from 'yargs';

import { Orchestrator } from './core/agents/Orchestrator';
import logger from './core/logger';

const pluralize = require('pluralize');

interface Args {
  description?: string;
  name?: string;
}

(async () => {
  const argv: Args = yargs.argv as Args;

  // ask user for a description and module name
  let projectDescription;

  if (argv.description) {
    projectDescription = argv.description;
  } else {
    projectDescription = readlineSync.question(
      "Enter the module description: "
    );
  }

  let moduleName;

  if (argv.name) {
    moduleName = argv.name;
  } else {
    moduleName = readlineSync.question("Enter the module name: ");
  }

  if (!moduleName) {
    logger.warn("Entered:EMPTY:moduleName");
    return;
  }

  if (!pluralize.isPlural(moduleName)) {
    moduleName = pluralize.plural(moduleName);
  }

  const orchestrator = new Orchestrator(projectDescription, moduleName);
  await orchestrator.execute(projectDescription, moduleName);
})();
