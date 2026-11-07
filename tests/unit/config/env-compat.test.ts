import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBridgeEnv } from '../../../src/config/env-compat';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readBridgeEnv', () => {
  it('prefers the renamed LARK_EASE_* variable', () => {
    vi.stubEnv('LARK_EASE_HOME', '/new');
    vi.stubEnv('LARK_CHANNEL_HOME', '/old');
    expect(readBridgeEnv('HOME')).toBe('/new');
  });

  it('falls back to the legacy LARK_CHANNEL_* variable', () => {
    vi.stubEnv('LARK_EASE_HOME', '');
    vi.stubEnv('LARK_CHANNEL_HOME', '/old');
    expect(readBridgeEnv('HOME')).toBe('/old');
  });

  it('returns undefined when neither name is set', () => {
    vi.stubEnv('LARK_EASE_HOME', '');
    vi.stubEnv('LARK_CHANNEL_HOME', '');
    expect(readBridgeEnv('HOME')).toBeUndefined();
  });
});
