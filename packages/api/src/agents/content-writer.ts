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
    const pastContent = await this.useTool('get_past_content', { type: brief.type, limit: 3 });

    // Build content generation system based on type
    const generators: Record<string, () => Promise<{ title: string; body: string; metadata: Record<string, unknown> }>> = {
      blog_post: () => this.generateBlogPost(brief, brandVoice as Record<string, unknown>),
      email: () => this.generateEmail(brief, brandVoice as Record<string, unknown>),
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
    };
  }

  private async generateBlogPost(
    brief: ContentBrief,
    brandVoice: Record<string, unknown>
  ): Promise<{ title: string; body: string; metadata: Record<string, unknown> }> {
    const lengthGuide = { short: 500, medium: 1000, long: 2000 };
    const targetWords = lengthGuide[brief.length || 'medium'];

    const tone = brief.tone || (brandVoice.tone as string[])?.join(', ') || 'professional';
    const keywords = brief.keywords || [];

    // Generate structured blog post
    const title = `${brief.topic}`;
    const sections = this.generateSections(brief.topic, targetWords);

    const body = sections.map(s => `## ${s.heading}\n\n${s.content}`).join('\n\n');

    return {
      title,
      body,
      metadata: {
        seoTitle: title.substring(0, 60),
        seoDescription: `Learn about ${brief.topic}. ${brief.additionalInstructions || ''}`.substring(0, 160),
        keywords,
        targetAudience: brief.targetAudience,
        estimatedReadTime: Math.ceil(targetWords / 200),
        wordCount: body.split(/\s+/).length,
        tone,
      },
    };
  }

  private async generateEmail(
    brief: ContentBrief,
    brandVoice: Record<string, unknown>
  ): Promise<{ title: string; body: string; metadata: Record<string, unknown> }> {
    const tone = brief.tone || 'conversational';
    const subject = `${brief.topic}`;

    const body = [
      `Hi {{first_name}},\n`,
      this.generateParagraph(brief.topic, brief.targetAudience || 'subscriber', 'opening'),
      this.generateParagraph(brief.topic, brief.targetAudience || 'subscriber', 'value'),
      `**[Take Action Now →]({{cta_url}})**\n`,
      this.generateParagraph(brief.topic, brief.targetAudience || 'subscriber', 'closing'),
      `Best,\n{{sender_name}}`,
    ].join('\n\n');

    return {
      title: subject,
      body,
      metadata: {
        subject,
        preheader: `${brief.topic} - exclusive insights`.substring(0, 100),
        channel: 'email',
        hasPersonalization: true,
        ctaCount: 1,
      },
    };
  }

  private async generateSocialPost(
    brief: ContentBrief,
    brandVoice: Record<string, unknown>
  ): Promise<{ title: string; body: string; metadata: Record<string, unknown> }> {
    const hashtags = (brief.keywords || []).map(k => `#${k.replace(/\s+/g, '')}`).join(' ');

    const body = [
      this.generateHook(brief.topic),
      '',
      this.generateParagraph(brief.topic, brief.targetAudience || 'audience', 'value'),
      '',
      hashtags,
    ].join('\n');

    return {
      title: `Social: ${brief.topic}`,
      body,
      metadata: {
        channel: 'social',
        characterCount: body.length,
        hashtags: brief.keywords || [],
      },
    };
  }

  private async generateAdCopy(
    brief: ContentBrief,
    brandVoice: Record<string, unknown>
  ): Promise<{ title: string; body: string; metadata: Record<string, unknown> }> {
    const headline = this.generateHook(brief.topic);
    const description = this.generateParagraph(brief.topic, brief.targetAudience || 'customer', 'value');
    const cta = 'Get Started Today';

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
    const sections = [
      { type: 'hero', heading: this.generateHook(brief.topic), content: this.generateParagraph(brief.topic, brief.targetAudience || 'visitor', 'opening') },
      { type: 'benefits', heading: 'Why Choose Us', content: this.generateBulletPoints(brief.topic, 4) },
      { type: 'social_proof', heading: 'Trusted By Thousands', content: 'Join the growing community of professionals who rely on our platform.' },
      { type: 'cta', heading: 'Ready to Get Started?', content: this.generateParagraph(brief.topic, brief.targetAudience || 'visitor', 'closing') },
    ];

    const body = sections.map(s => `<!-- ${s.type} -->\n# ${s.heading}\n\n${s.content}`).join('\n\n---\n\n');

    return {
      title: `Landing Page: ${brief.topic}`,
      body,
      metadata: {
        sections: sections.map(s => s.type),
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
    const rewrittenBody = `${instructions ? `[Rewritten with: ${instructions}]\n\n` : ''}${original.body}`;

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
    };
  }

  private async generateVariations(input: Record<string, unknown>): Promise<AgentResult> {
    const originalText = input.text as string;
    const count = (input.count as number) || 3;

    const variations = Array.from({ length: count }, (_, i) => ({
      id: `var_${i + 1}`,
      text: `[Variation ${i + 1}] ${originalText}`,
      approach: ['direct', 'emotional', 'data-driven', 'storytelling'][i % 4],
    }));

    return {
      success: true,
      output: { variations, count: variations.length },
    };
  }

  private async generateSubjectLines(input: Record<string, unknown>): Promise<AgentResult> {
    const topic = input.topic as string;
    const count = (input.count as number) || 5;

    const strategies = [
      { type: 'curiosity', template: `You won't believe what happened with ${topic}` },
      { type: 'urgency', template: `Last chance: ${topic} ends today` },
      { type: 'personal', template: `{{first_name}}, here's your ${topic} update` },
      { type: 'question', template: `Ready to transform your ${topic}?` },
      { type: 'number', template: `5 ways ${topic} can change everything` },
      { type: 'how-to', template: `How to master ${topic} in 2024` },
      { type: 'exclusive', template: `Exclusive: Your ${topic} insider report` },
    ];

    const subjectLines = strategies.slice(0, count).map(s => ({
      subject: s.template,
      strategy: s.type,
      characterCount: s.template.length,
    }));

    return {
      success: true,
      output: { subjectLines },
    };
  }

  // --- Helper methods for content generation ---

  private generateSections(topic: string, targetWords: number): { heading: string; content: string }[] {
    const sectionCount = Math.max(3, Math.ceil(targetWords / 300));
    const templates = [
      { heading: `Understanding ${topic}`, type: 'introduction' },
      { heading: `Why ${topic} Matters`, type: 'importance' },
      { heading: `Key Strategies for ${topic}`, type: 'strategies' },
      { heading: `Best Practices`, type: 'best_practices' },
      { heading: `Common Challenges`, type: 'challenges' },
      { heading: `Getting Started`, type: 'action' },
      { heading: `Conclusion`, type: 'conclusion' },
    ];

    return templates.slice(0, sectionCount).map(t => ({
      heading: t.heading,
      content: this.generateParagraph(topic, 'reader', t.type),
    }));
  }

  private generateParagraph(topic: string, audience: string, purpose: string): string {
    const templates: Record<string, string> = {
      opening: `In today's rapidly evolving landscape, ${topic} has become essential for every ${audience}. Understanding the fundamentals and staying ahead of the curve can make the difference between success and missed opportunities.`,
      value: `When it comes to ${topic}, the key is to focus on what truly matters to your ${audience}. By leveraging data-driven insights and proven methodologies, you can achieve measurable results that drive real business impact.`,
      closing: `The journey with ${topic} is ongoing, and every step forward brings new opportunities. Start implementing these strategies today and watch your results transform.`,
      introduction: `${topic} represents a significant shift in how modern businesses operate. For the savvy ${audience}, this means both new challenges and unprecedented opportunities to grow and innovate.`,
      importance: `The impact of ${topic} cannot be overstated. Organizations that embrace it early gain a competitive advantage, seeing improvements across engagement, conversion, and retention metrics.`,
      strategies: `Effective ${topic} strategies combine creative thinking with analytical rigor. Start by defining clear objectives, then systematically test and optimize each component of your approach.`,
      best_practices: `Industry leaders consistently follow proven best practices: start with quality data, segment your ${audience} thoughtfully, personalize your messaging, and always measure your results against clear KPIs.`,
      challenges: `While ${topic} offers tremendous value, common pitfalls include over-automation, neglecting personalization, and failing to adapt to changing ${audience} preferences. Awareness of these challenges is the first step to avoiding them.`,
      action: `Ready to put ${topic} into practice? Begin with a small pilot, measure everything, and iterate based on what the data tells you. Small, consistent improvements compound into significant results over time.`,
      conclusion: `${topic} is not just a trend—it's the foundation of modern growth strategies. By applying the insights and frameworks outlined here, you're well-positioned to lead in your space.`,
    };

    return templates[purpose] || templates.value;
  }

  private generateHook(topic: string): string {
    const hooks = [
      `Transform Your Results with ${topic}`,
      `The Future of ${topic} Starts Here`,
      `Unlock the Power of ${topic}`,
      `${topic}: What Top Performers Know`,
    ];
    return hooks[Math.floor(Math.random() * hooks.length)];
  }

  private generateBulletPoints(topic: string, count: number): string {
    const points = [
      `Increase engagement by up to 300% with intelligent ${topic}`,
      `Save hours of manual work with automated workflows`,
      `Data-driven decisions that actually move the needle`,
      `Seamless integration with your existing processes`,
      `Real-time analytics and actionable insights`,
      `Personalization at scale without the complexity`,
    ];
    return points.slice(0, count).map(p => `- ${p}`).join('\n');
  }

  private analyzeSentiment(text: string): Record<string, unknown> {
    // Built-in sentiment analysis using keyword scoring
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
