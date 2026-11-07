/**
 * Rewrite absolute paths that point into the pre-rename state root.
 *
 * Renaming the directory is not enough: config.json keeps absolute paths for
 * the secrets-getter exec provider and for workspace defaults, and
 * workspaces.json can keep chat/named workspace paths. Rewriting on load lets
 * an upgraded install keep working without a manual config edit; the next save
 * persists the new paths.
 */
export function rewriteLegacyStatePaths<T>(
  value: T,
  legacyRoot: string,
  newRoot: string,
): T {
  const legacyWorkspaces = `${legacyRoot}-workspaces`;
  const newWorkspaces = `${newRoot}-workspaces`;

  const rewriteString = (input: string): string => {
    for (const sep of ['/', '\\']) {
      const legacy = `${legacyRoot}${sep}`;
      if (input === legacyRoot || input.startsWith(legacy)) {
        return `${newRoot}${input.slice(legacyRoot.length)}`;
      }
      const legacyWs = `${legacyWorkspaces}${sep}`;
      if (input === legacyWorkspaces || input.startsWith(legacyWs)) {
        return `${newWorkspaces}${input.slice(legacyWorkspaces.length)}`;
      }
    }
    return input;
  };

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return rewriteString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node)) out[key] = walk(val);
      return out;
    }
    return node;
  };

  return walk(value) as T;
}
