import pino, { type Logger } from 'pino';
import type { ServiceName } from './services';

/**
 * Stats is a job, so it has no Fastify instance and therefore no Fastify
 * logger — but its lines still have to come out in the same shape as everything
 * else, or a six-service trace has a hole in it.
 */
export function createJobLogger(name: ServiceName): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    messageKey: 'message',
    base: { service: name },
    formatters: {
      level: (label) => ({ severity: label.toUpperCase() }),
    },
  });
}
