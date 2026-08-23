import { join, resolve, sep } from 'node:path';

/**
 * Joins `relPath` onto `base` and throws if the result escapes `base` —
 * guards writes driven by untrusted input (a remote manifest, a synced repo)
 * from writing outside the intended directory via "../" sequences.
 */
export function safeJoin(base: string, relPath: string): string {
  const resolvedBase = resolve(base);
  const dest = resolve(join(resolvedBase, relPath));
  if (dest === resolvedBase || !dest.startsWith(resolvedBase + sep)) {
    throw new Error(`Path traversal attempt blocked: ${relPath}`);
  }
  return dest;
}
