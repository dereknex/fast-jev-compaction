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

export interface BuildJevRequestParams {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  accountId?: string;
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

/** The HTTP request for one Jev / Clef call, for any fetch-like transport. */
export function buildJevRequest(
  params: BuildJevRequestParams,
  state: JevState,
  questions: JevQuestions,
): JevRequest {
  const isCf = isCloudflareModel(params.model, params.baseUrl) || Boolean(params.accountId);
  let url: string;
  let bodyModel: string;

  if (params.baseUrl) {
    url = params.baseUrl;
    if (params.model) {
      bodyModel = isCloudflareModel(params.model)
        ? normalizeCloudflareModel(params.model).bodyModel
        : params.model;
    } else if (isCf) {
      bodyModel = normalizeCloudflareModel(params.baseUrl).bodyModel;
    } else {
      bodyModel = DEFAULT_MODEL;
    }
  } else if (isCf) {
    const envAccountId =
      (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env?.CLOUDFLARE_ACCOUNT_ID;
    const accountId = params.accountId ?? envAccountId;
    if (!accountId) {
      throw new Error(
        'Cloudflare accountId is required for Workers AI models (set accountId or CLOUDFLARE_ACCOUNT_ID, or provide baseUrl)',
      );
    }
    const { urlModel, bodyModel: cfBodyModel } = normalizeCloudflareModel(params.model);
    url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${urlModel}`;
    bodyModel = cfBodyModel;
  } else {
    url = SYSTEM_ONE_URL;
    bodyModel = params.model ?? DEFAULT_MODEL;
  }

  return {
    url,
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: bodyModel,
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
