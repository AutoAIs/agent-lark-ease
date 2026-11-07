import { join } from 'node:path';

export interface LarkChannelEnvContext {
  profile?: string;
  rootDir?: string;
  configPath?: string;
  larkCliConfigDir?: string;
  larkCliSourceConfigFile?: string;
}

export function buildLarkChannelEnv(context?: LarkChannelEnvContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    LARK_EASE: '1',
    // Legacy handshake kept for the external `lark-cli` binary, which still
    // looks for the pre-rename variable.
    LARK_CHANNEL: '1',
  };
  const profile = nonEmpty(context?.profile);
  if (profile) {
    env.LARK_EASE_PROFILE = profile;
    env.LARK_CHANNEL_PROFILE = profile;
  }

  const rootDir = nonEmpty(context?.rootDir);
  if (rootDir) {
    env.LARK_EASE_HOME = rootDir;
    env.LARK_CHANNEL_HOME = rootDir;
  }

  const configPath =
    nonEmpty(context?.larkCliSourceConfigFile) ??
    nonEmpty(context?.configPath) ??
    (rootDir ? join(rootDir, 'config.json') : undefined);
  if (configPath) {
    env.LARK_EASE_CONFIG = configPath;
    env.LARK_CHANNEL_CONFIG = configPath;
  }

  const larkCliConfigDir = nonEmpty(context?.larkCliConfigDir);
  if (larkCliConfigDir) env.LARKSUITE_CLI_CONFIG_DIR = larkCliConfigDir;

  return env;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? value : undefined;
}
