import type { JevAnswer, JevQuestions, JevResponse, JevState } from './types.js';

export const SYSTEM_ONE_URL = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_MODEL = 'jev-latest';

export const CLOUDFLARE_CLEF_MODEL = '@cf/cloudflare/clef';
export const CLOUDFLARE_CLEF_FLASH_MODEL = '@cf/cloudflare/clef-flash';
export const CLOUDFLARE_AI_BASE_URL = 'https://api.cloudflare.com/client/v4';

export interface JevRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

export type JevBackend = 'typesafe' | 'cloudflare';

/** Everything that decides where a Jev / Clef call goes. */
export interface EndpointConfig {
  /** Explicit backend; when omitted it is inferred from model / baseUrl / accountId. */
  backend?: JevBackend;
  model?: string;
  /** A complete endpoint URL, used verbatim. */
  baseUrl?: string;
  accountId?: string;
}

/** One backend, one URL, one body model, one key chain. */
export interface JevEndpoint {
  backend: JevBackend;
  url: string;
  bodyModel: string;
  /** Environment variables holding the API key, highest priority first. */
  keyEnvs: readonly string[];
}

export interface BuildJevRequestParams extends EndpointConfig {
  apiKey: string;
}

const TYPESAFE_KEY_ENVS = ['TYPESAFE_API_KEY'] as const;
const CLOUDFLARE_KEY_ENVS = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_AUTH_TOKEN',
  'TYPESAFE_API_KEY',
] as const;

/** The key-missing message for a backend, shared by every caller. */
export function missingKeyMessage(backend: JevBackend): string {
  return backend === 'cloudflare'
    ? 'CLOUDFLARE_API_TOKEN (or CLOUDFLARE_AUTH_TOKEN) is not configured'
    : 'TYPESAFE_API_KEY is not configured';
}

/** Checks whether a model or baseUrl targets Cloudflare Workers AI. */
export function isCloudflareModel(model?: string, baseUrl?: string): boolean {
  if (model) {
    const trimmed = model.trim().toLowerCase();
    if (
      trimmed === 'clef' ||
      trimmed === 'clef-flash' ||
      trimmed.startsWith('@cf/') ||
      trimmed.includes('workers-ai/models/clef') ||
      trimmed.includes('cloudflare.com')
    ) {
      return true;
    }
  }
  if (baseUrl) {
    const trimmedUrl = baseUrl.trim().toLowerCase();
    if (
      trimmedUrl.includes('api.cloudflare.com') ||
      trimmedUrl.includes('gateway.ai.cloudflare.com') ||
      trimmedUrl.includes('/workers-ai/') ||
      trimmedUrl.includes('@cf/')
    ) {
      return true;
    }
  }
  return false;
}

/** Resolves model identifier to Cloudflare endpoint path and body selector. */
export function normalizeCloudflareModel(model?: string): {
  urlModel: string;
  bodyModel: string;
} {
  const m = model?.trim() ?? 'clef';
  const lower = m.toLowerCase();

  if (lower.includes('clef-flash')) {
    return {
      urlModel: CLOUDFLARE_CLEF_FLASH_MODEL,
      bodyModel: 'clef-flash',
    };
  }
  if (lower.includes('clef')) {
    return {
      urlModel: CLOUDFLARE_CLEF_MODEL,
      bodyModel: 'clef',
    };
  }
  if (m.startsWith('@cf/')) {
    const short = m.replace(/^@cf\/cloudflare\//, '');
    return {
      urlModel: m,
      bodyModel: short,
    };
  }
  return {
    urlModel: `@cf/cloudflare/${m}`,
    bodyModel: m,
  };
}

/** The backend a config resolves to when `backend` is not set explicitly. */
export function inferBackend(config: EndpointConfig): JevBackend {
  if (config.backend) return config.backend;
  return isCloudflareModel(config.model, config.baseUrl) ||
    Boolean(config.accountId)
    ? 'cloudflare'
    : 'typesafe';
}

/**
 * Resolves backend, URL, body model and key chain from one config. Every caller
 * goes through here, so an unsupported combination fails loudly instead of
 * silently hitting the wrong API.
 */
export function resolveEndpoint(config: EndpointConfig = {}): JevEndpoint {
  const backend = inferBackend(config);
  const model = config.model?.trim() || undefined;

  if (backend === 'cloudflare') {
    if (model && !isCloudflareModel(model)) {
      throw new Error(
        `model "${model}" is not a Clef model; use clef or clef-flash with backend "cloudflare"`,
      );
    }
    if (config.baseUrl) {
      if (config.baseUrl === SYSTEM_ONE_URL) {
        throw new Error(
          'baseUrl points at the TypeSafe endpoint but the backend resolves to "cloudflare"; unset baseUrl or set backend "typesafe"',
        );
      }
      return {
        backend,
        url: config.baseUrl,
        bodyModel: normalizeCloudflareModel(model ?? config.baseUrl).bodyModel,
        keyEnvs: CLOUDFLARE_KEY_ENVS,
      };
    }
    const envAccountId =
      (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env?.CLOUDFLARE_ACCOUNT_ID;
    const accountId = config.accountId ?? envAccountId;
    if (!accountId) {
      throw new Error(
        'Cloudflare accountId is required for Clef models (set accountId, CLOUDFLARE_ACCOUNT_ID, or a full baseUrl)',
      );
    }
    const { urlModel, bodyModel } = normalizeCloudflareModel(model);
    return {
      backend,
      url: `${CLOUDFLARE_AI_BASE_URL}/accounts/${accountId}/ai/run/${urlModel}`,
      bodyModel,
      keyEnvs: CLOUDFLARE_KEY_ENVS,
    };
  }

  if (config.accountId) {
    throw new Error('accountId is only valid with backend "cloudflare"');
  }
  if (model && isCloudflareModel(model)) {
    throw new Error(
      `model "${model}" is a Clef model; set backend "cloudflare" and an accountId`,
    );
  }
  return {
    backend: 'typesafe',
    url: config.baseUrl ?? SYSTEM_ONE_URL,
    bodyModel: model ?? DEFAULT_MODEL,
    keyEnvs: TYPESAFE_KEY_ENVS,
  };
}

/** The HTTP request for one Jev / Clef call, for any fetch-like transport. */
export function buildJevRequest(
  params: BuildJevRequestParams,
  state: JevState,
  questions: JevQuestions,
): JevRequest {
  const endpoint = resolveEndpoint(params);
  return {
    url: endpoint.url,
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: endpoint.bodyModel,
      state,
      questions,
    }),
  };
}

/** Validates a Jev / Clef response body; throws on anything but an `answers` object. */
export function parseJevResponse(
  status: number,
  ok: boolean,
  text: string,
): JevResponse {
  if (!ok) {
    let detail = text.slice(0, 200);
    try {
      const json = JSON.parse(text);
      if (
        json &&
        typeof json === 'object' &&
        Array.isArray((json as { errors?: Array<{ message?: string }> }).errors)
      ) {
        const msg = (json as { errors: Array<{ message?: string }> }).errors
          .map((e) => e.message)
          .filter(Boolean)
          .join('; ');
        if (msg) detail = msg;
      }
    } catch {
      // not JSON, keep text slice
    }
    throw new Error(`Jev request failed (${status}): ${detail}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Jev returned malformed JSON');
  }

  if (parsed !== null && typeof parsed === 'object') {
    if ('success' in parsed && (parsed as { success: unknown }).success === false) {
      const errors = (parsed as { errors?: Array<{ message?: string }> }).errors;
      const msg =
        errors?.map((e) => e.message).filter(Boolean).join('; ') ||
        'request unsuccessful';
      throw new Error(`Jev request failed: ${msg}`);
    }

    if (
      'result' in parsed &&
      parsed.result !== null &&
      typeof parsed.result === 'object' &&
      'answers' in parsed.result
    ) {
      parsed = parsed.result;
    }
  }

  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('answers' in parsed) ||
    parsed.answers === null ||
    typeof parsed.answers !== 'object'
  ) {
    throw new Error('Jev response is missing answers');
  }
  return parsed as JevResponse;
}

/** The `noul` probability of one answer; throws when it is not there. */
export function noulAnswer(
  answers: Record<string, JevAnswer>,
  name: string,
): number {
  const answer = answers[name];
  if (
    !answer ||
    !('noul' in answer) ||
    typeof answer.noul !== 'number' ||
    !Number.isFinite(answer.noul)
  ) {
    throw new Error(`Invalid Jev answer for ${name}`);
  }
  return answer.noul;
}
