import type { IncomingMessage, ServerResponse } from 'http';

let app: any;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!app) {
    const mod = await import('../packages/api/src/index.js');
    app = mod.default;
  }
  return app(req, res);
}
