'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function OverviewView() {
  const [overview, setOverview] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);
  const [period, setPeriod] = useState('7d');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [period]);

  async function loadData() {
    setLoading(true);
    try {
      const [analyticsRes, agentsRes, tasksRes] = await Promise.all([
        api.getAnalyticsOverview(period).catch(() => null),
        api.getAgents().catch(() => ({ data: [] })),
        api.getAgentTasks({ pageSize: '5' }).catch(() => ({ data: [] })),
      ]);
      setOverview(analyticsRes?.data || null);
      setAgents(agentsRes.data);
      setRecentTasks(tasksRes.data);
    } catch {
      // Silent fail for dashboard overview
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Your marketing command center</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {['today', '7d', '30d', '90d'].map(p => (
            <button
              key={p}
              className={`btn btn-sm ${period === p ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPeriod(p)}
            >
              {p === 'today' ? 'Today' : p}
            </button>
          ))}
        </div>
      </div>

      {/* Key Metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total Events</div>
          <div className="metric-value">{overview?.totalEvents?.toLocaleString() || '0'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Unique Visitors</div>
          <div className="metric-value">{overview?.uniqueVisitors?.toLocaleString() || '0'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Active Agents</div>
          <div className="metric-value">{agents.filter(a => a.status === 'running').length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Tasks Completed</div>
          <div className="metric-value">
            {agents.reduce((s: number, a: any) => s + (a.metrics?.tasksCompleted || 0), 0)}
          </div>
        </div>
      </div>

      <div className="grid-2">
        {/* Traffic Timeline */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Traffic Overview</h3>
          </div>
          {overview?.timeline?.length > 0 ? (
            <div className="bar-chart">
              {overview.timeline.map((d: any, i: number) => {
                const max = Math.max(...overview.timeline.map((t: any) => parseInt(t.events) || 1));
                const height = Math.max(4, (parseInt(d.events) / max) * 100);
                return (
                  <div
                    key={i}
                    className="bar"
                    style={{ height: `${height}%` }}
                    title={`${new Date(d.date).toLocaleDateString()}: ${d.events} events`}
                  />
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <p>No traffic data yet. Add the tracking script to start collecting data.</p>
            </div>
          )}
        </div>

        {/* Top Events */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Top Events</h3>
          </div>
          {overview?.topEvents?.length > 0 ? (
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Event</th><th>Count</th></tr>
                </thead>
                <tbody>
                  {overview.topEvents.slice(0, 5).map((e: any, i: number) => (
                    <tr key={i}>
                      <td>{e.event}</td>
                      <td>{parseInt(e.count).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state"><p>No events recorded yet.</p></div>
          )}
        </div>
      </div>

      {/* AI Agents Status */}
      <div className="card" style={{ marginTop: '24px' }}>
        <div className="card-header">
          <h3 className="card-title">AI Agents</h3>
        </div>
        {agents.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Agent</th><th>Type</th><th>Status</th><th>Tasks Done</th><th>Errors</th></tr>
              </thead>
              <tbody>
                {agents.map((a: any) => (
                  <tr key={a.id}>
                    <td style={{ fontWeight: 500 }}>{a.name}</td>
                    <td><span className="badge badge-info">{a.type}</span></td>
                    <td>
                      <div className="agent-status">
                        <span className={`status-dot ${a.status}`} />
                        {a.status}
                      </div>
                    </td>
                    <td>{a.metrics?.tasksCompleted || 0}</td>
                    <td>{a.metrics?.tasksErrored || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No agents configured</h3>
            <p>Register to automatically create your AI marketing agents.</p>
          </div>
        )}
      </div>

      {/* Recent Tasks */}
      {recentTasks.length > 0 && (
        <div className="card" style={{ marginTop: '24px' }}>
          <div className="card-header">
            <h3 className="card-title">Recent Agent Tasks</h3>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Task</th><th>Agent</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {recentTasks.map((t: any) => (
                  <tr key={t.id}>
                    <td>{t.type}</td>
                    <td>{t.agent_name}</td>
                    <td>
                      <span className={`badge ${
                        t.status === 'completed' ? 'badge-success' :
                        t.status === 'running' ? 'badge-warning' :
                        t.status === 'failed' ? 'badge-error' : 'badge-neutral'
                      }`}>
                        {t.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{new Date(t.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
