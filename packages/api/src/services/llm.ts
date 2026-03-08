import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';

const client = new Anthropic();

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  system?: string;
}

export interface LLMResponse {
  content: string;
  tokensUsed: number;
}

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;

export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const {
    model = DEFAULT_MODEL,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = 0.7,
    system,
  } = options;

  logger.info({ model, messageCount: messages.length }, 'Calling LLM');

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    ...(system ? { system } : {}),
    messages,
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const content = textBlock ? textBlock.text : '';

  const tokensUsed =
    (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);

  logger.info(
    { model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    'LLM response received'
  );

  return { content, tokensUsed };
}
