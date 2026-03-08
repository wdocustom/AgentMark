import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';
import { callLLM, type LLMMessage, type LLMOptions, type LLMResponse } from '../services/llm.js';
import type { AgentContext, AgentResult } from './orchestrator.js';

export interface ToolDefinition {
  name: string;
  description: string;
  execute: (params: Record<string, unknown>, context: AgentContext) => Promise<unknown>;
}

export abstract class BaseAgent {
  protected context: AgentContext;
  protected tools: Map<string, ToolDefinition> = new Map();
  protected memory: { shortTerm: unknown[]; context: string[] } = { shortTerm: [], context: [] };
  protected totalTokensUsed = 0;

  constructor(context: AgentContext) {
    this.context = context;
    this.registerTools();
  }

  abstract execute(taskType: string, input: Record<string, unknown>): Promise<AgentResult>;
  protected abstract registerTools(): void;

  protected registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  protected async useTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);

    logger.info({ tool: name, params }, 'Agent using tool');
    const result = await tool.execute(params, this.context);

    // Store in short-term memory
    this.memory.shortTerm.push({ tool: name, params, result, timestamp: new Date() });

    return result;
  }

  protected async callLLM(
    messages: LLMMessage[],
    options: LLMOptions = {}
  ): Promise<LLMResponse> {
    const response = await callLLM(messages, options);
    this.totalTokensUsed += response.tokensUsed;
    return response;
  }

  protected async addToMemory(key: string, value: unknown): Promise<void> {
    await query(
      `UPDATE agents SET memory = jsonb_set(
        memory, '{longTerm}',
        memory->'longTerm' || $1::jsonb
      ) WHERE id = $2`,
      [JSON.stringify([{ key, value, relevance: 1.0 }]), this.context.agentId]
    );
  }

  protected async recallMemory(key: string): Promise<unknown | null> {
    const { rows } = await query(
      `SELECT elem FROM agents,
       jsonb_array_elements(memory->'longTerm') elem
       WHERE id = $1 AND elem->>'key' = $2
       ORDER BY (elem->>'relevance')::float DESC LIMIT 1`,
      [this.context.agentId, key]
    );
    return rows.length > 0 ? rows[0].elem.value : null;
  }

  protected buildPrompt(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }

  protected buildBrandVoiceInstructions(): string {
    const voice = this.context.brandVoice;
    if (!voice) return '';

    const parts: string[] = [];
    if (voice.tone) parts.push(`Tone: ${(voice.tone as string[]).join(', ')}`);
    if (voice.personality) parts.push(`Personality: ${voice.personality}`);
    if (voice.guidelines) parts.push(`Guidelines: ${voice.guidelines}`);

    return parts.length > 0
      ? `\n\nBrand Voice:\n${parts.join('\n')}`
      : '';
  }
}
