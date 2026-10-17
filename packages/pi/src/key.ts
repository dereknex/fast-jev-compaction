import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import { isCloudflareModel } from 'fast-jev-compaction';

export interface KeyResolutionContext {
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
      const isCf =
        isCloudflareModel(context?.model, context?.baseUrl) ||
        Boolean(context?.accountId);
      const fromEnvironment = isCf
        ? (process.env.CLOUDFLARE_API_TOKEN?.trim() ||
           process.env.CLOUDFLARE_API_KEY?.trim() ||
           process.env.TYPESAFE_API_KEY?.trim())
        : process.env.TYPESAFE_API_KEY?.trim();
      if (fromEnvironment) {
        cached = fromEnvironment;
        return cached;
      }
      if (!apiKeyCommand) {
        throw new Error(
          isCf
            ? 'Cloudflare API token is not configured'
            : 'TypeSafe API key is not configured',
        );
      }
      const result = await pi.exec('sh', ['-lc', apiKeyCommand], {
        signal,
        timeout: 15_000,
      });
      const value = result.stdout.trim();
      if (result.code !== 0 || !value) {
        throw new Error(
          isCf
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
