'use client';

import { useState } from 'react';
import { OverviewView } from './OverviewView';
import { ContentView } from '../content/ContentView';
import { CampaignsView } from '../campaigns/CampaignsView';
import { AnalyticsView } from '../analytics/AnalyticsView';
import { ContactsView } from '../campaigns/ContactsView';
import { AgentsView } from '../dashboard/AgentsView';

interface DashboardProps {
  user: { id: string; email: string; name: string; role: string };
  onLogout: () => void;
}

type View = 'overview' | 'content' | 'campaigns' | 'analytics' | 'contacts' | 'agents';

export function Dashboard({ user, onLogout }: DashboardProps) {
  const [activeView, setActiveView] = useState<View>('overview');

  const navItems: { id: View; label: string; icon: string; section?: string }[] = [
    { id: 'overview', label: 'Dashboard', icon: '◫' },
    { id: 'content', label: 'Content', icon: '✎', section: 'Marketing' },
    { id: 'campaigns', label: 'Campaigns', icon: '⚡' },
    { id: 'contacts', label: 'Contacts', icon: '◉' },
    { id: 'analytics', label: 'Analytics', icon: '◰', section: 'Intelligence' },
    { id: 'agents', label: 'AI Agents', icon: '⚙' },
  ];

  const renderView = () => {
    switch (activeView) {
      case 'overview': return <OverviewView />;
      case 'content': return <ContentView />;
      case 'campaigns': return <CampaignsView />;
      case 'analytics': return <AnalyticsView />;
      case 'contacts': return <ContactsView />;
      case 'agents': return <AgentsView />;
      default: return <OverviewView />;
    }
  };

  let lastSection = '';

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span>AgentMark</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => {
            const showSection = item.section && item.section !== lastSection;
            if (item.section) lastSection = item.section;

            return (
              <div key={item.id}>
                {showSection && <div className="nav-section">{item.section}</div>}
                <div
                  className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                  onClick={() => setActiveView(item.id)}
                >
                  <span style={{ fontSize: '18px', width: '24px', textAlign: 'center' }}>{item.icon}</span>
                  {item.label}
                </div>
              </div>
            );
          })}
        </nav>

        <div style={{ padding: '16px 12px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 600 }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onLogout} style={{ fontSize: '12px' }}>
              Exit
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {renderView()}
      </main>
    </div>
  );
}
