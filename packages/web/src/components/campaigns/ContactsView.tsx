'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function ContactsView() {
  const [contacts, setContacts] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', firstName: '', lastName: '', tags: '' });
  const [importData, setImportData] = useState('');

  useEffect(() => { loadContacts(); }, [search]);

  async function loadContacts() {
    const params: Record<string, string> = {};
    if (search) params.search = search;
    const res = await api.getContacts(params);
    setContacts(res.data);
    setPagination(res.pagination);
  }

  async function handleCreate() {
    await api.createContact({
      ...createForm,
      tags: createForm.tags ? createForm.tags.split(',').map(t => t.trim()) : [],
    });
    setShowCreate(false);
    setCreateForm({ email: '', firstName: '', lastName: '', tags: '' });
    loadContacts();
  }

  async function handleImport() {
    try {
      const lines = importData.trim().split('\n').filter(l => l.trim());
      const contacts = lines.map(line => {
        const parts = line.split(',').map(p => p.trim());
        return { email: parts[0], firstName: parts[1] || undefined, lastName: parts[2] || undefined };
      });
      await api.importContacts(contacts);
      setShowImport(false);
      setImportData('');
      loadContacts();
    } catch (err: any) {
      alert(err.message);
    }
  }

  const subscriptionBadge = (status: string) => {
    const map: Record<string, string> = { subscribed: 'badge-success', unsubscribed: 'badge-neutral', bounced: 'badge-error' };
    return map[status] || 'badge-neutral';
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="page-subtitle">{pagination?.total?.toLocaleString() || 0} total contacts</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={() => setShowImport(true)}>Import CSV</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Add Contact</button>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '24px' }}>
        <input
          className="form-input"
          placeholder="Search by email, name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: '400px' }}
        />
      </div>

      <div className="card">
        {contacts.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Email</th><th>Name</th><th>Status</th><th>Lead Score</th><th>Tags</th><th>Added</th></tr>
              </thead>
              <tbody>
                {contacts.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.email}</td>
                    <td>{[c.first_name, c.last_name].filter(Boolean).join(' ') || '-'}</td>
                    <td><span className={`badge ${subscriptionBadge(c.subscription_status)}`}>{c.subscription_status}</span></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="progress-bar" style={{ width: '60px' }}>
                          <div className="progress-fill" style={{ width: `${Math.min(c.lead_score, 100)}%` }} />
                        </div>
                        <span style={{ fontSize: '13px' }}>{c.lead_score}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {(c.tags || []).slice(0, 3).map((tag: string) => (
                          <span key={tag} className="badge badge-neutral" style={{ fontSize: '11px' }}>{tag}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No contacts yet</h3>
            <p>Add contacts manually or import from CSV.</p>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Add Contact</h2>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={createForm.email} onChange={e => setCreateForm({ ...createForm, email: e.target.value })} required />
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">First Name</label>
                <input className="form-input" value={createForm.firstName} onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Last Name</label>
                <input className="form-input" value={createForm.lastName} onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Tags (comma-separated)</label>
              <input className="form-input" value={createForm.tags} onChange={e => setCreateForm({ ...createForm, tags: e.target.value })} placeholder="e.g., lead, newsletter, vip" />
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate}>Add Contact</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Import Contacts</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '16px' }}>
              Paste CSV data: email, first_name, last_name (one per line)
            </p>
            <div className="form-group">
              <textarea
                className="form-textarea"
                value={importData}
                onChange={e => setImportData(e.target.value)}
                rows={10}
                placeholder="john@example.com, John, Doe&#10;jane@example.com, Jane, Smith"
              />
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowImport(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleImport}>Import</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
