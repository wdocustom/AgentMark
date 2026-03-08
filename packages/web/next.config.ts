import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@agentmark/shared', '@agentmark/api'],
  async rewrites() {
    // In development with a separate API server, proxy API calls
    if (process.env.API_URL) {
      return [
        {
          source: '/api/:path*',
          destination: `${process.env.API_URL}/api/:path*`,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
