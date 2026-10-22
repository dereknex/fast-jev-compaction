import { describe, expect, it } from 'vitest';
import { JevRequestError } from '@dereknex/jev-compaction';

import { errorSummary } from '../src/diagnostics.js';

describe('diagnostic error summaries', () => {
  it('removes credentials, URLs and terminal controls before bounding messages', () => {
    const error = new Error('KEYVALUE Bearer bearer-secret token="quoted secret" api_key=field-secret https://example.test/?key=url-secret\n\x1b[31m failed ' + 'x'.repeat(500));
    const summary = errorSummary(error, ['KEYVALUE']);
    expect(summary.type).toBe('Error');
    expect(summary.message).toContain('failed');
    expect(summary.message.length).toBeLessThanOrEqual(300);
    for (const secret of ['KEYVALUE', 'bearer-secret', 'quoted secret', 'field-secret', 'url-secret', 'example.test', '\n', '\x1b']) {
      expect(summary.message).not.toContain(secret);
    }
    expect(summary).not.toHaveProperty('stack');
  });

  it('excludes HTTP response bodies even if they echo the request', () => {
    expect(errorSummary(new JevRequestError('private conversation and request body', 503), [])).toEqual({
      type: 'JevRequestError', message: 'Jev request failed (HTTP 503)', status: 503,
    });
  });
});
