import Anthropic from '@anthropic-ai/sdk';

import { DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE } from '../constants';
import logger from '../logger';
import { delay } from '../utils';
import { BaseLLMClient } from './baseLLMClient';

const { ANTHROPIC_CLAUDE_MODEL_ID = 'claude-3-5-haiku-20241022' } = process.env;

/**
 * @class AnthropicLLMClient
 *
 * The AnthropicLLMClient class interacts with Anthropic's LLM API.
 * It sends prompts to the specified Anthropic model and retrieves the generated responses.
 * The client handles retry logic for transient server errors to ensure robust communication with the API.
 */
export class AnthropicLLMClient extends BaseLLMClient {
  anthropic: Anthropic;

  constructor() {
    super();
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async execute(
    prompt: string,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    retry = 0
  ): Promise<{ content: string; inputTokens?: number; outputTokens?: number }> {
    try {
      const message = await this.anthropic.messages.create({
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
        model: ANTHROPIC_CLAUDE_MODEL_ID,
      });
      return {
        content: (message.content?.[0] as { text: string }).text || '',
        inputTokens: message.usage?.input_tokens,
        outputTokens: message.usage?.output_tokens,
      };
    } catch (ex) {
      logger.error(`AnthropicLLMClient:execute:retry=${retry}:ex=`, ex);
      if (
        retry < 5 &&
        ex instanceof Anthropic.APIError &&
        Number(ex.status || 0) >= 500
      ) {
        logger.error(
          `AnthropicLLMClient:RETRY:error=`,
          ex.status,
          ex.name,
          'retry=',
          retry
        );
        // wait random seconds
        await delay(10 + Math.random() * 10);

        return this.execute(prompt, maxTokens, temperature, retry + 1);
      }

      throw ex;
    }
  }
}
