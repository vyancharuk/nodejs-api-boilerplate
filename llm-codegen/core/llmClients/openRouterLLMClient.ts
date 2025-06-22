import OpenAI from 'openai';

import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '../constants';
import logger from '../logger';
import { delay } from '../utils';
import { BaseLLMClient } from './baseLLMClient';

const OPEN_ROUTER_APP_NAME = 'LLM-CODEGEN-NODEJS-BOILERPLATE-VY';
const OPEN_ROUTER_LLAMA_8B_MODEL_ID =
  'nousresearch/deephermes-3-llama-3-8b-preview:free'

/**
 * @class OpenRouterLLMClient
 *
 * The OpenRouterLLMClient class interacts with OpenRouter's LLM API.
 * OpenRouter normalizes requests and responses across different LLM providers, ensuring consistent interaction.
 * It sends prompts to the specified OpenRouter model and retrieves the generated responses.
 * The client includes retry logic to handle transient server errors, ensuring reliable communication with the API.
 */
export class OpenRouterLLMClient extends BaseLLMClient {
  openai: OpenAI;

  constructor() {
    super();
    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPEN_ROUTER_API_KEY,
      defaultHeaders: {
        'X-Title': OPEN_ROUTER_APP_NAME,
      },
    });
  }

  async execute(
    prompt: string,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    retry = 0
  ): Promise<{ content: string; inputTokens?: number; outputTokens?: number }> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: OPEN_ROUTER_LLAMA_8B_MODEL_ID,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      return {
        content: completion?.choices?.[0].message?.content || '',
        inputTokens: completion.usage?.prompt_tokens,
        outputTokens: completion.usage?.completion_tokens,
      };
    } catch (ex) {
      logger.error(`OpenRouterLLMClient:execute:retry=${retry}:ex=`, ex);

      if (retry < 5) {
        // wait random seconds
        await delay(10 + Math.random() * 10);

        return this.execute(prompt, maxTokens, temperature, retry + 1);
      }

      throw ex;
    }
  }
}
