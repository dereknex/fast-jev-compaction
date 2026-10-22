import { noulAnswer } from './request.js';
import { collectToolCalls, estimateTokens, fitState } from './state.js';
import type {
  CallAnswer,
  CallDecision,
  CompactOptions,
  CompactResult,
  CompactionState,
  DecisionProgress,
  DecisionResult,
  JevAsker,
  JevQuestions,
  Message,
  ResolvedCompactOptions,
  ToolCall,
  ToolUse,
} from './types.js';

export const DEFAULT_OPTIONS: ResolvedCompactOptions = {
  goal: '',
  keepThreshold: 0.5,
  preserveRecentMessages: 6,
  maxStateTokens: 25_000,
  maxRequestTokens: 30_000,
  truncateHeadChars: 300,
};

/** Tokens the request envelope (`model`, key names) adds around state and questions. */
const REQUEST_OVERHEAD_TOKENS = 20;

/** Estimated tokens one call's two `noul` questions cost, measured on real transcripts. */
export const QUESTION_TOKENS_PER_CALL = 160;

function finite(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resolveOptions(options: CompactOptions = {}): ResolvedCompactOptions {
  return {
    goal: options.goal ?? DEFAULT_OPTIONS.goal,
    keepThreshold: finite(options.keepThreshold, DEFAULT_OPTIONS.keepThreshold),
    preserveRecentMessages: Math.max(
      0,
      Math.floor(
        finite(options.preserveRecentMessages, DEFAULT_OPTIONS.preserveRecentMessages),
      ),
    ),
    maxStateTokens: Math.max(1, finite(options.maxStateTokens, DEFAULT_OPTIONS.maxStateTokens)),
    maxRequestTokens: Math.max(
      1,
      finite(options.maxRequestTokens, DEFAULT_OPTIONS.maxRequestTokens),
    ),
    truncateHeadChars: Math.max(
      0,
      Math.floor(finite(options.truncateHeadChars, DEFAULT_OPTIONS.truncateHeadChars)),
    ),
  };
}

/** The two `noul` questions asked about one call: keep the call, keep its result. */
export function questionsFor(call: ToolCall): JevQuestions {
  return {
    [`call_${call.id}`]: {
      type: 'noul',
      instructions: `Tool call ${call.id} (${call.tool}) should stay in the history: knowing this call was made, with its input, still matters for what the assistant does next`,
    },
    [`result_${call.id}`]: {
      type: 'noul',
      instructions: `The full output of tool call ${call.id} (${call.tool}, ${call.resultChars} chars) should stay in the history verbatim: the assistant still needs its contents and re-running the tool would not do`,
    },
  };
}

export const MAX_QUESTIONS_PER_REQUEST = 64;
export const MAX_CALLS_PER_BATCH = Math.floor(MAX_QUESTIONS_PER_REQUEST / 2); // 32

/** The question budget one full batch needs; the state must leave this much room. */
export const QUESTION_RESERVE_TOKENS = QUESTION_TOKENS_PER_CALL * MAX_CALLS_PER_BATCH;

/**
 * Caps the configured budgets at the model's input window. Every request
 * re-sends the whole state, so the state has to fit with room for a full batch
 * of questions; otherwise the backend rejects the request (Clef answers HTTP
 * 422) and no compaction ever happens. A model with no known window keeps the
 * configured budgets.
 */
export function clampToContextWindow(
  options: ResolvedCompactOptions,
  contextWindow: number | undefined,
): ResolvedCompactOptions {
  if (
    typeof contextWindow !== 'number' ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0
  ) {
    return options;
  }
  const maxRequestTokens = Math.min(options.maxRequestTokens, contextWindow);
  return {
    ...options,
    maxRequestTokens,
    maxStateTokens: Math.min(
      options.maxStateTokens,
      Math.max(1, maxRequestTokens - QUESTION_RESERVE_TOKENS),
    ),
  };
}

/**
 * Splits the candidate calls into batches whose questions, together with the
 * (always complete) state, fit one request.
 */
export function batchCalls(
  calls: readonly ToolCall[],
  stateTokens: number,
  options: Pick<ResolvedCompactOptions, 'maxRequestTokens'>,
): ToolCall[][] {
  const budget = options.maxRequestTokens - stateTokens - REQUEST_OVERHEAD_TOKENS;
  const batches: ToolCall[][] = [];
  let current: ToolCall[] = [];
  let currentTokens = 0;
  for (const call of calls) {
    const tokens = estimateTokens(JSON.stringify(questionsFor(call)));
    if (
      current.length > 0 &&
      (current.length >= MAX_CALLS_PER_BATCH || currentTokens + tokens > budget)
    ) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    if (current.length === 0 && tokens > budget) {
      throw new Error(
        `state leaves no room for questions (~${stateTokens} of ${options.maxRequestTokens} tokens)`,
      );
    }
    current.push(call);
    currentTokens += tokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function decideCall(
  call: Pick<ToolCall, 'id' | 'tool' | 'pinned'> & {
    tool_use_id?: string;
    toolCallId?: string;
  },
  answer: CallAnswer,
  options: Pick<ResolvedCompactOptions, 'keepThreshold'>,
): CallDecision {
  const toolCallId = call.toolCallId ?? call.tool_use_id ?? call.id;
  const base: CallDecision = {
    id: call.id,
    tool_use_id: call.tool_use_id ?? toolCallId,
    toolCallId,
    tool: call.tool,
    ...answer,
    action: 'keep',
    reason: 'pinned',
  };
  if (call.pinned) return base;
  if (answer.keepResult >= options.keepThreshold) {
    return { ...base, action: 'keep', reason: 'kept' };
  }
  if (answer.keepCall >= options.keepThreshold) {
    return { ...base, action: 'drop_result', reason: 'result_dropped' };
  }
  return { ...base, action: 'drop_call', reason: 'call_dropped' };
}

async function askBatch(
  asker: JevAsker,
  state: CompactionState,
  batch: readonly ToolCall[],
  signal?: AbortSignal,
): Promise<Map<string, CallAnswer>> {
  const questions: JevQuestions = Object.assign({}, ...batch.map(questionsFor));
  const { answers } = await asker.ask(state, questions, signal);
  return new Map(
    batch.map((call) => [
      call.id,
      {
        keepCall: noulAnswer(answers, `call_${call.id}`),
        keepResult: noulAnswer(answers, `result_${call.id}`),
      },
    ]),
  );
}

function truncatedResultText(text: string, isError: boolean, headChars: number): string {
  if (text.length <= headChars + 120) return text;
  const head = headChars > 0 ? `${text.slice(0, headChars)}\n` : '';
  return `${head}[fast-jev-compaction truncated ${text.length - headChars} chars of this tool result${
    isError ? ' (error)' : ''
  }; re-run the tool if needed]`;
}

/**
 * Rebuilds the conversation from the decisions. A dropped call disappears
 * together with its result; a dropped result keeps a bounded head and note.
 * Messages that lose all their content are removed; untouched messages are
 * returned as the same objects they came in as.
 */
export function applyDecisions(
  messages: readonly Message[],
  decisions: readonly CallDecision[],
  calls: readonly ToolCall[],
  headChars: number,
): Message[] {
  const byId = new Map(calls.map((call) => [call.id, call]));
  const actions = new Map<string, CallDecision['action']>();
  for (const decision of decisions) {
    const call = byId.get(decision.id);
    if (call && decision.action !== 'keep') {
      const id = call.toolCallId ?? call.tool_use_id;
      if (id) actions.set(id, decision.action);
    }
  }
  const kept: Message[] = [];
  for (const message of messages) {
    const touched =
      message.toolUses.some((tool) => {
        const id = tool.toolCallId ?? tool.tool_use_id;
        return id ? actions.has(id) : false;
      }) ||
      (message.toolResults ?? []).some((result) => {
        const id = result.toolCallId ?? result.tool_use_id;
        return id ? actions.has(id) : false;
      });
    if (!touched) {
      kept.push(message);
      continue;
    }
    const toolUses = message.toolUses
      .filter((tool) => {
        const id = tool.toolCallId ?? tool.tool_use_id;
        return id ? actions.get(id) !== 'drop_call' : true;
      })
      .map((tool) => {
        const id = tool.toolCallId ?? tool.tool_use_id;
        if (!id || actions.get(id) !== 'drop_result') return tool;
        const text = truncatedResultText(
          tool.text ?? '',
          tool.isError ?? false,
          headChars,
        );
        if ((tool.text ?? '') === text) return tool;
        const copy: ToolUse = {
          tool_use_id: tool.tool_use_id,
          toolCallId: tool.toolCallId,
          tool: tool.tool,
          input: tool.input,
          text,
        };
        if (tool.isError) copy.isError = true;
        return copy;
      });
    const toolResults = (message.toolResults ?? [])
      .filter((result) => {
        const id = result.toolCallId ?? result.tool_use_id;
        return id ? actions.get(id) !== 'drop_call' : true;
      })
      .map((result) => {
        const id = result.toolCallId ?? result.tool_use_id;
        if (!id || actions.get(id) !== 'drop_result') return result;
        const text = truncatedResultText(result.text, result.isError ?? false, headChars);
        return text === result.text
          ? result
          : {
              tool_use_id: result.tool_use_id,
              toolCallId: result.toolCallId,
              text,
              isError: result.isError,
            };
      });
    if (
      !message.toolUses.some((tool) => {
        const id = tool.toolCallId ?? tool.tool_use_id;
        return id ? actions.get(id) === 'drop_call' : false;
      }) &&
      !(message.toolResults ?? []).some((result) => {
        const id = result.toolCallId ?? result.tool_use_id;
        return id ? actions.get(id) === 'drop_call' : false;
      }) &&
      toolUses.every((tool, index) => tool === message.toolUses[index]) &&
      toolResults.every(
        (result, index) => result === message.toolResults?.[index],
      )
    ) {
      kept.push(message);
      continue;
    }
    if (message.text.trim().length === 0 && toolUses.length === 0 && toolResults.length === 0) {
      continue;
    }
    const rebuilt: Message = { role: message.role, text: message.text, toolUses };
    if (toolResults.length > 0) rebuilt.toolResults = toolResults;
    kept.push(rebuilt);
  }
  return kept;
}

/** Characters of text, tool input and tool output a message holds. */
export function messageChars(message: Message): number {
  let total = message.text.length;
  for (const tool of message.toolUses) {
    try {
      total += JSON.stringify(tool.input).length;
    } catch {
      total += 20;
    }
  }
  for (const result of message.toolResults ?? []) total += result.text.length;
  return total;
}

export function reductionRatio(result: Pick<CompactResult, 'stats'>): number {
  const { charsBefore, charsAfter } = result.stats;
  return charsBefore === 0 ? 0 : (charsBefore - charsAfter) / charsBefore;
}

function count(decisions: readonly CallDecision[], reason: CallDecision['reason']): number {
  return decisions.filter((decision) => decision.reason === reason).length;
}

/**
 * Evaluates candidate tool calls and returns decisions and calls without modifying messages.
 */
export async function decide(
  messages: readonly Message[],
  asker: JevAsker,
  options: CompactOptions = {},
  signal?: AbortSignal,
  onProgress?: (progress: DecisionProgress) => void,
): Promise<DecisionResult> {
  const started = Date.now();
  const contextWindow = asker.contextWindow;
  const resolved = clampToContextWindow(resolveOptions(options), contextWindow);
  const windowField = contextWindow === undefined ? {} : { contextWindow };
  const calls = collectToolCalls(messages, resolved.preserveRecentMessages);
  const candidates = calls.filter((call) => !call.pinned);

  let fitted: { tokens: number; stage: string } = { tokens: 0, stage: '' };
  let batches: ToolCall[][] = [];
  const answers = new Map<string, CallAnswer>();
  if (candidates.length > 0) {
    signal?.throwIfAborted();
    onProgress?.({ stage: 'fitting', ...windowField });
    const state = fitState(messages, calls, resolved);
    fitted = state;
    const progress = { stateTokens: state.tokens, stateStage: state.stage, ...windowField };
    onProgress?.({ stage: 'batching', ...progress });
    batches = batchCalls(candidates, state.tokens, resolved);
    onProgress?.({ stage: 'requesting', ...progress, batches: batches.length });
    const answered = await Promise.all(
      batches.map((batch) => askBatch(asker, state.state, batch, signal)),
    );
    signal?.throwIfAborted();
    for (const map of answered) for (const [id, answer] of map) answers.set(id, answer);
  }

  onProgress?.({
    stage: 'deciding',
    stateTokens: fitted.tokens,
    stateStage: fitted.stage,
    batches: batches.length,
    ...windowField,
  });
  const decisions = calls.map((call) =>
    decideCall(call, answers.get(call.id) ?? { keepCall: 1, keepResult: 1 }, resolved),
  );

  return {
    decisions,
    calls,
    stats: {
      calls: calls.length,
      kept: count(decisions, 'kept'),
      resultsDropped: count(decisions, 'result_dropped'),
      callsDropped: count(decisions, 'call_dropped'),
      pinned: count(decisions, 'pinned'),
      stateTokens: fitted.tokens,
      stateStage: fitted.stage,
      requests: batches.length,
      ms: Date.now() - started,
    },
  };
}

/**
 * Compacts a transcript by asking Jev, for every tool call outside the pinned
 * first and newest messages, whether the call and whether its result must
 * stay. The whole history (results omitted, fitted into `maxStateTokens`) is
 * sent as state with every batch of questions. Throws when Jev fails or the
 * history cannot be fitted; the caller decides whether to fall back.
 */
export async function compact(
  messages: readonly Message[],
  asker: JevAsker,
  options: CompactOptions = {},
): Promise<CompactResult> {
  const result = await decide(messages, asker, options);
  const resolved = resolveOptions(options);
  const charsBefore = messages.reduce((sum, message) => sum + messageChars(message), 0);
  const kept = applyDecisions(
    messages,
    result.decisions,
    result.calls,
    resolved.truncateHeadChars,
  );
  return {
    messages: kept,
    decisions: result.decisions,
    stats: {
      messagesBefore: messages.length,
      messagesAfter: kept.length,
      charsBefore,
      charsAfter: kept.reduce((sum, message) => sum + messageChars(message), 0),
      ...result.stats,
    },
  };
}
