import { buildJevRequest, isCloudflareModel, parseJevResponse } from './request.js';
import type { JevAsker, JevQuestions, JevResponse, JevState } from './types.js';

export interface JevClientOptions {
  /** Defaults to `process.env.TYPESAFE_API_KEY` or `process.env.CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_AUTH_TOKEN`. */
  apiKey?: string;
  /** Defaults to `jev-latest`. Can be `@cf/cloudflare/clef`, `clef`, etc. */
  model?: string;
  /** Cloudflare account ID for Workers AI. Defaults to `process.env.CLOUDFLARE_ACCOUNT_ID`. */
  accountId?: string;
  /** Defaults to the System One endpoint or Cloudflare Workers AI endpoint. */
  baseUrl?: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** Asks Jev / Clef over HTTP with the global `fetch` (or an injected one). */
export class JevClient implements JevAsker {
  private readonly apiKey: string;
  private readonly model: string | undefined;
  private readonly accountId: string | undefined;
  private readonly baseUrl: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(options: JevClientOptions = {}) {
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    const env =
      (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env;
    this.accountId = options.accountId ?? env?.CLOUDFLARE_ACCOUNT_ID;
    this.fetcher = options.fetch ?? fetch;

    const isCf = isCloudflareModel(this.model, this.baseUrl) || Boolean(this.accountId);
    this.apiKey =
      options.apiKey ??
      (isCf
        ? (env?.CLOUDFLARE_API_TOKEN ??
           env?.CLOUDFLARE_AUTH_TOKEN ??
           env?.TYPESAFE_API_KEY ??
           '')
        : (env?.TYPESAFE_API_KEY ??
           env?.CLOUDFLARE_API_TOKEN ??
           env?.CLOUDFLARE_AUTH_TOKEN ??
           ''));
  }

  async ask(state: JevState, questions: JevQuestions): Promise<JevResponse> {
    if (!this.apiKey) {
      const isCf = isCloudflareModel(this.model, this.baseUrl) || Boolean(this.accountId);
      throw new Error(
        isCf
          ? 'CLOUDFLARE_API_TOKEN (or CLOUDFLARE_AUTH_TOKEN) is not configured'
          : 'TYPESAFE_API_KEY is not configured',
      );
    }
    const request = buildJevRequest(
      {
        apiKey: this.apiKey,
        model: this.model,
        accountId: this.accountId,
        baseUrl: this.baseUrl,
      },
      state,
      questions,
    );
    const response = await this.fetcher(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    return parseJevResponse(response.status, response.ok, await response.text());
  }
}
