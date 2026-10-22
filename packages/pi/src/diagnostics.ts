import { JevRequestError, type DecisionProgress } from '@dereknex/jev-compaction';

import type { RunMode } from './machine.js';

export const DIAGNOSTIC_ENTRY_TYPE = 'fast-jev-diagnostics';

export interface DiagnosticEntryData {
  version: 1;
  outcome: 'failed' | 'cancelled';
  backend: string;
  model: string;
  mode: RunMode;
  stage: DecisionProgress['stage'] | 'preparing' | 'key' | 'client' | 'persisting';
  stateTokens?: number;
  stateStage?: string;
  batches?: number;
  /** The model's input token window the run was budgeted against. */
  contextWindow?: number;
  ms: number;
  error?: { type: string; message: string; status?: number };
}

export function errorSummary(
  error: unknown,
  secrets: readonly string[],
): NonNullable<DiagnosticEntryData['error']> {
  const redact = (value: string): string => {
    for (const secret of secrets) {
      if (secret) value = value.split(secret).join('[redacted]');
    }
    return value
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
      .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
      .replace(/(["']?(?:api[_-]?key|token|authorization|password|secret)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1[redacted]')
      .replace(/[\x00-\x1f\x7f-\x9f]/g, ' ')
      .slice(0, 300);
  };
  return {
    type: redact(error instanceof Error ? error.name : 'UnknownError'),
    message: redact(
      error instanceof JevRequestError
        ? `Jev request failed (HTTP ${error.status})`
        : error instanceof Error ? error.message : 'Unknown decision error',
    ),
    ...(error instanceof JevRequestError ? { status: error.status } : {}),
  };
}
