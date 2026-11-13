import winston from 'winston';
import { env } from '../config/env.js';

/** Structured JSON logs in production, readable coloured logs in development. */
export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format:
    env.NODE_ENV === 'production'
      ? winston.format.combine(winston.format.timestamp(), winston.format.json())
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf(({ level, message, timestamp, ...meta }) => {
            const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} ${level} ${message}${extra}`;
          }),
        ),
  transports: [new winston.transports.Console({ silent: env.NODE_ENV === 'test' })],
});
