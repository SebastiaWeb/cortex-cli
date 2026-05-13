/**
 * Replicates Claude Code's directory encoding:
 *   re.sub(r'[^a-zA-Z0-9-]', '-', absolutePath)
 * Validated empirically in Fase 0 — lossy, cannot be reversed.
 */
export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/[^a-zA-Z0-9-]/g, '-');
}
