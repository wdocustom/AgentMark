'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Dashboard } from '@/components/dashboard/Dashboard';

export default function Home() {
  const { user, loading, login, register, logout, isAuthenticated } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
      </div>
    );
  }

  if (isAuthenticated && user) {
    return <Dashboard user={user} onLogout={logout} />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (authMode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name, orgName);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-title">
          <span style={{ background: 'linear-gradient(135deg, #6366f1, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            AgentMark
          </span>
        </div>
        <p className="login-subtitle">
          {authMode === 'login' ? 'Sign in to your account' : 'Create your marketing platform'}
        </p>

        <form onSubmit={handleSubmit}>
          {authMode === 'register' && (
            <>
              <div className="form-group">
                <label className="form-label">Your Name</label>
                <input className="form-input" type="text" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Organization Name</label>
                <input className="form-input" type="text" value={orgName} onChange={e => setOrgName(e.target.value)} required />
              </div>
            </>
          )}

          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
          </div>

          {error && (
            <div style={{ color: 'var(--error)', fontSize: '14px', marginBottom: '16px' }}>{error}</div>
          )}

          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
            {submitting ? 'Please wait...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '14px', color: 'var(--text-muted)' }}>
          {authMode === 'login' ? (
            <>New here? <button className="btn-ghost" onClick={() => setAuthMode('register')} style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}>Create an account</button></>
          ) : (
            <>Already have an account? <button className="btn-ghost" onClick={() => setAuthMode('login')} style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}>Sign in</button></>
          )}
        </div>
      </div>
    </div>
  );
}
