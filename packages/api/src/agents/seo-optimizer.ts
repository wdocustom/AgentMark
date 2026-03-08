import { query } from '../db/pool.js';
import { BaseAgent } from './base-agent.js';
import type { AgentResult } from './orchestrator.js';

export class SEOOptimizerAgent extends BaseAgent {
  protected registerTools(): void {
    this.registerTool({
      name: 'get_content',
      description: 'Retrieve content by ID',
      execute: async (params) => {
        const { rows } = await query(
          'SELECT * FROM content WHERE id = $1 AND organization_id = $2',
          [params.contentId, this.context.organizationId]
        );
        return rows[0] || null;
      },
    });

    this.registerTool({
      name: 'update_content_metadata',
      description: 'Update content SEO metadata',
      execute: async (params) => {
        await query(
          'UPDATE content SET metadata = metadata || $1 WHERE id = $2',
          [JSON.stringify(params.metadata), params.contentId]
        );
        return { updated: true };
      },
    });
  }

  async execute(taskType: string, input: Record<string, unknown>): Promise<AgentResult> {
    switch (taskType) {
      case 'audit_content':
        return this.auditContent(input);
      case 'keyword_analysis':
        return this.analyzeKeywords(input);
      case 'optimize_content':
        return this.optimizeContent(input);
      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }
  }

  private async auditContent(input: Record<string, unknown>): Promise<AgentResult> {
    const contentId = input.contentId as string;
    const content = await this.useTool('get_content', { contentId }) as any;

    if (!content) throw new Error('Content not found');

    const body = content.body as string;
    const title = content.title as string;
    const metadata = content.metadata || {};

    // Run SEO checks
    const issues: { severity: string; issue: string; recommendation: string }[] = [];
    let score = 100;

    // Title checks
    if (!title || title.length === 0) {
      issues.push({ severity: 'critical', issue: 'Missing title', recommendation: 'Add a descriptive title' });
      score -= 20;
    } else if (title.length > 60) {
      issues.push({ severity: 'warning', issue: 'Title too long', recommendation: `Shorten title to under 60 characters (currently ${title.length})` });
      score -= 5;
    } else if (title.length < 30) {
      issues.push({ severity: 'info', issue: 'Title could be longer', recommendation: 'Consider expanding the title to be more descriptive' });
      score -= 2;
    }

    // Meta description checks
    if (!metadata.seoDescription) {
      issues.push({ severity: 'critical', issue: 'Missing meta description', recommendation: 'Add a meta description between 120-160 characters' });
      score -= 15;
    } else if (metadata.seoDescription.length > 160) {
      issues.push({ severity: 'warning', issue: 'Meta description too long', recommendation: 'Shorten to under 160 characters' });
      score -= 5;
    }

    // Content length checks
    const wordCount = body.split(/\s+/).length;
    if (wordCount < 300) {
      issues.push({ severity: 'warning', issue: 'Content too short', recommendation: `Expand content to at least 300 words (currently ${wordCount})` });
      score -= 10;
    }

    // Heading structure
    const headings = body.match(/^#{1,6}\s+.+$/gm) || [];
    if (headings.length === 0 && wordCount > 200) {
      issues.push({ severity: 'warning', issue: 'No headings found', recommendation: 'Add H2/H3 headings to structure your content' });
      score -= 10;
    }

    // Keywords check
    const keywords = metadata.keywords as string[] || [];
    if (keywords.length === 0) {
      issues.push({ severity: 'warning', issue: 'No target keywords defined', recommendation: 'Define 3-5 target keywords' });
      score -= 10;
    } else {
      // Check keyword density
      const bodyLower = body.toLowerCase();
      for (const keyword of keywords) {
        const count = (bodyLower.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
        const density = (count / wordCount) * 100;
        if (density < 0.5) {
          issues.push({ severity: 'info', issue: `Low keyword density: "${keyword}"`, recommendation: `Mention "${keyword}" more naturally (current density: ${density.toFixed(1)}%)` });
          score -= 3;
        } else if (density > 3) {
          issues.push({ severity: 'warning', issue: `Keyword stuffing detected: "${keyword}"`, recommendation: `Reduce usage of "${keyword}" (current density: ${density.toFixed(1)}%)` });
          score -= 5;
        }
      }
    }

    // Internal links check
    const links = body.match(/\[.+?\]\(.+?\)/g) || [];
    if (links.length === 0 && wordCount > 500) {
      issues.push({ severity: 'info', issue: 'No links found', recommendation: 'Add internal or external links for better SEO' });
      score -= 5;
    }

    // Image alt text check
    const images = body.match(/!\[.*?\]\(.+?\)/g) || [];
    const imagesWithoutAlt = images.filter(img => img.match(/!\[\s*\]/));
    if (imagesWithoutAlt.length > 0) {
      issues.push({ severity: 'warning', issue: `${imagesWithoutAlt.length} images missing alt text`, recommendation: 'Add descriptive alt text to all images' });
      score -= 5 * imagesWithoutAlt.length;
    }

    score = Math.max(0, Math.min(100, score));

    return {
      success: true,
      output: {
        contentId,
        seoScore: score,
        grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
        issues,
        wordCount,
        headingCount: headings.length,
        linkCount: links.length,
        keywordCount: keywords.length,
      },
    };
  }

  private async analyzeKeywords(input: Record<string, unknown>): Promise<AgentResult> {
    const topic = input.topic as string;

    // Analyze what keywords are driving traffic
    const { rows: searchTerms } = await query(
      `SELECT
        properties->>'query' as search_term,
        COUNT(*) as occurrences,
        COUNT(DISTINCT visitor_id) as unique_searchers
       FROM analytics_events
       WHERE organization_id = $1
         AND event = 'search'
         AND properties->>'query' IS NOT NULL
         AND timestamp >= NOW() - INTERVAL '30 days'
       GROUP BY search_term
       ORDER BY occurrences DESC LIMIT 20`,
      [this.context.organizationId]
    );

    // Generate keyword suggestions based on topic
    const suggestions = this.generateKeywordSuggestions(topic);

    return {
      success: true,
      output: {
        existingSearchTerms: searchTerms,
        suggestions,
        topic,
      },
    };
  }

  private async optimizeContent(input: Record<string, unknown>): Promise<AgentResult> {
    const contentId = input.contentId as string;

    // First run an audit
    const audit = await this.auditContent({ contentId });
    const issues = (audit.output.issues as any[]) || [];

    // Auto-fix what we can
    const content = await this.useTool('get_content', { contentId }) as any;
    const fixes: string[] = [];
    const metadata: Record<string, unknown> = {};

    // Generate missing SEO title
    if (!content.metadata?.seoTitle) {
      metadata.seoTitle = content.title.substring(0, 60);
      fixes.push('Generated SEO title');
    }

    // Generate missing meta description
    if (!content.metadata?.seoDescription) {
      const firstParagraph = content.body.split('\n').find((l: string) => l.trim().length > 50) || content.body.substring(0, 160);
      metadata.seoDescription = firstParagraph.substring(0, 160);
      fixes.push('Generated meta description');
    }

    // Auto-calculate word count
    metadata.wordCount = content.body.split(/\s+/).length;
    metadata.estimatedReadTime = Math.ceil(metadata.wordCount as number / 200);

    if (Object.keys(metadata).length > 0) {
      await this.useTool('update_content_metadata', { contentId, metadata });
    }

    return {
      success: true,
      output: {
        contentId,
        originalScore: audit.output.seoScore,
        fixes,
        remainingIssues: issues.filter(i => i.severity === 'critical' || i.severity === 'warning'),
        updatedMetadata: metadata,
      },
    };
  }

  private generateKeywordSuggestions(topic: string): { keyword: string; type: string }[] {
    const baseWords = topic.toLowerCase().split(/\s+/);
    const modifiers = {
      informational: ['how to', 'what is', 'guide to', 'best practices for', 'tips for'],
      commercial: ['best', 'top', 'vs', 'review', 'comparison'],
      transactional: ['buy', 'pricing', 'free trial', 'demo', 'get started with'],
      local: ['near me', 'in 2024', 'for small business', 'for startups'],
    };

    const suggestions: { keyword: string; type: string }[] = [];

    for (const [type, mods] of Object.entries(modifiers)) {
      for (const mod of mods.slice(0, 2)) {
        suggestions.push({
          keyword: `${mod} ${topic}`,
          type,
        });
      }
    }

    // Long-tail variations
    suggestions.push(
      { keyword: `${topic} for beginners`, type: 'informational' },
      { keyword: `${topic} strategy`, type: 'commercial' },
      { keyword: `${topic} tools`, type: 'commercial' },
    );

    return suggestions;
  }
}
