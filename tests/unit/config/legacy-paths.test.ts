import { describe, expect, it } from 'vitest';
import { rewriteLegacyStatePaths } from '../../../src/config/legacy-paths';

describe('rewriteLegacyStatePaths', () => {
  it('rewrites the old state root and workspaces root in nested config values', () => {
    const legacy = '/home/user/.lark-channel';
    const current = '/home/user/.agent-lark-ease';
    const input = {
      secrets: {
        providers: {
          bridge: { command: `${legacy}/secrets-getter` },
        },
      },
      profiles: {
        codex: { workspaces: { default: `${legacy}-workspaces/codex/default` } },
      },
      untouched: '/home/user/dev/todo',
      count: 3,
    };

    expect(rewriteLegacyStatePaths(input, legacy, current)).toEqual({
      secrets: {
        providers: {
          bridge: { command: `${current}/secrets-getter` },
        },
      },
      profiles: {
        codex: { workspaces: { default: `${current}-workspaces/codex/default` } },
      },
      untouched: '/home/user/dev/todo',
      count: 3,
    });
  });

  it('leaves unrelated strings and non-object values alone', () => {
    expect(rewriteLegacyStatePaths(['/tmp/a', 1, null], '/old', '/new')).toEqual([
      '/tmp/a',
      1,
      null,
    ]);
  });
});
