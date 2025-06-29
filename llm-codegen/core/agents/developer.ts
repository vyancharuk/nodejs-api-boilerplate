import path from 'path';

import { EXAMPLE_MODULE_FILE_PATHS } from '../constants';
import { BaseAgent } from './base';

const MISSING_FILES_INSTRUCTION = (missingFiles: string[]) =>
  `- !IMPORTANT GENERATE only next missing files: ${missingFiles.join(',')}`;
/**
 * @class Developer
 *
 * The Developer micro-agent is responsible for generating the majority of the codebase
 * within the code generation pipeline. It collaborates with the Orchestrator to create 
 * necessary files and components (e.g., routes, controllers, services). The Orchestrator
 * oversees the workflow by checking for any missing files and, if detected, instructs the 
 * Developer to regenerate the code with updated instructions to include the missing files.
 */
export class Developer extends BaseAgent {
  private missingFiles: string[] = [];

  constructor(projectDescription: string, moduleName: string) {
    super('developer.main.prompt', projectDescription, moduleName);
  }

  setMissingFiles(missingFiles: string[]) {
    this.missingFiles = missingFiles.slice();
  }

  async preparePrompt() {
    const servicesExamples = await Promise.all(
      [
        EXAMPLE_MODULE_FILE_PATHS.GET_USER_TODOS_SERVICE,
        EXAMPLE_MODULE_FILE_PATHS.GET_TODO_BY_ID_SERVICE,
        EXAMPLE_MODULE_FILE_PATHS.ADD_TODO_SERVICE,
        EXAMPLE_MODULE_FILE_PATHS.REMOVE_TODO_SERVICE,
      ].map(async (serviceFilePath) => {
        const fileContent = await this.loadSourceFile(serviceFilePath);
        const serviceFileName = path.basename(serviceFilePath);
        return `### SERVICE: - ${serviceFileName.replace(
          '.service.ts',
          ''
        )}: \r\n ${fileContent}`;
      })
    );

    const filePathTemplateMapping = await this.loadSourceFileMap({
      '{{ROUTES_EXAMPLE}}': EXAMPLE_MODULE_FILE_PATHS.ROUTES,
      '{{CONTROLLERS_EXAMPLE}}': EXAMPLE_MODULE_FILE_PATHS.CONTROLLERS,
      '{{REPOSITORY_EXAMPLE}}': EXAMPLE_MODULE_FILE_PATHS.REPOSITORY,
      '{{DI_CONFIG_EXAMPLE}}': EXAMPLE_MODULE_FILE_PATHS.DI_CONFIG,
      '{{TYPES_EXAMPLE}}': EXAMPLE_MODULE_FILE_PATHS.TYPES,
      '{{E2E_TESTS_EXAMPLE}}': EXAMPLE_MODULE_FILE_PATHS.E2E_TESTS,
      '{{MIGRATIONS_EXAMPLE}}': EXAMPLE_MODULE_FILE_PATHS.MIGRATION,
      '{{ALL_API_ROUTES}}': EXAMPLE_MODULE_FILE_PATHS.ALL_API_ROUTES,
      '{{ALL_CONSTANTS}}': EXAMPLE_MODULE_FILE_PATHS.ALL_CONSTANTS,
      '{{ALL_DI_CONFIG}}': EXAMPLE_MODULE_FILE_PATHS.ALL_DI_CONFIG,
      '{{ALL_SEEDS}}': EXAMPLE_MODULE_FILE_PATHS.ALL_SEEDS,
    });

    this.templateMappings = {
      '{{PROJECT_DESCRIPTION}}': this.projectDescription,
      '{{SERVICES_EXAMPLE}}': servicesExamples.join('\r\n\r\n'),
      '{{MISSING_FILES_INSTRUCTION}}':
        this.missingFiles.length > 0
          ? MISSING_FILES_INSTRUCTION(this.missingFiles)
          : '',
      ...filePathTemplateMapping,
    };

    // call base implementation
    return super.preparePrompt();
  }
}
