#!/usr/bin/env node
import { existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The project was renamed from lark-channel-bridge to agent-lark-ease. Move
// the old state directory before the CLI imports path helpers, so a normal
// upgrade keeps profiles, sessions, and secrets without a manual step. An
// explicit LARK_EASE_HOME / LARK_CHANNEL_HOME always wins.
if (!process.env.LARK_EASE_HOME && !process.env.LARK_CHANNEL_HOME) {
  const current = join(homedir(), '.agent-lark-ease');
  const legacy = join(homedir(), '.lark-channel');
  if (!existsSync(current) && existsSync(legacy)) {
    for (const [from, to] of [
      [legacy, current],
      [`${legacy}-workspaces`, `${current}-workspaces`],
    ]) {
      try {
        if (existsSync(from) && !existsSync(to)) renameSync(from, to);
      } catch {
        // Keep going: the CLI can still use the legacy directory via
        // LARK_CHANNEL_HOME or the migrate command.
      }
    }
  }
}

// Must be dynamic: a static import is hoisted and resolves paths before the
// rename above runs.
await import('../dist/cli.js');
