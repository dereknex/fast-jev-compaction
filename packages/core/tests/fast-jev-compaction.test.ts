import { describe, expect, it } from 'vitest';
import {
  applyDecisions,
  batchCalls,
  buildJevRequest,
  CLOUDFLARE_CLEF_FLASH_MODEL,
  CLOUDFLARE_CLEF_MODEL,
  collectToolCalls,
  compact,
  compactMessages,
  decideCall,
  estimateTokens,
  fitState,
  inferBackend,
  isCloudflareModel,
  JevClient,
  MAX_CALLS_PER_BATCH,
  missingKeyMessage,
  normalizeCloudflareModel,
  parseJevResponse,
  reductionRatio,
  resolveEndpoint,
  resolveOptions,
  type HistoryToolCall,
  type JevAsker,
  type JevQuestions,
  type Message,
  type ToolCall,
} from '../src/index.js';

function message(role: Message['role'], text: string, extra: Partial<Message> = {}): Message {
  return { role, text, toolUses: [], ...extra };
}

function call(id: string, tool: string, input: Record<string, unknown>, text: string): Message {
  return message('assistant', '', { toolUses: [{ tool_use_id: id, tool, input, text }] });
}

function result(id: string, text: string, isError = false): Message {
  return message('user', '', { toolResults: [{ tool_use_id: id, text, isError }] });
}

const fileA = 'export const a = 1;\n'.repeat(50);
const fileB = 'export const b = 2;\n'.repeat(50);

function transcript(): Message[] {
  return [
    message('user', 'Never edit anything under src/generated. Fix the failing test.'),
    call('tool-1', 'Read', { file_path: 'src/a.ts' }, fileA),
    result('tool-1', fileA),
    message('assistant', 'a.ts looks fine; checking b.ts'),
    call('tool-2', 'Read', { file_path: 'src/b.ts' }, fileB),
    result('tool-2', fileB),
    call('tool-3', 'Bash', { command: 'npm test' }, 'FAIL b.test.ts'),
    result('tool-3', 'FAIL b.test.ts: expected 2 to be 3', true),
    message('assistant', 'The failure is in b.test.ts; fixing now.'),
    message('user', 'go ahead'),
  ];
}

type Seen = { state: unknown; questions: string[] };

function fakeJev(answer: (name: string) => number, seen: Seen[] = []): JevAsker {
  return {
    async ask(state, questions: JevQuestions) {
      seen.push({ state, questions: Object.keys(questions) });
      return {
        answers: Object.fromEntries(
          Object.keys(questions).map((key) => [key, { type: 'noul' as const, noul: answer(key) }]),
        ),
      };
    },
  };
}

const fit = {
  maxStateTokens: 25_000,
  preserveRecentMessages: 0,
  goal: 'fix the test',
};

describe('options', () => {
  it('fills in defaults and ignores non-finite values', () => {
    expect(resolveOptions()).toMatchObject({
      keepThreshold: 0.5,
      preserveRecentMessages: 6,
      maxStateTokens: 25_000,
      maxRequestTokens: 30_000,
      truncateHeadChars: 300,
    });
    expect(resolveOptions({
      keepThreshold: Number.NaN,
      preserveRecentMessages: 2.7,
      truncateHeadChars: -1.2,
    })).toMatchObject({
      keepThreshold: 0.5,
      preserveRecentMessages: 2,
      truncateHeadChars: 0,
    });
  });
});

describe('token estimate', () => {
  it('charges words, digits and symbols separately and never undercounts JSON badly', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello world')).toBe(2);
    expect(estimateTokens('internationalization')).toBe(4);
    expect(estimateTokens('12345678')).toBe(4);
    const json = JSON.stringify({ file_path: '/Users/x/src/a.ts', old_string: 'a = 1;', n: 42 });
    expect(estimateTokens(json)).toBeGreaterThanOrEqual(Math.ceil(json.length / 3));
  });
});

describe('tool call collection', () => {
  it('pairs each tool call with its result and pins recent ones', () => {
    const calls = collectToolCalls(transcript(), 3);
    expect(calls.map((c) => [c.id, c.tool, c.callIndex, c.resultIndex, c.pinned])).toEqual([
      ['t1', 'Read', 1, 2, false],
      ['t2', 'Read', 4, 5, false],
      ['t3', 'Bash', 6, 7, true],
    ]);
    expect(calls[2]?.isError).toBe(true);
    expect(calls[0]?.resultChars).toBe(fileA.length);
  });

  it('ignores calls without a result', () => {
    expect(collectToolCalls([message('user', 'hi'), call('x', 'Read', {}, '')], 0)).toHaveLength(0);
  });
});

describe('state fitting', () => {
  it('sends the whole history with tool results replaced by a note', () => {
    const messages = transcript();
    const { state, stage } = fitState(messages, collectToolCalls(messages, 0), fit);
    expect(stage).toBe('full');
    const json = JSON.stringify(state);
    expect(json).not.toContain('export const a = 1;');
    expect(json).toContain('Never edit anything under src/generated');
    expect(json).toContain('go ahead');
    expect(state.history.map((entry) => entry.i)).toEqual([0, 1, 3, 4, 6, 8, 9]);
    expect(state.history[1]?.tool_calls?.[0]).toMatchObject({
      id: 't1',
      tool: 'Read',
      result: `ok, ${fileA.length} chars (omitted)`,
    });
    expect((state.history[4]?.tool_calls?.[0] as HistoryToolCall).result).toMatch(/^error, /);
  });

  it('defaults the goal to the latest user prompts', () => {
    const { state } = fitState(transcript(), [], { ...fit, goal: '' });
    expect(state.goal).toContain('Fix the failing test');
    expect(state.goal).toContain('go ahead');
  });

  it('truncates tool inputs before touching message text', () => {
    const messages = [
      message('user', 'start'),
      call('w', 'Write', { file_path: 'x.ts', content: 'x'.repeat(5000) }, 'ok'),
      result('w', 'ok'),
      message('assistant', 'written'),
    ];
    const { state, stage, tokens } = fitState(messages, collectToolCalls(messages, 0), {
      ...fit,
      maxStateTokens: 300,
    });
    expect(stage).toBe('inputs<=200');
    expect(tokens).toBeLessThanOrEqual(300);
    expect(state.history[0]?.text).toBe('start');
    expect((state.history[1]?.tool_calls?.[0] as HistoryToolCall).input.length).toBeLessThanOrEqual(200);
  });

  it('shrinks old tool calls to one line each when nothing else is left to cut', () => {
    const messages = [message('user', 'start')];
    for (let i = 0; i < 40; i += 1) {
      messages.push(call(`c${i}`, 'Read', { file_path: `/repo/src/module-${i}.ts` }, 'x'), result(`c${i}`, 'x'));
    }
    messages.push(message('assistant', 'done'));
    const calls = collectToolCalls(messages, 1);
    const full = fitState(messages, calls, { ...fit, preserveRecentMessages: 1 });
    const compacted = fitState(messages, calls, {
      ...fit,
      preserveRecentMessages: 1,
      maxStateTokens: Math.floor(full.tokens * 0.8),
    });
    expect(compacted.stage).toBe('old calls compacted');
    expect(compacted.tokens).toBeLessThanOrEqual(Math.floor(full.tokens * 0.8));
    expect(compacted.tokens).toBeGreaterThanOrEqual(estimateTokens(JSON.stringify(compacted.state)));
    expect(compacted.state.history[1]?.tool_calls?.[0]).toBe(
      't1 Read file_path=/repo/src/module-0.ts → ok 1ch',
    );
    expect(compacted.state.history.at(-1)?.text).toBe('done');

    const merged = fitState(messages, calls, {
      ...fit,
      preserveRecentMessages: 1,
      maxStateTokens: Math.floor(full.tokens * 0.45),
    });
    expect(merged.stage).toBe('old calls merged');
    expect(merged.tokens).toBeLessThanOrEqual(Math.floor(full.tokens * 0.45));
    expect(merged.state.history).toHaveLength(3);
    expect(merged.state.history[1]?.tool_calls).toHaveLength(40);
    expect(merged.state.history[1]?.tool_calls?.[39]).toMatch(/^t40 Read /);
    expect(merged.state.history[0]?.text).toBe('start');
    expect(merged.state.history[2]?.text).toBe('done');
  });

  it('abridges long texts oldest-first and collapses old messages last', () => {
    const long = (n: number) => `${n} ` + 'lorem ipsum '.repeat(300);
    const messages = [
      message('user', long(0)),
      message('assistant', long(1)),
      message('user', long(2)),
      message('assistant', long(3)),
      message('user', 'latest'),
    ];
    const abridged = fitState(messages, [], { ...fit, maxStateTokens: 1800, preserveRecentMessages: 1 });
    expect(abridged.stage).toBe('texts abridged');
    expect(abridged.tokens).toBeLessThanOrEqual(1800);
    expect(abridged.state.history[1]?.text).toContain('chars omitted');
    expect(abridged.state.history[0]?.text).toBe(long(0));
    expect(abridged.state.history[4]?.text).toBe('latest');

    const collapsed = fitState(messages, [], { ...fit, maxStateTokens: 420, preserveRecentMessages: 1 });
    expect(collapsed.stage).toBe('old messages collapsed');
    expect(collapsed.tokens).toBeLessThanOrEqual(420);
    expect(collapsed.state.history[1]?.text).toMatch(/^\[… \d+ chars omitted …\]$/);
    expect(collapsed.state.history[0]?.text).toContain('lorem');
    expect(collapsed.state.history[4]?.text).toBe('latest');
  });

  it('throws when the history cannot be fitted', () => {
    const messages = [message('user', 'a'.repeat(2000)), message('assistant', 'b')];
    expect(() => fitState(messages, [], { ...fit, maxStateTokens: 50 })).toThrow(/too large/);
  });
});

describe('question batching', () => {
  const calls: ToolCall[] = Array.from({ length: 10 }, (_, i) => ({
    id: `t${i + 1}`,
    tool_use_id: `tool-${i + 1}`,
    tool: 'Read',
    input: {},
    callIndex: i * 2 + 1,
    resultIndex: i * 2 + 2,
    resultChars: 100,
    isError: false,
    pinned: false,
  }));
  const options = { maxRequestTokens: 30_000 };

  it('puts everything in one request when it fits', () => {
    expect(batchCalls(calls, 1000, options)).toHaveLength(1);
  });

  it('splits questions across requests when the state leaves little room', () => {
    const batches = batchCalls(calls, 29_600, options);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().map((c) => c.id)).toEqual(calls.map((c) => c.id));
  });

  it('throws when a single question does not fit', () => {
    expect(() => batchCalls(calls, 29_990, options)).toThrow(/no room/);
  });
});

describe('decisions', () => {
  const options = { keepThreshold: 0.5 };
  const unpinned = { id: 't1', tool: 'Read', pinned: false };

  it('keeps, drops the result, or drops the call based on the keep probabilities', () => {
    expect(decideCall(unpinned, { keepCall: 0.9, keepResult: 0.7 }, options).action).toBe('keep');
    expect(decideCall(unpinned, { keepCall: 0.9, keepResult: 0.2 }, options).action).toBe('drop_result');
    expect(decideCall(unpinned, { keepCall: 0.1, keepResult: 0.2 }, options).action).toBe('drop_call');
    expect(decideCall({ ...unpinned, pinned: true }, { keepCall: 0, keepResult: 0 }, options)).toMatchObject({
      action: 'keep',
      reason: 'pinned',
    });
  });

  it('removes dropped calls and truncates dropped results', () => {
    const messages = transcript();
    messages[4]!.toolUses[0]!.text = 'x'.repeat(2000);
    messages[5]!.toolResults![0]!.text = 'x'.repeat(2000);
    const calls = collectToolCalls(messages, 0);
    const decisions = [
      decideCall(calls[0]!, { keepCall: 0.1, keepResult: 0.1 }, options),
      decideCall(calls[1]!, { keepCall: 0.9, keepResult: 0.1 }, options),
      decideCall(calls[2]!, { keepCall: 0.9, keepResult: 0.9 }, options),
    ];
    const kept = applyDecisions(messages, decisions, calls, 300);

    expect(kept.map((m) => m.text || m.toolUses[0]?.tool_use_id || m.toolResults?.[0]?.tool_use_id)).toEqual([
      'Never edit anything under src/generated. Fix the failing test.',
      'a.ts looks fine; checking b.ts',
      'tool-2',
      'tool-2',
      'tool-3',
      'tool-3',
      'The failure is in b.test.ts; fixing now.',
      'go ahead',
    ]);
    expect(kept[0]).toBe(messages[0]);
    expect(kept[2]).not.toBe(messages[4]);
    expect(kept[2]?.toolUses[0]?.text).toMatch(
      new RegExp(`^${'x'.repeat(300)}\\n\\[fast-jev-compaction truncated 1700 chars`),
    );
    expect(kept[3]?.toolResults?.[0]?.text).toMatch(
      new RegExp(`^${'x'.repeat(300)}\\n\\[fast-jev-compaction truncated 1700 chars`),
    );
    expect(kept[2]).not.toBe(messages[4]);
    expect(kept[3]).not.toBe(messages[5]);
    expect(kept[4]).toBe(messages[6]);
    expect(kept[5]?.toolResults?.[0]?.text).toContain('expected 2 to be 3');

    const shortMessages = transcript();
    shortMessages[4]!.toolUses[0]!.text = 'y'.repeat(100);
    shortMessages[5]!.toolResults![0]!.text = 'y'.repeat(100);
    const shortKept = applyDecisions(shortMessages, decisions, calls, 300);
    expect(shortKept[2]).toBe(shortMessages[4]);
    expect(shortKept[3]).toBe(shortMessages[5]);
  });

  it('honours truncateHeadChars, including a zero head', () => {
    const messages = transcript();
    const calls = collectToolCalls(messages, 0);
    const decisions = [decideCall(calls[0]!, { keepCall: 0.9, keepResult: 0.1 }, { keepThreshold: 0.5 })];
    const original = messages[2]!.toolResults![0]!.text;
    const total = original.length;

    const kept = applyDecisions(messages, decisions, calls, 50);
    expect(kept[2]?.toolResults?.[0]?.text).toBe(
      `${original.slice(0, 50)}\n[fast-jev-compaction truncated ${total - 50} chars of this tool result; re-run the tool if needed]`,
    );
    expect(kept[1]?.toolUses[0]?.text).toBe(kept[2]?.toolResults?.[0]?.text);

    const noHead = applyDecisions(messages, decisions, calls, 0);
    expect(noHead[2]?.toolResults?.[0]?.text).toBe(
      `[fast-jev-compaction truncated ${total} chars of this tool result; re-run the tool if needed]`,
    );
  });
});

describe('compact', () => {
  it('resends the full state with every batch and merges the answers', async () => {
    const seen: Seen[] = [];
    const messages = transcript();
    const stateTokens = fitState(messages, collectToolCalls(messages, 1), {
      ...fit,
      goal: '',
      preserveRecentMessages: 1,
    }).tokens;
    const output = await compact(
      messages,
      fakeJev((name) => (name.startsWith('call_') ? 0.9 : 0.1), seen),
      { preserveRecentMessages: 1, maxRequestTokens: stateTokens + 150 },
    );

    expect(output.stats.requests).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.flatMap((r) => r.questions).sort()).toEqual([
      'call_t1',
      'call_t2',
      'call_t3',
      'result_t1',
      'result_t2',
      'result_t3',
    ]);
    expect(new Set(seen.map((r) => JSON.stringify(r.state))).size).toBe(1);
    expect(output.decisions.map((d) => d.action)).toEqual(['drop_result', 'drop_result', 'drop_result']);
    expect(output.messages).toHaveLength(messages.length);
    expect(output.stats).toMatchObject({ resultsDropped: 3, kept: 0, callsDropped: 0, pinned: 0 });
    expect(reductionRatio(output)).toBeGreaterThan(0);
  });

  it('keeps everything without calling Jev when no tool call is a candidate', async () => {
    const seen: Seen[] = [];
    const messages = [message('user', 'hello'), message('assistant', 'hi')];
    const output = await compact(messages, fakeJev(() => 0, seen));
    expect(seen).toHaveLength(0);
    expect(output.stats).toMatchObject({ requests: 0, stateStage: '', calls: 0 });
    expect(output.messages).toEqual(messages);
  });

  it('reports a tiny reduction when Jev wants everything kept', async () => {
    const output = await compact(transcript(), fakeJev(() => 0.95), { preserveRecentMessages: 1 });
    expect(output.decisions.every((d) => d.action === 'keep')).toBe(true);
    expect(reductionRatio(output)).toBe(0);
  });

  it('rejects malformed answers', async () => {
    const broken: JevAsker = {
      ask: async () => ({ answers: { call_t1: { noul: 0.5 } } }),
    };
    await expect(compact(transcript(), broken, { preserveRecentMessages: 1 })).rejects.toThrow(
      /Invalid Jev answer/,
    );
  });
});

describe('HTTP client', () => {
  it('builds a System One request', () => {
    const request = buildJevRequest({ apiKey: 'k' }, { a: 1 }, {
      q: { type: 'noul', instructions: 'x' },
    });
    expect(request.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(request.headers.authorization).toBe('Bearer k');
    expect(JSON.parse(request.body)).toEqual({
      model: 'jev-latest',
      state: { a: 1 },
      questions: { q: { type: 'noul', instructions: 'x' } },
    });
  });

  it('rejects failed and malformed responses', () => {
    expect(() => parseJevResponse(500, false, 'boom')).toThrow(/500/);
    expect(() => parseJevResponse(200, true, 'not json')).toThrow(/malformed/);
    expect(() => parseJevResponse(200, true, '{}')).toThrow(/missing answers/);
    expect(parseJevResponse(200, true, '{"answers":{}}')).toEqual({ answers: {} });
  });

  it('asks over fetch and refuses to run without a key', async () => {
    const bodies: string[] = [];
    const client = new JevClient({
      apiKey: 'k',
      model: 'jev-test',
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return new Response(JSON.stringify({ answers: { q: { noul: 0.4 } } }), { status: 200 });
      }) as typeof fetch,
    });
    const response = await client.ask('state', { q: { type: 'noul', instructions: 'x' } });
    expect(response.answers.q).toEqual({ noul: 0.4 });
    expect(JSON.parse(bodies[0]!).model).toBe('jev-test');

    const keyless = new JevClient({ apiKey: '' });
    await expect(keyless.ask('s', {})).rejects.toThrow(/TYPESAFE_API_KEY/);
    await expect(
      compactMessages(transcript(), { apiKey: '', preserveRecentMessages: 1 }),
    ).rejects.toThrow(/TYPESAFE_API_KEY/);
  });

  describe('Cloudflare Workers AI Clef', () => {
    it('detects and normalizes Clef models and endpoints', () => {
      expect(isCloudflareModel('@cf/cloudflare/clef')).toBe(true);
      expect(isCloudflareModel('clef')).toBe(true);
      expect(isCloudflareModel('https://developers.cloudflare.com/workers-ai/models/clef/')).toBe(
        true,
      );
      expect(isCloudflareModel('@cf/cloudflare/clef-flash')).toBe(true);
      expect(isCloudflareModel('clef-flash')).toBe(true);
      expect(
        isCloudflareModel('https://developers.cloudflare.com/workers-ai/models/clef-flash/'),
      ).toBe(true);
      expect(isCloudflareModel(undefined, 'https://api.cloudflare.com/client/v4/accounts/1/ai/run/@cf/cloudflare/clef')).toBe(
        true,
      );
      expect(isCloudflareModel('jev-latest')).toBe(false);
      expect(isCloudflareModel(undefined, 'https://api.typesafe.ai/v1/systemone')).toBe(false);

      expect(normalizeCloudflareModel('clef')).toEqual({
        urlModel: CLOUDFLARE_CLEF_MODEL,
        bodyModel: 'clef',
      });
      expect(normalizeCloudflareModel('@cf/cloudflare/clef')).toEqual({
        urlModel: CLOUDFLARE_CLEF_MODEL,
        bodyModel: 'clef',
      });
      expect(
        normalizeCloudflareModel('https://developers.cloudflare.com/workers-ai/models/clef/'),
      ).toEqual({
        urlModel: CLOUDFLARE_CLEF_MODEL,
        bodyModel: 'clef',
      });
      expect(normalizeCloudflareModel('clef-flash')).toEqual({
        urlModel: CLOUDFLARE_CLEF_FLASH_MODEL,
        bodyModel: 'clef-flash',
      });
      expect(normalizeCloudflareModel('@cf/cloudflare/clef-flash')).toEqual({
        urlModel: CLOUDFLARE_CLEF_FLASH_MODEL,
        bodyModel: 'clef-flash',
      });
    });

    it('builds a Cloudflare Workers AI Clef request', () => {
      const request = buildJevRequest(
        { apiKey: 'cf-token', model: '@cf/cloudflare/clef', accountId: 'acc-123' },
        { a: 1 },
        { q: { type: 'noul', instructions: 'x' } },
      );
      expect(request.url).toBe(
        'https://api.cloudflare.com/client/v4/accounts/acc-123/ai/run/@cf/cloudflare/clef',
      );
      expect(request.headers.authorization).toBe('Bearer cf-token');
      expect(JSON.parse(request.body)).toEqual({
        model: 'clef',
        state: { a: 1 },
        questions: { q: { type: 'noul', instructions: 'x' } },
      });
    });

    it('builds a Clef request from documentation URL', () => {
      const request = buildJevRequest(
        {
          apiKey: 'cf-token',
          model: 'https://developers.cloudflare.com/workers-ai/models/clef/',
          accountId: 'acc-456',
        },
        'state',
        { q: { type: 'noul', instructions: 'x' } },
      );
      expect(request.url).toBe(
        'https://api.cloudflare.com/client/v4/accounts/acc-456/ai/run/@cf/cloudflare/clef',
      );
      expect(JSON.parse(request.body).model).toBe('clef');
    });

    it('supports clef-flash variant', () => {
      const request = buildJevRequest(
        { apiKey: 'cf-token', model: 'clef-flash', accountId: 'acc-123' },
        'state',
        { q: { type: 'noul', instructions: 'x' } },
      );
      expect(request.url).toBe(
        'https://api.cloudflare.com/client/v4/accounts/acc-123/ai/run/@cf/cloudflare/clef-flash',
      );
      expect(JSON.parse(request.body).model).toBe('clef-flash');
    });

    it('supports custom baseUrl for Cloudflare AI Gateway', () => {
      const gatewayUrl =
        'https://gateway.ai.cloudflare.com/v1/acc-123/my-gw/workers-ai/@cf/cloudflare/clef';
      const request = buildJevRequest(
        { apiKey: 'cf-token', baseUrl: gatewayUrl },
        'state',
        { q: { type: 'noul', instructions: 'x' } },
      );
      expect(request.url).toBe(gatewayUrl);
      expect(JSON.parse(request.body).model).toBe('clef');
    });

    it('throws when accountId is missing for Cloudflare model', () => {
      expect(() =>
        buildJevRequest(
          { apiKey: 'cf-token', model: '@cf/cloudflare/clef' },
          'state',
          { q: { type: 'noul', instructions: 'x' } },
        ),
      ).toThrow(/Cloudflare accountId is required/);
    });

    it('parses successful Cloudflare envelope', () => {
      const cfResponse = {
        success: true,
        errors: [],
        messages: [],
        result: {
          model: 'clef',
          answers: {
            urgent: { type: 'noul', noul: 0.85 },
          },
          usage: { input_tokens: 120, output_tokens: 0 },
        },
      };
      const parsed = parseJevResponse(200, true, JSON.stringify(cfResponse));
      expect(parsed).toEqual(cfResponse.result);
      expect(parsed.answers.urgent).toEqual({ type: 'noul', noul: 0.85 });
    });

    it('parses Cloudflare error envelope', () => {
      const cfError = {
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
        messages: [],
        result: null,
      };
      expect(() => parseJevResponse(200, true, JSON.stringify(cfError))).toThrow(
        /Authentication error/,
      );
      expect(() => parseJevResponse(403, false, JSON.stringify(cfError))).toThrow(
        /Authentication error/,
      );
    });

    it('runs JevClient configured for Clef and throws with CLOUDFLARE_API_TOKEN on missing key', async () => {
      const client = new JevClient({
        model: '@cf/cloudflare/clef',
        accountId: 'acc-789',
        apiKey: 'cf-test-token',
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
          expect(String(url)).toBe(
            'https://api.cloudflare.com/client/v4/accounts/acc-789/ai/run/@cf/cloudflare/clef',
          );
          return new Response(
            JSON.stringify({
              success: true,
              result: {
                model: 'clef',
                answers: { urgent: { type: 'noul', noul: 0.95 } },
              },
            }),
            { status: 200 },
          );
        }) as typeof fetch,
      });

      const res = await client.ask('state', { urgent: { type: 'noul', instructions: 'urgent?' } });
      expect(res.answers.urgent).toEqual({ type: 'noul', noul: 0.95 });

      const keylessCf = new JevClient({ model: 'clef', accountId: 'acc-1', apiKey: '' });
      await expect(keylessCf.ask('s', {})).rejects.toThrow(/CLOUDFLARE_API_TOKEN/);
    });

    it('enforces maximum 32 calls per batch for the 64 questions limit', () => {
      const calls: ToolCall[] = Array.from({ length: 70 }, (_, i) => ({
        id: `t${i + 1}`,
        tool_use_id: `call_${i + 1}`,
        tool: 'Read',
        input: { path: `file_${i + 1}.ts` },
        callIndex: i * 2,
        resultIndex: i * 2 + 1,
        resultChars: 100,
        isError: false,
        pinned: false,
      }));
      // Large budget so token size is not the limiting factor
      const batches = batchCalls(calls, 100, { maxRequestTokens: 100_000 });
      expect(batches.length).toBe(3); // 32 + 32 + 6
      expect(batches[0]).toHaveLength(MAX_CALLS_PER_BATCH);
      expect(batches[1]).toHaveLength(MAX_CALLS_PER_BATCH);
      expect(batches[2]).toHaveLength(6);
    });
  });
});

describe('resolveEndpoint', () => {
  const clefModels = ['clef', 'clef-flash', '@cf/cloudflare/clef', '@cf/cloudflare/clef-flash'];

  it('defaults to TypeSafe and keeps one key chain per backend', () => {
    expect(resolveEndpoint()).toMatchObject({
      backend: 'typesafe',
      url: 'https://api.typesafe.ai/v1/systemone',
      bodyModel: 'jev-latest',
      keyEnvs: ['TYPESAFE_API_KEY'],
    });
    expect(resolveEndpoint({ model: 'jev-test' }).bodyModel).toBe('jev-test');
    expect(
      resolveEndpoint({ backend: 'cloudflare', model: 'clef-flash', accountId: 'acc-1' }),
    ).toMatchObject({
      backend: 'cloudflare',
      url: 'https://api.cloudflare.com/client/v4/accounts/acc-1/ai/run/@cf/cloudflare/clef-flash',
      bodyModel: 'clef-flash',
      keyEnvs: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AUTH_TOKEN', 'TYPESAFE_API_KEY'],
    });
  });

  it('treats baseUrl as a complete endpoint URL for either backend', () => {
    const gateway =
      'https://gateway.ai.cloudflare.com/v1/acc-1/gw/workers-ai/@cf/cloudflare/clef';
    expect(resolveEndpoint({ baseUrl: gateway })).toMatchObject({
      backend: 'cloudflare',
      url: gateway,
      bodyModel: 'clef',
    });
    expect(
      resolveEndpoint({ backend: 'typesafe', baseUrl: 'https://jev.internal/v1' }),
    ).toMatchObject({
      backend: 'typesafe',
      url: 'https://jev.internal/v1',
      bodyModel: 'jev-latest',
    });
  });

  it('rejects every unsupported backend/model/field combination', () => {
    expect(() => resolveEndpoint({ backend: 'typesafe', accountId: 'acc-1' })).toThrow(
      /accountId is only valid with backend "cloudflare"/,
    );
    for (const model of clefModels) {
      expect(() => resolveEndpoint({ backend: 'typesafe', model })).toThrow(
        /is a Clef model; set backend "cloudflare"/,
      );
    }
    expect(() =>
      resolveEndpoint({ backend: 'cloudflare', model: 'clef' }),
    ).toThrow(/Cloudflare accountId is required/);
    expect(() =>
      resolveEndpoint({ backend: 'cloudflare', model: 'jev-latest', accountId: 'acc-1' }),
    ).toThrow(/is not a Clef model/);
  });

  it('reports the missing key for the resolved backend', () => {
    expect(missingKeyMessage('typesafe')).toMatch(/TYPESAFE_API_KEY/);
    expect(missingKeyMessage('cloudflare')).toMatch(/CLOUDFLARE_API_TOKEN/);
  });
});

describe('endpoint guardrails', () => {
  it('refuses the TypeSafe endpoint for a Clef model instead of calling it', () => {
    expect(() =>
      resolveEndpoint({
        model: 'clef-flash',
        baseUrl: 'https://api.typesafe.ai/v1/systemone',
        accountId: 'acc-1',
      }),
    ).toThrow(/points at the TypeSafe endpoint/);
  });

  it('infers the backend when backend is not set', () => {
    expect(inferBackend({ model: 'clef' })).toBe('cloudflare');
    expect(inferBackend({ accountId: 'acc-1' })).toBe('cloudflare');
    expect(inferBackend({ model: 'jev-latest' })).toBe('typesafe');
    expect(inferBackend({ backend: 'typesafe', model: 'clef' })).toBe('typesafe');
  });
});
