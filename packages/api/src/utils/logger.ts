import pino from 'pino';

const isServerless = !!process.env.VERCEL;

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // pino-pretty uses worker threads which crash in serverless
  transport:
    !isServerless && process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
