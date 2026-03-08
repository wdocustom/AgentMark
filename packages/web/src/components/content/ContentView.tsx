'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function ContentView() {
  const [content, setContent] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [filter, setFilter] = useState({ type: '', status: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [selectedContent, setSelectedContent] = useState<any>(null);
  const [createForm, setCreateForm] = useState({ type: 'blog_post', title: '', body: '' });
  const [aiForm, setAiForm] = useState({ type: 'blog_post', topic: '', targetAudience: '', keywords: '', tone: '', length: 'medium' });
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadContent(); }, [filter]);

  async function loadContent() {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filter.type) params.type = filter.type;
      if (filter.status) params.status = filter.status;
      const res = await api.getContent(params);
      setContent(res.data);
      setPagination(res.pagination);
    } catch {} finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    await api.createContent(createForm);
    setShowCreate(false);
    setCreateForm({ type: 'blog_post', title: '', body: '' });
    loadContent();
  }

  async function handleAIGenerate() {
    const input: any = {
      type: aiForm.type,
      topic: aiForm.topic,
      targetAudience: aiForm.targetAudience || undefined,
      keywords: aiForm.keywords ? aiForm.keywords.split(',').map(k => k.trim()) : undefined,
      tone: aiForm.tone || undefined,
      length: aiForm.length,
    };

    await api.submitAgentTask('content_writer', 'generate_content', input);
    setShowAI(false);
    setAiForm({ type: 'blog_post', topic: '', targetAudience: '', keywords: '', tone: '', length: 'medium' });
    // Content will appear after agent completes
    setTimeout(loadContent, 3000);
  }

  async function viewContent(id: string) {
    const res = await api.getContentById(id);
    setSelectedContent(res.data);
  }

  async function updateStatus(id: string, status: string) {
    await api.updateContent(id, { status });
    loadContent();
    if (selectedContent?.id === id) {
      setSelectedContent({ ...selectedContent, status });
    }
  }

  const typeLabels: Record<string, string> = {
    blog_post: 'Blog Post', email: 'Email', social_post: 'Social',
    ad_copy: 'Ad Copy', landing_page: 'Landing Page', sms: 'SMS', push_notification: 'Push',
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      draft: 'badge-neutral', review: 'badge-warning', approved: 'badge-info', published: 'badge-success', archived: 'badge-neutral',
    };
    return map[status] || 'badge-neutral';
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Content</h1>
          <p className="page-subtitle">Create, manage, and optimize your marketing content</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={() => setShowAI(true)}>AI Generate</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Content</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <select className="form-select" style={{ width: 'auto' }} value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}>
          <option value="">All Types</option>
          {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="form-select" style={{ width: 'auto' }} value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="review">Review</option>
          <option value="approved">Approved</option>
          <option value="published">Published</option>
        </select>
      </div>

      {/* Content Table */}
      <div className="card">
        {content.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Title</th><th>Type</th><th>Status</th><th>Created</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {content.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</td>
                    <td><span className="badge badge-info">{typeLabels[c.type] || c.type}</span></td>
                    <td><span className={`badge ${statusBadge(c.status)}`}>{c.status}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => viewContent(c.id)}>View</button>
                        {c.status === 'draft' && <button className="btn btn-ghost btn-sm" onClick={() => updateStatus(c.id, 'review')}>Submit</button>}
                        {c.status === 'review' && <button className="btn btn-ghost btn-sm" onClick={() => updateStatus(c.id, 'approved')}>Approve</button>}
                        {c.status === 'approved' && <button className="btn btn-ghost btn-sm" onClick={() => updateStatus(c.id, 'published')}>Publish</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No content yet</h3>
            <p>Create content manually or let AI generate it for you.</p>
            <button className="btn btn-primary" onClick={() => setShowAI(true)}>Generate with AI</button>
          </div>
        )}
      </div>

      {/* Create Content Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Create Content</h2>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-select" value={createForm.type} onChange={e => setCreateForm({ ...createForm, type: e.target.value })}>
                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Title</label>
              <input className="form-input" value={createForm.title} onChange={e => setCreateForm({ ...createForm, title: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label">Body</label>
              <textarea className="form-textarea" value={createForm.body} onChange={e => setCreateForm({ ...createForm, body: e.target.value })} rows={8} />
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* AI Generate Modal */}
      {showAI && (
        <div className="modal-overlay" onClick={() => setShowAI(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">AI Content Generation</h2>
            <div className="form-group">
              <label className="form-label">Content Type</label>
              <select className="form-select" value={aiForm.type} onChange={e => setAiForm({ ...aiForm, type: e.target.value })}>
                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Topic / Subject</label>
              <input className="form-input" value={aiForm.topic} onChange={e => setAiForm({ ...aiForm, topic: e.target.value })} placeholder="e.g., AI-Powered Marketing Automation" />
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Target Audience</label>
                <input className="form-input" value={aiForm.targetAudience} onChange={e => setAiForm({ ...aiForm, targetAudience: e.target.value })} placeholder="e.g., Marketing managers" />
              </div>
              <div className="form-group">
                <label className="form-label">Tone</label>
                <input className="form-input" value={aiForm.tone} onChange={e => setAiForm({ ...aiForm, tone: e.target.value })} placeholder="e.g., professional, witty" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Keywords (comma-separated)</label>
              <input className="form-input" value={aiForm.keywords} onChange={e => setAiForm({ ...aiForm, keywords: e.target.value })} placeholder="e.g., marketing, AI, automation" />
            </div>
            <div className="form-group">
              <label className="form-label">Length</label>
              <select className="form-select" value={aiForm.length} onChange={e => setAiForm({ ...aiForm, length: e.target.value })}>
                <option value="short">Short (~500 words)</option>
                <option value="medium">Medium (~1000 words)</option>
                <option value="long">Long (~2000 words)</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowAI(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAIGenerate}>Generate</button>
            </div>
          </div>
        </div>
      )}

      {/* Content Detail Modal */}
      {selectedContent && (
        <div className="modal-overlay" onClick={() => setSelectedContent(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <h2 className="modal-title">{selectedContent.title}</h2>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <span className="badge badge-info">{typeLabels[selectedContent.type]}</span>
              <span className={`badge ${statusBadge(selectedContent.status)}`}>{selectedContent.status}</span>
            </div>
            <div style={{
              background: 'var(--bg-primary)', padding: '20px', borderRadius: '8px',
              maxHeight: '400px', overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: 1.7,
            }}>
              {selectedContent.body}
            </div>
            {selectedContent.versions?.length > 0 && (
              <div style={{ marginTop: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
                {selectedContent.versions.length} version(s)
              </div>
            )}
            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedContent(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
