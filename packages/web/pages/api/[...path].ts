import type { NextApiRequest, NextApiResponse } from 'next';

let app: any;

async function getApp() {
  if (!app) {
    const mod = await import('@agentmark/api');
    app = mod.default;
  }
  return app;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const expressApp = await getApp();
  return expressApp(req, res);
}

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
