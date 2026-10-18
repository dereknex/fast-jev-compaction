import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { missingKeyMessage, resolveEndpoint } from 'fast-jev-compaction';

export interface KeyResolutionContext {
  backend?: 'typesafe' | 'cloudflare';
  model?: string;
  baseUrl?: string;
  accountId?: string;
}

export interface KeyResolver {
  resolve: (
    apiKeyCommand: string | undefined,
    signal?: AbortSignal,
    context?: KeyResolutionContext,
  ) => Promise<string>;
  clear: () => void;
}

export function createKeyResolver(pi: Pick<ExtensionAPI, 'exec'>): KeyResolver {
  let cached: string | undefined;

  return {
    async resolve(apiKeyCommand, signal, context) {
      if (cached) return cached;
      const { backend, keyEnvs } = resolveEndpoint(context ?? {});
      const fromEnvironment = keyEnvs
        .map((name) => process.env[name]?.trim())
        .find((value): value is string => Boolean(value));
      if (fromEnvironment) {
        cached = fromEnvironment;
        return cached;
      }
      if (!apiKeyCommand) {
        throw new Error(missingKeyMessage(backend));
      }
      const result = await pi.exec('sh', ['-lc', apiKeyCommand], {
        signal,
        timeout: 15_000,
      });
      const value = result.stdout.trim();
      if (result.code !== 0 || !value) {
        throw new Error(
          backend === 'cloudflare'
            ? 'Cloudflare API token command failed'
            : 'TypeSafe API key command failed',
        );
      }
      cached = value;
      return cached;
    },
    clear() {
      cached = undefined;
    },
  };
}
