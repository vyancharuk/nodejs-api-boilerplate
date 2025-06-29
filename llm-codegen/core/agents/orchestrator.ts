import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import ora from 'ora';

import logger from '../logger';
import { BaseAgent } from './base';
import { Developer } from './developer';
import { TestsFixer } from './testsFixer';
import { Troubleshooter } from './troubleshooter';
import { buildTree, printTree } from '../utils';

const {
  MAX_REGENERATE_CODE_ATTEMPTS = 4,
  MAX_FIX_CODE_ATTEMPTS = 4,
  MAX_FIX_E2E_TESTS_ATTEMPTS = 4,
} = process.env;

const GET_BOILERPLATE_CWD = () => path.join(__dirname, '../../..');

/**
 * @class Orchestrator
 *
 * The Orchestrator manages the overall code generation pipeline by coordinating
 * the execution of micro-agents such as Developer, Troubleshooter, and TestsFixer.
 * It oversees the workflow, handles error management, logging, and ensures that each
 * micro-agent operates in the correct sequence to generate, troubleshoot, and verify
 * the codebase.
 */
export class Orchestrator {
  protected moduleName: string;
  protected projectDescription: string;

  constructor(projectDescription: string, moduleName: string) {
    this.projectDescription = projectDescription;
    this.moduleName = moduleName;
  }

  async runDeveloper() {
    let regenerateAttempts = 0;
    const developerAgent = new Developer(
      this.projectDescription,
      this.moduleName
    );
    let validated = await developerAgent.execute();

    let missingFiles = Object.keys(validated).filter(
      (key: string) => validated[key].length === 0
    );

    let lastGeneratedMigration = validated.MIGRATIONS[0];
    let generatedMigration = lastGeneratedMigration;

    let pathToTest = validated.E2E_TESTS[0] || '';

    let generatedFileKeys = Object.keys(validated).filter(
      (key: string) => validated[key].length > 0
    );

    // exclude migrations
    let generatedFiles = Object.entries(validated)
      .filter(([key]) => key !== 'MIGRATIONS')
      .flatMap(([, paths]) => paths);

    while (
      regenerateAttempts < Number(MAX_REGENERATE_CODE_ATTEMPTS) &&
      missingFiles.length > 0
    ) {
      logger.info(
        `orchestrator:runDeveloper:REGENERATE:regenerateAttempts=${regenerateAttempts}:missingFiles=${
          missingFiles.length
        }:${missingFiles.join(', ')}`
      );

      // set missing files
      developerAgent.setMissingFiles(missingFiles);

      validated = await developerAgent.execute();

      if (!pathToTest) {
        pathToTest = validated.E2E_TESTS[0];
      }

      missingFiles = Object.keys(validated).filter(
        (key: string) => validated[key].length === 0
      );

      missingFiles = missingFiles.filter(
        (fileKey: string) => !generatedFileKeys.includes(fileKey)
      );

      generatedFileKeys = generatedFileKeys.concat(
        Object.keys(validated).filter(
          (key: string) => validated[key].length > 0
        )
      );

      generatedFiles = generatedFiles.concat(
        Object.entries(validated)
          .filter(([key]) => key !== 'MIGRATIONS')
          .flatMap(([, paths]) => paths)
      );

      // remove previously generated migration if we previously generated migration and new again
      if (generatedMigration && validated.MIGRATIONS[0]) {
        fs.unlinkSync(generatedMigration);

        logger.info(
          `orchestrator:runDeveloper:REMOVED:Prev:migration=${generatedMigration}`
        );
        generatedMigration = '';
      }

      lastGeneratedMigration = validated.MIGRATIONS[0];

      if (lastGeneratedMigration) {
        generatedMigration = lastGeneratedMigration;
      }

      if (missingFiles.length > 0) {
        logger.warn(
          `orchestrator:runDeveloper:some files are missing after ${regenerateAttempts} attempt:missingFiles=${missingFiles.join(
            ', '
          )}`
        );
      }

      regenerateAttempts += 1;
    }

    return {
      regenerateAttempts,
      result: validated,
      developerAgent,
      generatedFiles,
      generatedMigration,
      missingFiles,
      pathToTest,
    };
  }

  async runTroubleshooter(
    missingFiles: string[],
    generatedServices: string[],
    generatedMigration: string
  ) {
    let fixAttempts = 0;
    let lastGeneratedMigration;

    let validatedOutput =
      missingFiles.length > 0
        ? `Next files were not generated: ${missingFiles.join(',')}`
        : '';

    // run the TypeScript compiler
    let output = await this.runTSCompiler();

    const troubleshooterAgent = new Troubleshooter(
      this.projectDescription,
      this.moduleName,
      generatedServices
    );

    let validated: Record<string, string[]> = {};
    let generatedFiles: string[] = [];

    while (
      fixAttempts < Number(MAX_FIX_CODE_ATTEMPTS) &&
      (!output.success || validatedOutput)
    ) {
      if (fixAttempts > 0) {
        logger.info(
          `orchestrator:runTroubleshooter:fixAttempts=${fixAttempts}`
        );
      }

      troubleshooterAgent.setErrorText(output.output || validatedOutput);
      validated = await troubleshooterAgent.execute();

      fixAttempts += 1;

      const fixedMissingFiles = Object.keys(validated)
        .filter((key: string) => validated[key].length === 0)
        // check if file still missing from originally generated code
        .filter((mf) => missingFiles.indexOf(mf) > -1);

      // remove previously generated migration if we previously generated migration and new again
      if (generatedMigration && validated.MIGRATIONS[0]) {
        fs.unlinkSync(generatedMigration);

        logger.info(
          `orchestrator:runTroubleshooter:REMOVED:Prev:migration=${generatedMigration}`
        );
        generatedMigration = '';
      }

      lastGeneratedMigration = validated.MIGRATIONS[0];

      if (lastGeneratedMigration) {
        generatedMigration = lastGeneratedMigration;
      }

      generatedFiles = generatedFiles.concat(
        Object.entries(validated)
          .filter(([key]) => key !== 'MIGRATIONS')
          .flatMap(([, paths]) => paths)
      );

      validatedOutput =
        fixedMissingFiles.length > 0
          ? `Next files were not generated: ${fixedMissingFiles.join(',')}`
          : '';
      // Run the compiler again
      output = await this.runTSCompiler();

      if (!output.success || validatedOutput) {
        logger.error(
          `orchestrator:runTroubleshooter:TypeScript compilation failed:validatedOutput=${validatedOutput}:output.success=${output.success}`
        );
        // Optionally, you can handle this case further
      } else {
        logger.info('runTroubleshooter:TypeScript compilation succeeded');
      }
    }

    return {
      troubleshooterAgent,
      result: validated,
      generatedFiles,
      generatedMigration: lastGeneratedMigration,
      fixAttempts,
      output,
    };
  }

  async runTestsFixer(
    pathToTest: string,
    generatedServices: string[],
    generatedMigration: string
  ) {
    // Run tests using npm
    let testOutput = await this.runTests(pathToTest);
    let testAttempts = 0;

    const testsFixerAgent = new TestsFixer(
      this.projectDescription,
      this.moduleName,
      generatedServices,
      generatedMigration
    );

    let lastGeneratedMigration = generatedMigration;
    let validated: Record<string, string[]> = {};

    while (
      testAttempts < Number(MAX_FIX_E2E_TESTS_ATTEMPTS) &&
      !testOutput.success
    ) {
      if (testAttempts > 0) {
        logger.info(`orchestrator:runTestsFixer:fixAttempts=${testAttempts}`);
      }

      // update path to recent migration
      if (lastGeneratedMigration) {
        testsFixerAgent.setMigrationPath(lastGeneratedMigration);
      }
      testsFixerAgent.setErrorText(testOutput.output);

      // try to fix E2E tests
      validated = await testsFixerAgent.execute();

      testAttempts += 1;

      // remove previously generated migration if we previously generated migration and new again
      if (generatedMigration && validated.MIGRATIONS?.[0]) {
        fs.unlinkSync(generatedMigration);
        logger.info(
          `orchestrator:runTestsFixer:REMOVED:Prev:migration=${generatedMigration}`
        );
        generatedMigration = '';
      }

      lastGeneratedMigration = validated.MIGRATIONS?.[0];

      if (lastGeneratedMigration) {
        generatedMigration = lastGeneratedMigration;
      }

      testOutput = await this.runTests(pathToTest);

      if (!testOutput.success) {
        logger.warn(`orchestrator:runTestsFixer:E2E tests failed`);
      } else {
        logger.info(`orchestrator:runTestsFixer:E2E tests passed successfully`);
      }
    }

    return {
      testsFixerAgent,
      testAttempts,
      testOutput,
      generatedMigration: lastGeneratedMigration,
    };
  }

  async execute(projectDescription: string, moduleName: string) {
    logger.info('orchestrator:start:code:generation');

    this.projectDescription = projectDescription;
    this.moduleName = moduleName;

    // 1st step - generate all necessary code
    const result = await this.runDeveloper();

    let validated = result.result;
    let generatedMigration = result.generatedMigration;
    const {
      developerAgent,
      generatedFiles,
      missingFiles,
      pathToTest,
      regenerateAttempts,
    } = result;

    const generatedServices = validated.SERVICES?.map((generateServicePath) =>
      path.basename(generateServicePath)
    );

    // 2nd step - compile all code and fix errors if needed
    const troubleshooterResult = await this.runTroubleshooter(
      missingFiles,
      generatedServices,
      generatedMigration
    );

    generatedMigration =
      troubleshooterResult.generatedMigration ?? generatedMigration;

    const { troubleshooterAgent, fixAttempts, output } = troubleshooterResult;

    generatedFiles.push(...troubleshooterResult.generatedFiles);

    // exit if the code was not compiled successfully
    if (fixAttempts === Number(MAX_FIX_CODE_ATTEMPTS) && !output.success) {
      const totalStats = this.getAllStats([
        developerAgent,
        troubleshooterAgent,
      ]);

      logger.info(
        `orchestrator:TypeScript compilation failed again after fixing the code - skipping E2E tests: regenerateAttempts=${regenerateAttempts}:fixAttempts=${fixAttempts}`
      );
      logger.info(
        `orchestrator:LLM token usage stats:inputTokens=${totalStats.totalInputTokens}:outputTokens=${totalStats.totalOutputTokens}`
      );

      return;
    }

    logger.info(`orchestrator:E2E tests ${pathToTest}`);

    // 3rd step - run e2e tests and fix them
    const testFixerResult = await this.runTestsFixer(
      pathToTest,
      generatedServices,
      generatedMigration
    );
    const { testsFixerAgent, testAttempts, testOutput } = testFixerResult;

    generatedMigration =
      testFixerResult.generatedMigration ?? generatedMigration;

    const totalStats = this.getAllStats([
      developerAgent,
      troubleshooterAgent,
      testsFixerAgent,
    ]);

    logger.info(
      `orchestrator:TypeScript compilation and E2E tests completed ${
        testOutput.success ? 'successfully' : 'with errors'
      }:regenerateAttempts=${regenerateAttempts}:fixAttempts=${fixAttempts}:testAttempts=${testAttempts}`
    );

    logger.info(
      `orchestrator:LLM token usage stats:inputTokens=${totalStats.totalInputTokens}:outputTokens=${totalStats.totalOutputTokens}`
    );

    const rootDir = path.resolve(__dirname, '../../..');

    // add recent migration path
    generatedFiles.push(generatedMigration);

    // convert absolute paths to relative paths
    const relativePaths = generatedFiles.map((p) => path.relative(rootDir, p));

    // build a nested object from the relative paths
    const tree = buildTree(relativePaths);

    logger.info('Generated files:');
    // print the project name as root, then the tree
    logger.info('todo-api-boilerplate (root folder)');
    // recursively print the tree
    printTree(tree);
  }

  getAllStats(agents: BaseAgent[]) {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const agent of agents) {
      const stats = agent.getUsageStats();

      totalInputTokens += stats.inputTokens;
      totalOutputTokens += stats.outputTokens;
    }

    return { totalInputTokens, totalOutputTokens };
  }

  async runTSCompiler() {
    return new Promise<{ success: boolean; output: string }>((resolve) => {
      const spinner = ora(`compiling TypeScript code...`).start();
      exec(
        'tsc -p .',
        { cwd: GET_BOILERPLATE_CWD() },
        (error, stdout, stderr) => {
          if (error) {
            spinner.fail(`TypeScript compilation failed`);

            logger.error(
              `\r\nTypeScript compiler error:\n${
                stderr || stdout
              }:error=${error}`
            );
            resolve({
              success: false,
              output: stdout || stderr,
            });
          } else {
            spinner.succeed('TypeScript compilation completed successfully');

            resolve({
              success: true,
              output: stdout,
            });
          }
        }
      );
    });
  }

  async runTests(testToRun: string) {
    return new Promise<{ success: boolean; output: string }>((resolve) => {
      const spinner = ora(`running generated E2E tests...`).start();
      const command = `npm run local:test ${testToRun}`;

      exec(command, { cwd: GET_BOILERPLATE_CWD() }, (error, stdout, stderr) => {
        if (error) {
          spinner.fail('Generated E2E tests completed with errors');
          logger.error(
            `runTests:tests:error:STDOUT=${stdout}:STDERR=${stderr}:error=${error}`
          );
          resolve({
            success: false,
            output: `${stdout || stderr}\r\n${error}`,
          });
        } else {
          spinner.succeed(`Generated E2E tests completed successfully`);
          resolve({
            success: true,
            output: stdout,
          });
        }
      });
    });
  }
}
