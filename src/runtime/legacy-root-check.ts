import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readBridgeEnv } from '../config/env-compat';
import { resolveAppPaths } from '../config/app-paths';
import { legacyPaths } from '../config/paths';
import { isAlive, type ProcessEntry } from './registry';

/**
 * The rename creates a new state root, and all runtime locks are rooted at the
 * state directory. That means an old bridge using ~/.lark-channel and a new
 * bridge using ~/.agent-lark-ease cannot see each other's locks and could both
 * connect the same Feishu app. Refuse to start while a live legacy bridge is
 * registered unless the operator explicitly opts in.
 */
export function assertNoLegacyBridge(rootDir: string = resolveAppPaths().rootDir): void {
  const newRoot = join(homedir(), '.agent-lark-ease');
  if (rootDir !== newRoot) return;
  if (!existsSync(legacyPaths.stateDir)) return;

  const registryFile = join(legacyPaths.stateDir, 'registry', 'processes.json');
  let entries: ProcessEntry[] = [];
  try {
    const parsed = JSON.parse(readFileSync(registryFile, 'utf8')) as { entries?: unknown };
    entries = Array.isArray(parsed.entries) ? (parsed.entries as ProcessEntry[]) : [];
  } catch {
    return;
  }
  const live = entries.filter(
    (entry) => Number.isInteger(entry.pid) && entry.pid > 0 && isAlive(entry.pid),
  );
  if (live.length === 0) return;
  if (readBridgeEnv('ALLOW_LEGACY_BRIDGE') === '1') return;

  const list = live
    .map((entry) => `  - ${entry.profileName ?? '?'} (${entry.appId ?? '?'}) pid=${entry.pid}`)
    .join('\n');
  throw new Error(
    `检测到旧版 bridge 仍在运行，继续启动会与它抢占同一个飞书应用：\n${list}\n` +
      `请先停止/注销旧服务（lark-channel-bridge stop && lark-channel-bridge unregister），` +
      `或设置 LARK_EASE_ALLOW_LEGACY_BRIDGE=1 强制继续。`,
  );
}
