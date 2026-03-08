import { query, transaction } from '../db/pool.js';
import { BaseAgent, ToolDefinition } from './base-agent.js';
import type { AgentContext, AgentResult } from './orchestrator.js';

interface ContentBrief {
  type: string;
  topic: string;
  targetAudience?: string;
  keywords?: string[];
  tone?: string;
  length?: 'short' | 'medium' | 'long';
  additionalInstructions?: string;
}

export class ContentWriterAgent extends BaseAgent {
  constructor(context: AgentContext) {
    super(context);
  }

  protected registerTools(): void {
    this.registerTool({
      name: 'save_content',
      description: 'Save generated content to the database',
      execute: async (params) => {
        const { rows } = await query(
          `INSERT INTO content (organization_id, type, title, body, metadata, agent_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'draft') RETURNING id`,
          [
            this.context.organizationId,
            params.type, params.title, params.body,
            JSON.stringify(params.metadata || {}),
            this.context.agentId,
          ]
        );
        return { contentId: rows[0].id };
      },
    });

    this.registerTool({
      name: 'analyze_sentiment',
      description: 'Analyze sentiment of text content',
      execute: async (params) => {
        const text = params.text as string;
        return this.analyzeSentiment(text);
      },
    });

    this.registerTool({
      name: 'get_brand_voice',
      description: 'Retrieve brand voice guidelines',
      execute: async () => {
        const { rows } = await query(
          'SELECT brand_voice FROM organizations WHERE id = $1',
          [this.context.organizationId]
        );
        return rows[0]?.brand_voice || {};
      },
    });

    this.registerTool({
      name: 'get_past_content',
      description: 'Retrieve previously successful content for reference',
      execute: async (params) => {
        const { rows } = await query(
          `SELECT title, body, metadata FROM content
           WHERE organization_id = $1 AND type = $2 AND status = 'published'
           ORDER BY created_at DESC LIMIT $3`,
          [this.context.organizationId, params.type, params.limit || 5]
        );
        return rows;
      },
    });
  }

  async execute(taskType: string, input: Record<string, unknown>): Promise<AgentResult> {
    switch (taskType) {
      case 'generate_content':
        return this.generateContent(input as unknown as ContentBrief);
      case 'rewrite_content':
        return this.rewriteContent(input);
      case 'generate_variations':
        return this.generateVariations(input);
      case 'generate_subject_lines':
        return this.generateSubjectLines(input);
      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }
  }

  private async generateContent(brief: ContentBrief): Promise<AgentResult> {
    // Get brand voice for personalization
    const brandVoice = await this.useTool('get_brand_voice', {});

    // Get reference content
    const pastContent = await this.useTool('get_past_content', { type: brief.type, limit: 3 }) as any[];

    // Build content generation based on type
    const generators: Record<string, () => Promise<{ title: string; body: string; metadata: Record<string, unknown> }>> = {
      blog_post: () => this.generateBlogPost(brief, brandVoice as Record<string, unknown>, pastContent),
      email: () => this.generateEmail(brief, brandVoice as Record<string, unknown>, pastContent),
      social_post: () => this.generateSocialPost(brief, brandVoice as Record<string, unknown>),
      ad_copy: () => this.generateAdCopy(brief, brandVoice as Record<string, unknown>),
      landing_page: () => this.generateLandingPage(brief, brandVoice as Record<string, unknown>),
    };

    const generator = generators[brief.type];
    if (!generator) throw new Error(`Unsupported content type: ${brief.type}`);

    const content = await generator();

    // Analyze sentiment
    const sentiment = await this.useTool('analyze_sentiment', { text: content.body });

    // Save to database
    const saved = await this.useTool('save_content', {
      type: brief.type,
      title: content.title,
      body: content.body,
      metadata: { ...content.metadata, sentiment, brief },
    });

    return {
      success: true,
      output: {
        contentId: (saved as Record<string, unknown>).contentId,
        title: content.title,
        body: content.body,
        metadata: content.metadata,
        sentiment,
      },
      tokensUsed: this.totalTokensUsed,
    };
  }

  private async generateBlogPost(
    brief: ContentBrief,
    brandVoice: Record<string, unknown>,
    pastContent: any[]
  ): Promise<{ title: string; body: string; metadata: Record<string, unknown> }> {
    const lengthGuide = { short: 500, medium: 1000, long: 2000 };
    const targetWords = lengthGuide[brief.length || 'medium'];
    const tone = brief.tone || (brandVoice.tone as string[])?.join(', ') || 'professional';
    const keywords = brief.keywords || [];

    const pastContext = pastContent.length > 0
      ? `\n\nHere are titles of previously published posts for style reference:\n${pastContent.map((p: any) => `- ${p.title}`).join('\n')}`
      : '';

    const system = `You are an expert content writer specializing in marketing blog posts. Write in markdown format with proper headings (## for sections). Be engaging, informative, and original.${this.buildBrandVoiceInstructions()}`;

    const response = await this.callLLM(
      [{
        role: 'user',
        content: `Write a blog post about "${brief.topic}".

Requirements:
- Target length: approximately ${targetWords} words
- Tone: ${tone}
- Target audience: ${brief.targetAudience || 'general'}
${keywords.length > 0 ? `- Naturally incorporate these keywords: ${keywords.join(', ')}` : ''}
${brief.additionalInstructions ? `- Additional instructions: ${brief.additionalInstructions}` : ''}
${pastContext}

Respond in this exact format:
TITLE: <the blog post title>
---
<the full blog post body in markdown>`,
      }],
      { system, maxTokens: Math.max(2048, targetWords * 2) }
    );

    const { title, body } = this.parseTitleAndBody(response.content, brief.topic);

    return {
      title,
      body,
      metadata: {
        seoTitle: title.substring(0, 60),
        seoDescription: `Learn about ${brief.topic}. ${brief.additionalInstructions || ''}`.substring(0, 160),
        keywords,
        targetAudience: brief.targetAudience,
        estimatedReadTime: Math.ceil(body.split(/\s+/).length / 200),
        wordCount: body.split(/\s+/).length,
        tone,
      },
    };
  }

  private async generateEmail(
    brief: ContentBrief,
    brandVoice: Record<string, unknown>,
    pastContent: any[]
  ): Promise<{ title: string; body: string; metadata: Record<string, unknown> }> {
    const tone = brief.tone || 'conversational';

    const system = `You are an expert email copywriter for marketing campaigns. Write compelling emails that drive action. Use personalization tokens like {{first_name}}, {{sender_name}}, and {{cta_url}} where appropriate.${this.buildBrandVoiceInstructions()}`;

    const response = await this.callLLM(
      [{
        role: 'user',
        content: `Write a marketing email about "${brief.topic}".

Requirements:
- Tone: ${tone}
- Target audience: ${brief.targetAudience || 'subscribers'}
- Include a clear call-to-action using the {{cta_url}} token
- Use {{first_name}} for personalized greeting
- Sign off with {{sender_name}}
${brief.additionalInstructions ? `- Additional instructions: ${brief.additionalInstructions}` : ''}

Respond in this exact format:
SUBJECT: <the email subject line>
---
<the full email body>`,
      }],
      { system, maxTokens: 1024 }
    );

    const parsed = this.parseSubjectAndBody(response.content, brief.topic);

    return {
      title: parsed.subject,
      body: parsed.body,
      metadata: {
        subject: parsed.subject,
        preheader: parsed.body.split('\n').find(l => l.trim().length > 20)?.substring(0, 100) || '',
        channel: 'email',
        hasPersonalization: parsed.body.includes('{{'),
        ctaCount: (parsed.body.match(/\{\{cta_url\}\}/g) || []).length,
      },
    };
  }

  private async generateSocialPost(
    brief: ContentBrief,
    brandVoice: Record<string, unknown>
  ): Promise<{ title: string; body: string; metadata: Record<string, unknown> }> {
    const keywords = brief.keywords || [];
    const hashtags = keywords.map(k => `#${k.replace(/\s+/g, '')}`);

    const system = `You are a social media content expert. Write engaging, shareable social media posts. Keep them concise and impactful.${this.buildBrandVoiceInstructions()}`;

    const response = await this.callLLM(
      [{
        role: 'user',
        content: `Write a social media post about "${brief.topic}".

Requirements:
- Keep it concise (under 280 characters for the main message if possible)
- Target audience: ${brief.targetAudience || 'general audience'}
- Tone: ${brief.tone || 'engaging'}
${hashtags.length > 0 ? `- Include these hashtags at the end: ${hashtags.join(' ')}` : ''}
${brief.additionalInstructions ? `- Additional instructions: ${brief.additionalInstructions}` : ''}

Write only the post content, nothing else.`,
      }],
      { system, maxTokens: 512 }
    );

    const body = response.content.trim();

    return {
      title: `Social: ${brief.topic}`,
      body,
      metadata: {
        channel: 'social',
        characterCount: body.length,
        hashtags: keywords,
      },
    };
  }

  private async generateAdCopy(
    brief: ContentBrief,
    brandVoice: Record<string, unknown>
  ): Promise<{ title: string; body: string; metadata: Record<string, unknown> }> {
    const system = `You are an expert advertising copywriter. Write compelling, conversion-focused ad copy. Be concise and persuasive.${this.buildBrandVoiceInstructions()}`;

    const response = await this.callLLM(
      [{
        role: 'user',
        content: `Write ad copy about "${brief.topic}".

Requirements:
- Target audience: ${brief.targetAudience || 'potential customers'}
- Tone: ${brief.tone || 'persuasive'}
- Include a clear headline, description, and call-to-action
${brief.additionalInstructions ? `- Additional instructions: ${brief.additionalInstructions}` : ''}

Respond in this exact format:
HEADLINE: <short punchy headline>
DESCRIPTION: <compelling description under 90 characters>
CTA: <call to action text>`,
      }],
      { system, maxTokens: 512 }
    );

    const { headline, description, cta } = this.parseAdCopy(response.content, brief.topic);
    const body = `**${headline}**\n\n${description}\n\n→ ${cta}`;

    return {
      title: headline,
      body,
      metadata: {
        headline,
        description: description.substring(0, 90),
        cta,
        channel: 'ads',
      },
    };
  }

  private async generateLandingPage(
    brief: ContentBrief,
    brandVoice: Record<string, unknown>
  ): Promise<{ title: string; body: string; metadata: Record<string, unknown> }> {
    const system = `You are an expert landing page copywriter. Write conversion-optimized landing page content with clear sections. Output in markdown.${this.buildBrandVoiceInstructions()}`;

    const response = await this.callLLM(
      [{
        role: 'user',
        content: `Write landing page content for "${brief.topic}".

Requirements:
- Target audience: ${brief.targetAudience || 'visitors'}
- Tone: ${brief.tone || 'professional and persuasive'}
- Include these sections: Hero (headline + subheadline), Benefits (bullet points), Social Proof, and CTA
- Use markdown with HTML comments to mark sections (e.g. <!-- hero -->)
${brief.additionalInstructions ? `- Additional instructions: ${brief.additionalInstructions}` : ''}

Write only the landing page content in markdown.`,
      }],
      { system, maxTokens: 2048 }
    );

    const body = response.content.trim();
    const sectionTypes = (body.match(/<!--\s*(\w+)\s*-->/g) || [])
      .map(m => m.replace(/<!--\s*|\s*-->/g, ''));

    return {
      title: `Landing Page: ${brief.topic}`,
      body,
      metadata: {
        sections: sectionTypes.length > 0 ? sectionTypes : ['hero', 'benefits', 'social_proof', 'cta'],
        seoTitle: brief.topic.substring(0, 60),
        seoDescription: `${brief.topic} - Transform your workflow today`.substring(0, 160),
      },
    };
  }

  private async rewriteContent(input: Record<string, unknown>): Promise<AgentResult> {
    const contentId = input.contentId as string;
    const instructions = input.instructions as string;

    const { rows } = await query(
      'SELECT * FROM content WHERE id = $1 AND organization_id = $2',
      [contentId, this.context.organizationId]
    );

    if (rows.length === 0) throw new Error('Content not found');

    const original = rows[0];

    const system = `You are an expert content editor. Rewrite the given content following the user's instructions while preserving the core message and structure.${this.buildBrandVoiceInstructions()}`;

    const response = await this.callLLM(
      [{
        role: 'user',
        content: `Rewrite the following content.

Instructions: ${instructions || 'Improve clarity, engagement, and overall quality.'}

Original content:
---
${original.body}
---

Write only the rewritten content, nothing else.`,
      }],
      { system, maxTokens: 4096 }
    );

    const rewrittenBody = response.content.trim();

    // Save as new version
    const versionResult = await query(
      'SELECT MAX(version) as max_version FROM content_versions WHERE content_id = $1',
      [contentId]
    );
    const nextVersion = (versionResult.rows[0].max_version || 0) + 1;

    await transaction(async (client) => {
      await client.query('UPDATE content SET body = $1 WHERE id = $2', [rewrittenBody, contentId]);
      await client.query(
        'INSERT INTO content_versions (content_id, version, body) VALUES ($1, $2, $3)',
        [contentId, nextVersion, rewrittenBody]
      );
    });

    return {
      success: true,
      output: { contentId, version: nextVersion, body: rewrittenBody },
      tokensUsed: this.totalTokensUsed,
    };
  }

  private async generateVariations(input: Record<string, unknown>): Promise<AgentResult> {
    const originalText = input.text as string;
    const count = (input.count as number) || 3;

    const system = `You are an expert copywriter. Generate distinct variations of the given text, each with a different approach or angle.${this.buildBrandVoiceInstructions()}`;

    const response = await this.callLLM(
      [{
        role: 'user',
        content: `Generate ${count} distinct variations of the following text. Each variation should take a different approach (e.g., direct, emotional, data-driven, storytelling).

Original text:
---
${originalText}
---

Respond with each variation numbered like:
1. [approach]: <variation text>
2. [approach]: <variation text>
...`,
      }],
      { system, maxTokens: 2048 }
    );

    const variations = this.parseVariations(response.content, count);

    return {
      success: true,
      output: { variations, count: variations.length },
      tokensUsed: this.totalTokensUsed,
    };
  }

  private async generateSubjectLines(input: Record<string, unknown>): Promise<AgentResult> {
    const topic = input.topic as string;
    const count = (input.count as number) || 5;

    const system = `You are an email marketing expert specializing in subject lines that drive high open rates.${this.buildBrandVoiceInstructions()}`;

    const response = await this.callLLM(
      [{
        role: 'user',
        content: `Generate ${count} email subject lines for the topic: "${topic}"

Use a variety of strategies (curiosity, urgency, personalization with {{first_name}}, questions, numbers, how-to, exclusivity).

Respond with each subject line numbered like:
1. [strategy]: <subject line>
2. [strategy]: <subject line>
...`,
      }],
      { system, maxTokens: 1024 }
    );

    const subjectLines = this.parseSubjectLines(response.content, count);

    return {
      success: true,
      output: { subjectLines },
      tokensUsed: this.totalTokensUsed,
    };
  }

  // --- Parsing helpers ---

  private parseTitleAndBody(raw: string, fallbackTitle: string): { title: string; body: string } {
    const titleMatch = raw.match(/^TITLE:\s*(.+)/m);
    const separatorIndex = raw.indexOf('---');

    if (titleMatch && separatorIndex !== -1) {
      return {
        title: titleMatch[1].trim(),
        body: raw.substring(separatorIndex + 3).trim(),
      };
    }

    // Fallback: first line as title, rest as body
    const lines = raw.trim().split('\n');
    return {
      title: lines[0].replace(/^#\s*/, '').trim() || fallbackTitle,
      body: lines.slice(1).join('\n').trim(),
    };
  }

  private parseSubjectAndBody(raw: string, fallbackSubject: string): { subject: string; body: string } {
    const subjectMatch = raw.match(/^SUBJECT:\s*(.+)/m);
    const separatorIndex = raw.indexOf('---');

    if (subjectMatch && separatorIndex !== -1) {
      return {
        subject: subjectMatch[1].trim(),
        body: raw.substring(separatorIndex + 3).trim(),
      };
    }

    const lines = raw.trim().split('\n');
    return {
      subject: lines[0].trim() || fallbackSubject,
      body: lines.slice(1).join('\n').trim(),
    };
  }

  private parseAdCopy(raw: string, fallbackTopic: string): { headline: string; description: string; cta: string } {
    const headlineMatch = raw.match(/^HEADLINE:\s*(.+)/m);
    const descMatch = raw.match(/^DESCRIPTION:\s*(.+)/m);
    const ctaMatch = raw.match(/^CTA:\s*(.+)/m);

    return {
      headline: headlineMatch?.[1]?.trim() || `Transform Your ${fallbackTopic}`,
      description: descMatch?.[1]?.trim() || `Discover the power of ${fallbackTopic}.`,
      cta: ctaMatch?.[1]?.trim() || 'Get Started Today',
    };
  }

  private parseVariations(raw: string, expectedCount: number): { id: string; text: string; approach: string }[] {
    const variations: { id: string; text: string; approach: string }[] = [];
    const lines = raw.split('\n').filter(l => l.trim());

    for (const line of lines) {
      const match = line.match(/^\d+\.\s*\[([^\]]+)\]:\s*(.+)/);
      if (match) {
        variations.push({
          id: `var_${variations.length + 1}`,
          approach: match[1].trim().toLowerCase(),
          text: match[2].trim(),
        });
      }
    }

    // If parsing failed, split by numbered lines
    if (variations.length === 0) {
      const numbered = raw.split(/\n\d+\.\s+/).filter(Boolean);
      for (let i = 0; i < numbered.length && i < expectedCount; i++) {
        variations.push({
          id: `var_${i + 1}`,
          text: numbered[i].trim(),
          approach: ['direct', 'emotional', 'data-driven', 'storytelling'][i % 4],
        });
      }
    }

    return variations;
  }

  private parseSubjectLines(raw: string, expectedCount: number): { subject: string; strategy: string; characterCount: number }[] {
    const results: { subject: string; strategy: string; characterCount: number }[] = [];
    const lines = raw.split('\n').filter(l => l.trim());

    for (const line of lines) {
      const match = line.match(/^\d+\.\s*\[([^\]]+)\]:\s*(.+)/);
      if (match) {
        const subject = match[2].trim();
        results.push({
          subject,
          strategy: match[1].trim().toLowerCase(),
          characterCount: subject.length,
        });
      }
    }

    // Fallback: parse numbered lines without strategy tags
    if (results.length === 0) {
      const numbered = raw.match(/^\d+\.\s*(.+)/gm) || [];
      const strategies = ['curiosity', 'urgency', 'personal', 'question', 'number', 'how-to', 'exclusive'];
      for (let i = 0; i < numbered.length && i < expectedCount; i++) {
        const subject = numbered[i].replace(/^\d+\.\s*/, '').trim();
        results.push({
          subject,
          strategy: strategies[i % strategies.length],
          characterCount: subject.length,
        });
      }
    }

    return results;
  }

  // --- Sentiment analysis (kept as a local tool, not LLM-dependent) ---

  private analyzeSentiment(text: string): Record<string, unknown> {
    const positiveWords = ['great', 'excellent', 'amazing', 'transform', 'grow', 'success', 'improve', 'best', 'powerful', 'proven', 'innovative', 'unlock', 'opportunity'];
    const negativeWords = ['problem', 'fail', 'miss', 'challenge', 'difficult', 'risk', 'loss', 'decline', 'threat', 'crisis'];

    const words = text.toLowerCase().split(/\W+/);
    const positiveCount = words.filter(w => positiveWords.includes(w)).length;
    const negativeCount = words.filter(w => negativeWords.includes(w)).length;
    const total = Math.max(positiveCount + negativeCount, 1);

    return {
      positive: Math.round((positiveCount / total) * 100) / 100,
      negative: Math.round((negativeCount / total) * 100) / 100,
      neutral: Math.round((1 - (positiveCount + negativeCount) / Math.max(words.length, 1)) * 100) / 100,
      overall: positiveCount > negativeCount ? 'positive' : negativeCount > positiveCount ? 'negative' : 'neutral',
    };
  }
}
