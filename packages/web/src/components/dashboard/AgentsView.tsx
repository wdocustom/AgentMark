'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function AgentsView() {
  const [agents, setAgents] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskForm, setTaskForm] = useState({ agentType: 'content_writer', taskType: 'generate_content', input: '' });
  const [submitting, setSubmitting] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const [agentsRes, tasksRes] = await Promise.all([
      api.getAgents().catch(() => ({ data: [] })),
      api.getAgentTasks({ pageSize: '20' }).catch(() => ({ data: [] })),
    ]);
    setAgents(agentsRes.data);
    setTasks(tasksRes.data);
  }

  async function submitTask() {
    setSubmitting(true);
    try {
      let parsedInput = {};
      try { parsedInput = JSON.parse(taskForm.input); } catch { parsedInput = { topic: taskForm.input }; }

      await api.submitAgentTask(taskForm.agentType, taskForm.taskType, parsedInput);
      setShowTaskModal(false);
      setTaskForm({ agentType: 'content_writer', taskType: 'generate_content', input: '' });
      setTimeout(loadData, 1000);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function viewTaskResult(taskId: string) {
    const res = await api.getTaskResult(taskId);
    setSelectedTask(res.data);
  }

  const taskTypesByAgent: Record<string, { value: string; label: string }[]> = {
    content_writer: [
      { value: 'generate_content', label: 'Generate Content' },
      { value: 'generate_variations', label: 'Generate Variations' },
      { value: 'generate_subject_lines', label: 'Generate Subject Lines' },
    ],
    campaign_manager: [
      { value: 'launch_campaign', label: 'Launch Campaign' },
      { value: 'optimize_send_time', label: 'Optimize Send Time' },
      { value: 'auto_segment', label: 'Auto-Segment Audience' },
      { value: 'campaign_report', label: 'Generate Report' },
    ],
    analytics_analyst: [
      { value: 'traffic_analysis', label: 'Traffic Analysis' },
      { value: 'conversion_analysis', label: 'Conversion Analysis' },
      { value: 'audience_insights', label: 'Audience Insights' },
      { value: 'predict_trends', label: 'Predict Trends' },
      { value: 'create_report', label: 'Create Report' },
    ],
    seo_optimizer: [
      { value: 'audit_content', label: 'SEO Audit' },
      { value: 'keyword_analysis', label: 'Keyword Analysis' },
      { value: 'optimize_content', label: 'Optimize Content' },
    ],
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">AI Agents</h1>
          <p className="page-subtitle">Your autonomous marketing workforce</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowTaskModal(true)}>
          + New Task
        </button>
      </div>

      {/* Agent Cards */}
      <div className="grid-2" style={{ marginBottom: '24px' }}>
        {agents.map(agent => (
          <div key={agent.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ fontWeight: 600, marginBottom: '4px' }}>{agent.name}</h3>
                <span className="badge badge-info">{agent.type}</span>
              </div>
              <div className="agent-status">
                <span className={`status-dot ${agent.status}`} />
                {agent.status}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginTop: '20px' }}>
              <div>
                <div className="metric-label">Completed</div>
                <div style={{ fontSize: '20px', fontWeight: 600 }}>{agent.metrics?.tasksCompleted || 0}</div>
              </div>
              <div>
                <div className="metric-label">Errors</div>
                <div style={{ fontSize: '20px', fontWeight: 600, color: agent.metrics?.tasksErrored > 0 ? 'var(--error)' : 'inherit' }}>
                  {agent.metrics?.tasksErrored || 0}
                </div>
              </div>
              <div>
                <div className="metric-label">Tokens</div>
                <div style={{ fontSize: '20px', fontWeight: 600 }}>{(agent.metrics?.tokensUsed || 0).toLocaleString()}</div>
              </div>
            </div>

            {agent.capabilities?.length > 0 && (
              <div style={{ marginTop: '16px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {agent.capabilities.map((cap: string) => (
                  <span key={cap} className="badge badge-neutral" style={{ fontSize: '11px' }}>{cap}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Task History */}
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Task History</h3>
        </div>
        {tasks.length > 0 ? (
          <div className="table-container">
            <table>
              <thead>
                <tr><th>Task</th><th>Agent</th><th>Status</th><th>Created</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <tr key={task.id}>
                    <td style={{ fontWeight: 500 }}>{task.type}</td>
                    <td>{task.agent_name}</td>
                    <td>
                      <span className={`badge ${
                        task.status === 'completed' ? 'badge-success' :
                        task.status === 'running' ? 'badge-warning' :
                        task.status === 'failed' ? 'badge-error' : 'badge-neutral'
                      }`}>{task.status}</span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{new Date(task.created_at).toLocaleString()}</td>
                    <td>
                      {task.status === 'completed' && (
                        <button className="btn btn-ghost btn-sm" onClick={() => viewTaskResult(task.id)}>View Result</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <h3>No tasks yet</h3>
            <p>Submit a task to your AI agents to get started.</p>
          </div>
        )}
      </div>

      {/* New Task Modal */}
      {showTaskModal && (
        <div className="modal-overlay" onClick={() => setShowTaskModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Submit Agent Task</h2>

            <div className="form-group">
              <label className="form-label">Agent</label>
              <select className="form-select" value={taskForm.agentType} onChange={e => setTaskForm({ ...taskForm, agentType: e.target.value, taskType: taskTypesByAgent[e.target.value]?.[0]?.value || '' })}>
                <option value="content_writer">Content Writer</option>
                <option value="campaign_manager">Campaign Manager</option>
                <option value="analytics_analyst">Analytics Analyst</option>
                <option value="seo_optimizer">SEO Optimizer</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Task Type</label>
              <select className="form-select" value={taskForm.taskType} onChange={e => setTaskForm({ ...taskForm, taskType: e.target.value })}>
                {(taskTypesByAgent[taskForm.agentType] || []).map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Input (JSON or plain text topic)</label>
              <textarea
                className="form-textarea"
                value={taskForm.input}
                onChange={e => setTaskForm({ ...taskForm, input: e.target.value })}
                placeholder='{"type": "blog_post", "topic": "AI in Marketing", "keywords": ["AI", "marketing"]}'
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowTaskModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitTask} disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Task Result Modal */}
      {selectedTask && (
        <div className="modal-overlay" onClick={() => setSelectedTask(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <h2 className="modal-title">Task Result</h2>
            <div style={{ marginBottom: '12px' }}>
              <span className={`badge ${selectedTask.status === 'completed' ? 'badge-success' : 'badge-error'}`}>{selectedTask.status}</span>
              <span style={{ marginLeft: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>{selectedTask.type}</span>
            </div>
            {selectedTask.output && (
              <pre style={{
                background: 'var(--bg-primary)',
                padding: '16px',
                borderRadius: '8px',
                overflow: 'auto',
                maxHeight: '400px',
                fontSize: '13px',
                lineHeight: 1.5,
              }}>
                {JSON.stringify(selectedTask.output, null, 2)}
              </pre>
            )}
            {selectedTask.error && (
              <div style={{ color: 'var(--error)', marginTop: '12px' }}>{selectedTask.error}</div>
            )}
            <div style={{ marginTop: '20px', textAlign: 'right' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedTask(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
