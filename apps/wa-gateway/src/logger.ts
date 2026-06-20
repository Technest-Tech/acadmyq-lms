import pino from 'pino'
import { loadConfig } from './config.js'

const config = loadConfig()

/**
 * Redaction paths shared by the app logger and Fastify's request logger so tokens, WhatsApp
 * credentials, signal keys and QR payloads can never leak into the log stream
 * (journald/`/var/log/wa-gateway.log`).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-gateway-admin"]',
  'token',
  'tokenHash',
  '*.token',
  'creds',
  '*.creds',
  'keys',
  '*.keys',
  'key_data',
  'qr',
  '*.qr',
]

/** Process-wide pino logger for application (non-HTTP) code. */
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: REDACT_PATHS,
    censor: '[redacted]',
  },
  ...(config.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
    : {}),
})

export type Logger = typeof logger
