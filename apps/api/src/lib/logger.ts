// Structured logger (pino): the house contract, identical across the home apps
// so one Loki query works for all of them (homework ADR 0003):
//
//   log.info({ event, req_id, latency_ms, ... }, "static message")
//
// One JSON object per line on stdout; the Alloy DaemonSet tails it into Loki
// and labels by namespace/pod/container. The message is STATIC — anything that
// varies goes in a field, or the line cannot be counted, grouped or alerted on.

import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type DestinationStream, type LoggerOptions, pino, stdSerializers } from "pino";

const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name: string; version: string };

// Strip the `@homestorm/` scope so Loki sees a flat label (`homestorm-api`).
const service = pkg.name.replace(/^@[^/]+\//, "homestorm-");

const REDACTED = "[redacted]";

/**
 * What every line inside one request or one seat's turn carries without being
 * told: `{ req_id }`, or `{ meeting_id, message_id }` in the round runner. Set
 * by `withLogContext`, read by the `mixin` below.
 */
const context = new AsyncLocalStorage<Record<string, string>>();

export function withLogContext<T>(fields: Record<string, string>, fn: () => T): T {
  return context.run({ ...context.getStore(), ...fields }, fn);
}

/**
 * pino's standard `err` serializer, minus bound query parameters.
 *
 * ⚠️ DrizzleQueryError writes its parameters into the MESSAGE
 * (`Failed query: …\nparams: a,b,c`), so they also land in the stack. Here
 * that's meeting text: a failed INSERT would copy a whole answer into Loki.
 * Redacting the `params` path alone is not enough.
 */
function serializeErr(err: Error) {
  const out = stdSerializers.err(err);
  // Walk the cause chain: pino folds each cause's message + stack into ours.
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    const params = (e as { params?: unknown }).params;
    if (!Array.isArray(params) || params.length === 0) continue;
    const leaked = `\nparams: ${params}`;
    out.message = out.message.replaceAll(leaked, `\nparams: ${REDACTED}`);
    out.stack = out.stack?.replaceAll(leaked, `\nparams: ${REDACTED}`);
  }
  if ("params" in out) out.params = REDACTED;
  return out;
}

export const loggerOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  base: { service, version: pkg.version },
  timestamp: pino.stdTimeFunctions.isoTime,
  /**
   * ★ `"level":"info"`, not pino's default `"level":30`. Loki recognises the
   * word and sets `detected_level`, which Grafana's level colours and filters
   * use. Query with `| json | level="error"`.
   */
  formatters: { level: (label) => ({ level: label }) },
  // ⚠️ A COPY of the store: pino merges each line's fields INTO the mixin's
  // return value (`Object.assign(mixin, fields)`), so returning the store
  // itself would leak one line's `status`/`err` onto every later line.
  mixin: () => ({ ...context.getStore() }),
  serializers: { err: serializeErr },
  /**
   * Credentials must never reach Loki. pino redacts by PATH, not by value: it
   * cannot censor a secret interpolated into a message string — so never put
   * one in a message, always in a field.
   */
  redact: {
    paths: [
      "password",
      "*.password",
      "newPassword",
      "*.newPassword",
      "currentPassword",
      "*.currentPassword",
    ],
    censor: REDACTED,
  },
};

/** The same logger writing somewhere else — for tests that read the JSON back. */
export function createLogger(destination?: DestinationStream) {
  return destination ? pino(loggerOptions, destination) : pino(loggerOptions);
}

export const log = createLogger();
