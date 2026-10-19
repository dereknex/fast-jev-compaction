import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveEndpoint } from '@dereknex/jev-compaction';

import { DEFAULT_CONFIG, parseConfig } from '../src/config.js';
import { createKeyResolver } from '../src/key.js';

const originalKey = process.env.TYPESAFE_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = originalKey;
});

describe('configuration boundary', () => {
  it('accepts known fields, clamps invalid values to defaults, and ignores secret-shaped extras', () => {
    expect(
      parseConfig({
        enabled: false,
        model: ' jev-test ',
        keepThreshold: 2,
        preserveRecentMessages: 3.9,
        cooldownTokens: 100,
        apiKeyCommand: ' key-command ',
        apiKey: 'must-not-be-read',
      }),
    ).toMatchObject({
      enabled: false,
      model: 'jev-test',
      keepThreshold: DEFAULT_CONFIG.keepThreshold,
      preserveRecentMessages: 3,
      cooldownTokens: 100,
      apiKeyCommand: 'key-command',
    });
  });
});

describe('backend selection', () => {
  it('leaves backend and baseUrl unset so the resolver picks TypeSafe', () => {
    const config = parseConfig({});
    expect(config.backend).toBeUndefined();
    expect(config.model).toBe('jev-latest');
    expect('baseUrl' in config).toBe(false);
    expect(resolveEndpoint(config).backend).toBe('typesafe');
  });

  it('still infers the cloudflare backend from a legacy Clef config', () => {
    const legacy = parseConfig({ model: '@cf/cloudflare/clef', accountId: 'acc-1' });
    expect(legacy.backend).toBeUndefined();
    expect(resolveEndpoint(legacy).url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acc-1/ai/run/@cf/cloudflare/clef',
    );
  });

  it('accepts the cloudflare backend with its own fields', () => {
    expect(
      parseConfig({ backend: 'cloudflare', model: 'clef-flash', accountId: 'acc-1' }),
    ).toMatchObject({ backend: 'cloudflare', model: 'clef-flash', accountId: 'acc-1' });
    expect(parseConfig({ backend: 'nope' }).backend).toBeUndefined();
  });

  it('rejects combinations that cannot reach an endpoint', () => {
    // A Clef model without an account never silently falls back to TypeSafe.
    expect(() => parseConfig({ model: 'clef-flash' })).toThrow(/accountId is required/);
    expect(() => parseConfig({ backend: 'cloudflare', model: 'clef' })).toThrow(
      /accountId is required/,
    );
    expect(() => parseConfig({ backend: 'typesafe', model: 'clef' })).toThrow(
      /is a Clef model/,
    );
    expect(() =>
      parseConfig({ backend: 'typesafe', accountId: 'acc-1' }),
    ).toThrow(/only valid with backend "cloudflare"/);
    expect(() => parseConfig({ backend: 'cloudflare', enabled: false, model: 'clef' })).not.toThrow();
  });
});

describe('key resolution', () => {
  it('prefers the environment and caches without invoking a command', async () => {
    process.env.TYPESAFE_API_KEY = ' env-secret \n';
    const exec = vi.fn();
    const resolver = createKeyResolver({ exec });
    expect(await resolver.resolve('ignored')).toBe('env-secret');
    expect(await resolver.resolve('ignored')).toBe('env-secret');
    expect(exec).not.toHaveBeenCalled();
  });

  it('runs a configured command once and never includes its output in failures', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const exec = vi.fn().mockResolvedValue({
      stdout: 'command-secret\n',
      stderr: '',
      code: 0,
      killed: false,
    });
    const resolver = createKeyResolver({ exec });
    expect(await resolver.resolve('generic-command')).toBe('command-secret');
    expect(await resolver.resolve('generic-command')).toBe('command-secret');
    expect(exec).toHaveBeenCalledTimes(1);

    const failedExec = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'command-secret leaked by process',
      code: 1,
      killed: false,
    });
    const failed = createKeyResolver({ exec: failedExec });
    await expect(failed.resolve('generic-command')).rejects.toThrow(
      'TypeSafe API key command failed',
    );
  });
});
