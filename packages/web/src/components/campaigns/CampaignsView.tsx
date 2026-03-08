'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function CampaignsView() {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<any>(null);
  const [filter, setFilter] = useState({ status: '', type: '' });
  const [createForm, setCreateForm] = useState({
    name: '', description: '', type: 'email',
    channels: [{ channel: 'email', enabled: true, settings: {} }],
  });

  useEffect(() => { loadCampaigns(); }, [filter]);

  async function loadCampaigns() {
    const params: Record<string, string> = {};
    if (filter.status) params.status = filter.status;
    if (filter.type) params.type = filter.type;
    const res = await api.getCampaigns(params);
    setCampaigns(res.data);
  }

  async function handleCreate() {
    await api.createCampaign(createForm);
    setShowCreate(false);
    setCreateForm({ name: '', description: '', type: 'email', channels: [{ channel: 'email', enabled: true, settings: {} }] });
    loadCampaigns();
  }

  async function updateStatus(id: string, status: string) {
    await api.updateCampaignStatus(id, status);
    loadCampaigns();
  }

  async function viewCampaign(id: string) {
    const res = await api.getCampaignById(id);
    setSelectedCampaign(res.data);
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      draft: 'badge-neutral', scheduled: 'badge-info', active: 'badge-success',
      paused: 'badge-warning', completed: 'badge-success', cancelled: 'badge-error',
    };
    return map[status] || 'badge-neutral';
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-subtitle">Orchestrate multi-channel marketing campaigns</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Campaign</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <select className="form-select" style={{ width: 'auto' }} value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
        </select>
        <select className="form-select" style={{ width: 'auto' }} value={filter.type} onChange={e => setFilter({ ...filter, type: e.target.value })}>
          <option value="">All Types</option>
          <option value="email">Email</option>
          <option value="social">Social</option>
          <option value="multi_channel">Multi-Channel</option>
          <option value="drip">Drip</option>
          <option value="triggered">Triggered</option>
        </select>
      </div>

      <div className="card">
        {campaigns.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Campaign</th><th>Type</th><th>Status</th><th>Sent</th><th>Open Rate</th><th>Click Rate</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{c.name}</div>
                      {c.segment_name && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Segment: {c.segment_name}</div>}
                    </td>
                    <td><span className="badge badge-info">{c.type}</span></td>
                    <td><span className={`badge ${statusBadge(c.status)}`}>{c.status}</span></td>
                    <td>{c.metrics?.sent?.toLocaleString() || 0}</td>
                    <td>{c.metrics?.openRate || 0}%</td>
                    <td>{c.metrics?.clickRate || 0}%</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => viewCampaign(c.id)}>View</button>
                        {c.status === 'draft' && <button className="btn btn-ghost btn-sm" onClick={() => updateStatus(c.id, 'scheduled')}>Schedule</button>}
                        {c.status === 'active' && <button className="btn btn-ghost btn-sm" onClick={() => updateStatus(c.id, 'paused')}>Pause</button>}
                        {c.status === 'paused' && <button className="btn btn-ghost btn-sm" onClick={() => updateStatus(c.id, 'active')}>Resume</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No campaigns yet</h3>
            <p>Create your first campaign to start reaching your audience.</p>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Create Campaign</button>
          </div>
        )}
      </div>

      {/* Create Campaign Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Create Campaign</h2>
            <div className="form-group">
              <label className="form-label">Campaign Name</label>
              <input className="form-input" value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g., Spring Product Launch" />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea className="form-textarea" value={createForm.description} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} rows={3} />
            </div>
            <div className="form-group">
              <label className="form-label">Campaign Type</label>
              <select className="form-select" value={createForm.type} onChange={e => setCreateForm({ ...createForm, type: e.target.value })}>
                <option value="email">Email</option>
                <option value="social">Social</option>
                <option value="multi_channel">Multi-Channel</option>
                <option value="drip">Drip Sequence</option>
                <option value="triggered">Triggered</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>Create Campaign</button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign Detail Modal */}
      {selectedCampaign && (
        <div className="modal-overlay" onClick={() => setSelectedCampaign(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <h2 className="modal-title">{selectedCampaign.name}</h2>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <span className="badge badge-info">{selectedCampaign.type}</span>
              <span className={`badge ${statusBadge(selectedCampaign.status)}`}>{selectedCampaign.status}</span>
            </div>

            <div className="metrics-grid" style={{ marginBottom: '20px' }}>
              <div className="metric-card">
                <div className="metric-label">Sent</div>
                <div className="metric-value" style={{ fontSize: '24px' }}>{selectedCampaign.metrics?.sent?.toLocaleString() || 0}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Open Rate</div>
                <div className="metric-value" style={{ fontSize: '24px' }}>{selectedCampaign.metrics?.openRate || 0}%</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Click Rate</div>
                <div className="metric-value" style={{ fontSize: '24px' }}>{selectedCampaign.metrics?.clickRate || 0}%</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Conversions</div>
                <div className="metric-value" style={{ fontSize: '24px' }}>{selectedCampaign.metrics?.conversions || 0}</div>
              </div>
            </div>

            {selectedCampaign.description && (
              <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>{selectedCampaign.description}</p>
            )}

            <div style={{ textAlign: 'right' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedCampaign(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
