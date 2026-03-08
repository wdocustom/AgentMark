'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function AnalyticsView() {
  const [overview, setOverview] = useState<any>(null);
  const [realtime, setRealtime] = useState<any>(null);
  const [period, setPeriod] = useState('7d');
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => { loadData(); }, [period]);
  useEffect(() => {
    if (activeTab === 'realtime') {
      loadRealtime();
      const interval = setInterval(loadRealtime, 10000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  async function loadData() {
    const res = await api.getAnalyticsOverview(period).catch(() => null);
    setOverview(res?.data || null);
  }

  async function loadRealtime() {
    const res = await api.getRealtime().catch(() => null);
    setRealtime(res?.data || null);
  }

  async function runAIAnalysis(type: string) {
    await api.submitAgentTask('analytics_analyst', type, { period });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Data-driven insights powered by AI</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {['today', '7d', '30d', '90d'].map(p => (
            <button key={p} className={`btn btn-sm ${period === p ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setPeriod(p)}>
              {p === 'today' ? 'Today' : p}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'realtime', label: 'Real-time' },
          { id: 'ai', label: 'AI Insights' },
        ].map(tab => (
          <div key={tab.id} className={`tab ${activeTab === tab.id ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </div>
        ))}
      </div>

      {activeTab === 'overview' && (
        <>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">Total Events</div>
              <div className="metric-value">{overview?.totalEvents?.toLocaleString() || '0'}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Unique Visitors</div>
              <div className="metric-value">{overview?.uniqueVisitors?.toLocaleString() || '0'}</div>
            </div>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-header"><h3 className="card-title">Traffic Timeline</h3></div>
              {overview?.timeline?.length > 0 ? (
                <div className="bar-chart">
                  {overview.timeline.map((d: any, i: number) => {
                    const max = Math.max(...overview.timeline.map((t: any) => parseInt(t.visitors) || 1));
                    const height = Math.max(4, (parseInt(d.visitors) / max) * 100);
                    return <div key={i} className="bar" style={{ height: `${height}%` }} title={`${new Date(d.date).toLocaleDateString()}: ${d.visitors} visitors`} />;
                  })}
                </div>
              ) : <div className="empty-state"><p>No data available</p></div>}
            </div>

            <div className="card">
              <div className="card-header"><h3 className="card-title">Top Pages</h3></div>
              {overview?.topPages?.length > 0 ? (
                <div className="table-container">
                  <table>
                    <thead><tr><th>Page</th><th>Views</th><th>Unique</th></tr></thead>
                    <tbody>
                      {overview.topPages.slice(0, 8).map((p: any, i: number) => (
                        <tr key={i}>
                          <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.page}</td>
                          <td>{parseInt(p.views).toLocaleString()}</td>
                          <td>{parseInt(p.unique_visitors).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="empty-state"><p>No page data</p></div>}
            </div>
          </div>

          <div className="card" style={{ marginTop: '24px' }}>
            <div className="card-header"><h3 className="card-title">Top Events</h3></div>
            {overview?.topEvents?.length > 0 ? (
              <div className="table-container">
                <table>
                  <thead><tr><th>Event</th><th>Count</th><th>Share</th></tr></thead>
                  <tbody>
                    {overview.topEvents.map((e: any, i: number) => {
                      const total = overview.totalEvents || 1;
                      const pct = Math.round((parseInt(e.count) / total) * 100);
                      return (
                        <tr key={i}>
                          <td style={{ fontWeight: 500 }}>{e.event}</td>
                          <td>{parseInt(e.count).toLocaleString()}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div className="progress-bar" style={{ width: '80px' }}>
                                <div className="progress-fill" style={{ width: `${pct}%` }} />
                              </div>
                              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{pct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty-state"><p>No events recorded</p></div>}
          </div>
        </>
      )}

      {activeTab === 'realtime' && (
        <>
          <div className="metrics-grid">
            <div className="metric-card">
              <div className="metric-label">Active Visitors (5 min)</div>
              <div className="metric-value" style={{ color: 'var(--success)' }}>
                {realtime?.activeVisitors || 0}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Active Sessions</div>
              <div className="metric-value">{realtime?.activeSessions || 0}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Live Event Stream</h3>
              <span className="badge badge-success" style={{ animation: 'pulse 1.5s infinite' }}>LIVE</span>
            </div>
            {realtime?.recentEvents?.length > 0 ? (
              <div className="table-container">
                <table>
                  <thead><tr><th>Event</th><th>Page</th><th>Visitor</th><th>Time</th></tr></thead>
                  <tbody>
                    {realtime.recentEvents.map((e: any, i: number) => (
                      <tr key={i}>
                        <td><span className="badge badge-info">{e.event}</span></td>
                        <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.page || '-'}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{e.visitor_id.substring(0, 12)}...</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{new Date(e.timestamp).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state"><p>No recent activity</p></div>
            )}
          </div>
        </>
      )}

      {activeTab === 'ai' && (
        <div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
            Let AI agents analyze your data and generate actionable insights.
          </p>
          <div className="grid-3">
            {[
              { type: 'traffic_analysis', title: 'Traffic Analysis', desc: 'Deep dive into traffic patterns, sources, and device breakdown' },
              { type: 'conversion_analysis', title: 'Conversion Analysis', desc: 'Analyze conversion funnels and identify optimization opportunities' },
              { type: 'audience_insights', title: 'Audience Insights', desc: 'Understand your audience segments, retention, and engagement' },
              { type: 'predict_trends', title: 'Predict Trends', desc: 'AI-powered traffic and engagement predictions for the next 7 days' },
              { type: 'create_report', title: 'Full Report', desc: 'Generate a comprehensive analytics report with dashboard' },
            ].map(item => (
              <div key={item.type} className="card" style={{ cursor: 'pointer' }} onClick={() => runAIAnalysis(item.type)}>
                <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>{item.title}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '16px' }}>{item.desc}</p>
                <button className="btn btn-secondary btn-sm">Run Analysis</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
