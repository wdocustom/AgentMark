import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AgentMark - Agentic Marketing Platform',
  description: 'AI-powered marketing automation built from the ground up',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
