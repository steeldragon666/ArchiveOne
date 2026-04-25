import pino from 'pino';

export interface LoggerInit {
  serviceName: string;
  level?: pino.Level;
}

/**
 * Create a structured logger.
 *
 * Defaults to level `info`; override via `init.level` or the LOG_LEVEL env var.
 * Output is JSON to stdout (Grafana / log aggregators ingest this directly).
 *
 * Timestamps use ISO 8601 with offset (matches the @cpa/schemas Iso8601 contract).
 */
export function createLogger(init: LoggerInit): pino.Logger {
  return pino({
    name: init.serviceName,
    level: init.level ?? (process.env.LOG_LEVEL as pino.Level) ?? 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}
