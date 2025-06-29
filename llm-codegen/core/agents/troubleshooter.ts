import { EXAMPLE_MODULE_FILE_PATHS } from '../constants';
import { BaseAgent } from './base';

/**
 * @class Troubleshooter
 *
 * The Troubleshooter micro-agent addresses TypeScript compilation errors within the code generation pipeline.
 * When the Orchestrator detects compilation failures, it triggers the Troubleshooter to analyze the errors,
 * generate corrective code using the LLM client, and apply the necessary fixes to ensure successful compilation.
 */
export class Troubleshooter extends BaseAgent {
  private generatedServices: string[];
  private errorText: string = '';

  constructor(
    projectDescription: string,
    moduleName: string,
    generatedServices: string[]
  ) {
    super('troubleshooter.main.prompt', projectDescription, moduleName);

    this.generatedServices = generatedServices;
  }

  setErrorText(errorText: string) {
    this.errorText = errorText;
  }

  async preparePrompt() {
    const generatedModuleServices = await Promise.all(
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

    const filePathTemplateMapping = await this.loadSourceFileMap({
      '{{MODULE_ROUTES}}': `src/modules/${this.moduleName}/routes.ts`,
      '{{MODULE_CONTROLLERS}}': `src/modules/${this.moduleName}/controllers.ts`,
      '{{MODULE_REPOSITORY}}': `src/modules/${this.moduleName}/repository.ts`,
      '{{MODULE_TYPES}}': `src/modules/${this.moduleName}/types.ts`,
      '{{MODULE_E2E_TESTS}}': `src/modules/${this.moduleName}/tests/api.spec.ts`,

      '{{SERVICES_EXAMPLE}}': EXAMPLE_MODULE_FILE_PATHS.UPDATE_TODO_SERVICE,
      '{{DI_CONFIG_EXAMPLE}}': EXAMPLE_MODULE_FILE_PATHS.DI_CONFIG,

      '{{ALL_API_ROUTES}}': EXAMPLE_MODULE_FILE_PATHS.ALL_API_ROUTES,
      '{{ALL_CONSTANTS}}': EXAMPLE_MODULE_FILE_PATHS.ALL_CONSTANTS,
      '{{ALL_DI_CONFIG}}': EXAMPLE_MODULE_FILE_PATHS.ALL_DI_CONFIG,
    });

    this.templateMappings = {
      '{{PROJECT_DESCRIPTION}}': this.projectDescription,
      '{{MODULE_SERVICES}}': generatedModuleServices.join(`\r\n\r\n`),
      '{{ERROR_TEXT}}': this.errorText,
      ...filePathTemplateMapping,
    };

    // call base implementation
    return super.preparePrompt();
  }
}
