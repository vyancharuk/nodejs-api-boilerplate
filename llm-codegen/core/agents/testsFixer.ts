import { EXAMPLE_MODULE_FILE_PATHS } from '../constants';
import logger from '../logger';
import { BaseAgent } from './base';

/**
 * @class TestsFixer
 *
 * The TestsFixer micro-agent handles failed E2E tests within the code generation pipeline.
 * The Orchestrator detects test failures and triggers the TestsFixer to generate and apply fixes.
 */
export class TestsFixer extends BaseAgent {
  private generatedServices: string[];
  private migrationPath: string;
  private errorText: string = '';

  constructor(
    projectDescription: string,
    moduleName: string,
    generatedServices: string[],
    migrationPath: string
  ) {
    super('testsFixer.main.prompt', projectDescription, moduleName);

    this.moduleName = moduleName;
    this.projectDescription = projectDescription;
    this.generatedServices = generatedServices;
    this.migrationPath = migrationPath;
  }

  setErrorText(errorText: string) {
    this.errorText = errorText;
  }

  setMigrationPath(migrationPath: string) {
    this.migrationPath = migrationPath;
  }

  async preparePrompt() {
    logger.info(
      `${
        this.constructor.name
      }:preparePrompt:this.generatedServices=${this.generatedServices.join(
        ','
      )}`
    );

    const generatedServicesExample = await Promise.all(
      this.generatedServices.map(async (serviceFileName) => {
        const fileContent = await this.loadSourceFile(
          `src/modules/${this.moduleName}/${serviceFileName}`,
          serviceFileName
        );

        return `### SERVICE - ${serviceFileName.replace(
          '.service.ts',
          ''
        )}: \r\n ${fileContent}`;
      })
    );

    const exampleE2ETests = await this.loadSourceFile(
      EXAMPLE_MODULE_FILE_PATHS.E2E_TESTS
    );
    const moduleE2ETests = await this.loadSourceFile(
      `src/modules/${this.moduleName}/tests/api.spec.ts`
    );

    const e2eTestsContent = `EXAMPLE E2E_TESTS:\r\n${exampleE2ETests}\r\n
    GENERATED E2E_TESTS:\r\n${moduleE2ETests}`;

    const filePathTemplateMapping = await this.loadSourceFileMap({
      '{{MODULE_ROUTES}}': `src/modules/${this.moduleName}/routes.ts`,
      '{{MODULE_CONTROLLERS}}': `src/modules/${this.moduleName}/controllers.ts`,
      '{{MODULE_REPOSITORY}}': `src/modules/${this.moduleName}/repository.ts`,
      '{{MODULE_MIGRATIONS}}': this.migrationPath,
      '{{SERVICES_EXAMPLE}}': EXAMPLE_MODULE_FILE_PATHS.UPDATE_TODO_SERVICE,
      '{{ALL_SEEDS}}': EXAMPLE_MODULE_FILE_PATHS.ALL_SEEDS,
    });

    this.templateMappings = {
      '{{PROJECT_DESCRIPTION}}': this.projectDescription,
      '{{MODULE_SERVICES}}': generatedServicesExample.join('\r\n\r\n'),
      '{{MODULE_E2E_TESTS}}': e2eTestsContent,
      '{{ERROR_TEXT}}': this.errorText,
      ...filePathTemplateMapping,
    };

    // call base implementation
    return super.preparePrompt();
  }
}
