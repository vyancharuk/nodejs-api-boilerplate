import { promises as fs } from 'fs';
import ora from 'ora';
import * as path from 'path';

import { AnthropicLLMClient } from '../llmClients/anthropicLLMClient';
import { BaseLLMClient } from '../llmClients/baseLLMClient';
import { OpenAILLMClient } from '../llmClients/openAILLMClient';
import { OpenRouterLLMClient } from '../llmClients/openRouterLLMClient';
import { DeepSeekLLMClient } from '../llmClients/deepSeekLLMClient';
import logger from '../logger';
import {
  capitalizeFirstLetter,
  extractFileName,
  lowerCaseFirstLetter,
} from '../utils';
import { EXAMPLE_MODULE_FILE_PATHS } from '../constants';

/**
 * @class BaseAgent
 *
 * The BaseAgent class serves as an abstract foundation for all micro-agents within the code generation pipeline.
 * It manages common functionalities such as loading source files, preparing prompts, executing LLM requests,
 * and saving generated code. The class also handles the initialization of the appropriate LLM client
 * based on available API keys.
 */
export class BaseAgent {
  protected promptTemplateName: string;
  protected moduleName: string;
  protected projectDescription: string;
  protected templateMappings: Record<string, string> = {};
  protected inputTokens: number;
  protected outputTokens: number;
  protected llmClient: BaseLLMClient;

  constructor(
    promptTemplateName: string,
    projectDescription: string,
    moduleName: string
  ) {
    this.moduleName = moduleName;
    this.projectDescription = projectDescription;

    this.inputTokens = 0;
    this.outputTokens = 0;

    this.promptTemplateName = promptTemplateName;

    // create appropriate LLM client
    if (process.env.OPENAI_API_KEY) {
      this.llmClient = new OpenAILLMClient();
      logger.info(
        `${this.constructor.name.toLowerCase()}:using OpenAI LLM`
      );
    } else if (process.env.ANTHROPIC_API_KEY) {
      this.llmClient = new AnthropicLLMClient();
      logger.info(
        `${this.constructor.name.toLowerCase()}:using Anthropic LLM`
      );
    } else if (process.env.OPEN_ROUTER_API_KEY) {
      this.llmClient = new OpenRouterLLMClient();
      logger.info(
        `${this.constructor.name.toLowerCase()}:using OpenRouter LLM`
      );
    } else if (process.env.DEEP_SEEK_API_KEY) {
      this.llmClient = new DeepSeekLLMClient();
      logger.info(
        `${this.constructor.name.toLowerCase()}:using DeepSeek LLM`
      );
    } else {
      throw new Error(
        'Provide API key for at least one LLM client - OpenAI, Anthropic, DeepSeek or OpenRouter'
      );
    }
  }

  async loadSourceFile(filePath: string, templateProp = ''): Promise<string> {
    const absolutePath = !filePath.startsWith('/')
      ? path.join(__dirname, '../../..', filePath)
      : filePath;
    try {
      const content = await fs.readFile(absolutePath, 'utf-8');

      return content;
    } catch (error) {
      logger.error(
        `loadSourceFile:error:reading:templateProp=${templateProp}:file:${absolutePath}:`,
        error
      );
      return '';
    }
  }

  async loadSourceFileMap(
    sourceFileMap: Record<string, string>
  ): Promise<Record<string, string>> {
    const entries = Object.entries(sourceFileMap);

    const results = await Promise.all(
      entries.map(async ([templateProp, filePath]) => {
        const fileContent = await this.loadSourceFile(filePath, templateProp);
        return [templateProp, fileContent] as const;
      })
    );

    return Object.fromEntries(results);
  }

  async preparePrompt() {
    // load context of the prompt
    let replacedPromptTemplate = await fs.readFile(
      path.join(__dirname, '..', 'prompts', this.promptTemplateName),
      'utf-8'
    );

    for (const templateEntry in this.templateMappings) {
      replacedPromptTemplate = replacedPromptTemplate.replace(
        templateEntry,
        this.templateMappings[templateEntry]
      );
    }

    logger.info(
      `${this.constructor.name.toLowerCase()}:preparePrompt:prompt=${
        replacedPromptTemplate.length
      }:characters`
    );
    return replacedPromptTemplate;
  }

  async execute() {
    let spinner;
    try {
      const start = Date.now();
      const preparedPrompt = await this.preparePrompt();

      // animate request
      spinner = ora(
        `${this.constructor.name.toLowerCase()}:making LLM request`
      ).start();

      const {
        content: generatedCode,
        inputTokens,
        outputTokens,
      } = await this.llmClient.execute(preparedPrompt);

      spinner.succeed(
        `${this.constructor.name.toLowerCase()}:LLM request completed in ${Number(
          (Date.now() - start) / 1000
        ).toFixed(1)} seconds`
      );

      // update stats
      this.inputTokens += inputTokens || 0;
      this.outputTokens += outputTokens || 0;

      return this.saveGeneratedCode(generatedCode);
    } catch (ex) {
      spinner?.fail(
        `${this.constructor.name.toLowerCase()}:LLM request failed:${
          (ex as Error).name
        }`
      );
      logger.error(
        `\r\n${this.constructor.name.toLowerCase()}:execute:error=${
          (ex as Error).name
        }:${(ex as Error).message}`,
        ex
      );
    }
    return {};
  }

  /**
   * Parses a raw header line to extract the section name and class name.
   * Expected format: "<SectionName> - <ClassName>" or just "<SectionName>".
   */
  private parseHeader(rawHeader: string): {
    sectionName: string;
    className?: string;
  } {
    const parsedHeader = rawHeader.trim().split(/\s+-\s+/);
    // extract the section name (removing numbering if present)
    const headerMatch = rawHeader.match(/(?:\d+\.\s*)?(\w+)/i);

    if (!headerMatch) {
      throw new Error(`Could not parse section header: ${rawHeader}`);
    }

    const sectionName = headerMatch[1].toUpperCase();
    const className = parsedHeader[1]
      ? extractFileName(parsedHeader[1])
      : undefined;

    return { sectionName, className };
  }

  /**
   * Determines the file path(s) for a given section.
   * Returns an array of file paths because some sections can produce multiple files.
   */
  private async determineFilePaths(
    sectionName: string,
    className?: string
  ): Promise<Record<string, string[]>> {
    switch (sectionName) {
      case 'ROUTES':
        return {
          ROUTES: [
            path.join(
              __dirname,
              '../../..',
              'src',
              'modules',
              this.moduleName,
              'routes.ts'
            ),
          ],
        };
      case 'CONTROLLERS':
        return {
          CONTROLLERS: [
            path.join(
              __dirname,
              '../../..',
              'src',
              'modules',
              this.moduleName,
              'controllers.ts'
            ),
          ],
        };
      case 'REPOSITORY':
        return {
          REPOSITORY: [
            path.join(
              __dirname,
              '../../..',
              'src',
              'modules',
              this.moduleName,
              'repository.ts'
            ),
          ],
        };
      case 'SERVICE': {
        const fileName = className
          ? `${lowerCaseFirstLetter(className)}.service.ts`
          : `get${capitalizeFirstLetter(this.moduleName)}.service.ts`;

        return {
          SERVICES: [
            path.join(
              __dirname,
              '../../..',
              'src',
              'modules',
              this.moduleName,
              fileName
            ),
          ],
        };
      }
      case 'DI_CONFIG':
      case 'DEPENDENCY_INJECTION':
        return {
          DI_CONFIG: [
            path.join(
              __dirname,
              '../../..',
              'src',
              'modules',
              this.moduleName,
              'diConfig.ts'
            ),
          ],
        };
      case 'TYPES':
        return {
          TYPES: [
            path.join(
              __dirname,
              '../../..',
              'src',
              'modules',
              this.moduleName,
              'types.ts'
            ),
          ],
        };
      case 'E2E_TESTS':
      case 'TESTS':
        return {
          E2E_TESTS: [
            path.join(
              __dirname,
              '../../..',
              'src',
              'modules',
              this.moduleName,
              'tests',
              'api.spec.ts'
            ),
          ],
        };
      case 'MIGRATIONS': {
        const timestamp = new Date()
          .toISOString()
          .replace(/[-T:.Z]/g, '')
          .slice(0, -3);
        return {
          MIGRATIONS: [
            path.join(
              __dirname,
              '../../..',
              'src',
              'infra',
              'data',
              'migrations',
              `${timestamp}_create_${this.moduleName}_table.ts`
            ),
          ],
        };
      }
      case 'ALL_API_ROUTES':
        return {
          ALL_API_ROUTES: [
            path.join(
              __dirname,
              '../../..',
              EXAMPLE_MODULE_FILE_PATHS.ALL_API_ROUTES
            ),
          ],
        };
      case 'ALL_CONSTANTS':
        return {
          ALL_CONSTANTS: [
            path.join(
              __dirname,
              '../../..',
              EXAMPLE_MODULE_FILE_PATHS.ALL_CONSTANTS
            ),
          ],
        };
      case 'ALL_DI_CONFIG':
        return {
          ALL_DI_CONFIG: [
            path.join(
              __dirname,
              '../../..',
              EXAMPLE_MODULE_FILE_PATHS.ALL_DI_CONFIG
            ),
          ],
        };
      case 'ALL_SEEDS':
        return {
          ALL_SEEDS: [
            path.join(
              __dirname,
              '../../..',
              EXAMPLE_MODULE_FILE_PATHS.ALL_SEEDS
            ),
          ],
        };
      default:
        throw new Error(`Unknown section name: ${sectionName}`);
    }
  }

  /**
   * Cleans and returns the content lines for a given section.
   * Filters out lines starting with '`' and trims the result.
   */
  private getSectionContent(contentArray: string[]): string {
    return contentArray
      .filter((line) => !line.startsWith('`'))
      .join('\n')
      .trim();
  }

  public async saveGeneratedCode(generatedCode: string) {
    logger.info(
      `${this.constructor.name.toLowerCase()}:saveGeneratedCode:moduleName=${
        this.moduleName
      }:generatedCode=${generatedCode.length}:characters`
    );

    // split the generated code using regex to match both '***' and '###' delimiters
    const sections = generatedCode.split(/(?:\*{3}|#{3})\s*/);

    const allNecessarySectionsToUpdate: { [key: string]: string[] } = {
      ALL_API_ROUTES: [],
      ALL_CONSTANTS: [],
      ALL_DI_CONFIG: [],
      ALL_SEEDS: [],
      CONTROLLERS: [],
      REPOSITORY: [],
      DI_CONFIG: [],
      ROUTES: [],
      MIGRATIONS: [],
      SERVICES: [],
      E2E_TESTS: [],
    };

    const allGeneratedHeaders: string[] = [];

    for (const section of sections) {
      const trimmedSection = section.trim();
      if (!trimmedSection) {
        // skip empty sections
        continue;
      }

      const [rawHeader, ...contentArray] = trimmedSection.split('\n');
      if (!rawHeader) {
        // logger.error(`${this.constructor.name.toLowerCase()}:saveGeneratedCode:EMPTY_HEADER`);
        continue;
      }

      allGeneratedHeaders.push(rawHeader);

      if (!contentArray.length) {
        // logger.error(
        //   `${this.constructor.name.toLowerCase()}:saveGeneratedCode:EMPTY:content for header: ${rawHeader}`
        // );
        continue;
      }

      const content = this.getSectionContent(contentArray);
      if (!content) {
        logger.error(
          `${this.constructor.name}:saveGeneratedCode:EMPTY_CONTENT:${rawHeader}`
        );
        continue;
      }

      let sectionName: string;
      let className: string | undefined;

      try {
        const parsed = this.parseHeader(rawHeader);

        sectionName = parsed.sectionName;
        className = parsed.className;
      } catch (err: any) {
        logger.error(
          `${this.constructor.name.toLowerCase()}:saveGeneratedCode:headerParseError: ${
            err.message
          }`
        );
        continue;
      }

      let filePaths: string[];
      let sectionFileName;

      try {
        const sectionFilePaths = await this.determineFilePaths(
          sectionName,
          className
        );
        [[sectionFileName, filePaths]] = Object.entries(sectionFilePaths);
      } catch (err) {
        logger.error(
          `${this.constructor.name.toLowerCase()}:saveGeneratedCode:error:unknown section: ${sectionName}`
        );
        continue;
      }

      // Write the content to the determined file paths
      for (const filePath of filePaths) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content);

        // logger.info(
        //   `${this.constructor.name}:saveGeneratedCode:WROTE_FILE:sectionFileName=${sectionFileName}:file=${filePath}`
        // );
      }

      // Update the tracking object
      // The keys in allNecessarySectionsToUpdate are uppercase or a specific name
      if (allNecessarySectionsToUpdate[sectionFileName]) {
        allNecessarySectionsToUpdate[sectionFileName].push(...filePaths);
      }
    }

    // logger.info(
    //   `${
    //     this.constructor.name
    //   }:saveGeneratedCode:COMPLETED:allGeneratedHeaders=${allGeneratedHeaders.join(
    //     ', '
    //   )}`
    // );
    logger.info(
      `${this.constructor.name.toLowerCase()}:saveGeneratedCode:saved=${
        Object.values(allNecessarySectionsToUpdate).flat().length
      }:files`
    );
    return allNecessarySectionsToUpdate;
  }

  getUsageStats() {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }
}
