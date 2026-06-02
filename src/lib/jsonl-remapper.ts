/**
 * Rewrites absolute paths in Claude Code JSONL session files.
 *
 * Rules (from Fase 0 analysis):
 *  - ONLY rewrite the 4 structural fields: cwd, filePath, file_path, file.filePath
 *  - Leave historical/command/content fields untouched
 *  - Preserve each line's original EOL bytes (LF or CRLF)
 *  - Lines that are not valid JSON are passed through unchanged
 */

/** Replace oldPrefix with newPrefix in a string value, only if it starts with oldPrefix. */
function remapPath(value: unknown, oldPrefix: string, newPrefix: string): unknown {
  if (typeof value === 'string' && value.startsWith(oldPrefix)) {
    return newPrefix + value.slice(oldPrefix.length);
  }
  return value;
}

function remapLine(parsed: Record<string, unknown>, oldPath: string, newPath: string): boolean {
  let changed = false;

  // cwd (top-level)
  if ('cwd' in parsed) {
    const next = remapPath(parsed['cwd'], oldPath, newPath);
    if (next !== parsed['cwd']) { parsed['cwd'] = next; changed = true; }
  }

  // toolUseResult.filePath
  const tur = parsed['toolUseResult'];
  if (tur !== null && typeof tur === 'object') {
    const r = tur as Record<string, unknown>;
    if ('filePath' in r) {
      const next = remapPath(r['filePath'], oldPath, newPath);
      if (next !== r['filePath']) { r['filePath'] = next; changed = true; }
    }
    // toolUseResult.file.filePath
    const f = r['file'];
    if (f !== null && typeof f === 'object') {
      const ff = f as Record<string, unknown>;
      if ('filePath' in ff) {
        const next = remapPath(ff['filePath'], oldPath, newPath);
        if (next !== ff['filePath']) { ff['filePath'] = next; changed = true; }
      }
    }
  }

  // message.content[].input.file_path
  const msg = parsed['message'];
  if (msg !== null && typeof msg === 'object') {
    const content = (msg as Record<string, unknown>)['content'];
    if (Array.isArray(content)) {
      for (const item of content as Array<Record<string, unknown>>) {
        const input = item['input'];
        if (input !== null && typeof input === 'object') {
          const inp = input as Record<string, unknown>;
          if ('file_path' in inp) {
            const next = remapPath(inp['file_path'], oldPath, newPath);
            if (next !== inp['file_path']) { inp['file_path'] = next; changed = true; }
          }
        }
      }
    }
  }

  return changed;
}

/**
 * Rewrites all path references from `oldPath` to `newPath` in a JSONL buffer,
 * preserving original EOL bytes per line.
 *
 * Returns a new Buffer with the remapped content.
 */
export function remapJsonlBuffer(
  input: Buffer,
  oldPath: string,
  newPath: string,
): Buffer {
  if (oldPath === newPath) return input;

  const parts: Buffer[] = [];
  let lineStart = 0;

  for (let i = 0; i <= input.length; i++) {
    const atEnd = i === input.length;
    const byte = atEnd ? undefined : input[i];
    const isLF = byte === 0x0a;

    if (!isLF && !atEnd) continue;

    // Slice from lineStart to i (exclusive of the LF)
    const lineEnd = i;
    // Detect CRLF: if the line ends just before a LF and last char is CR
    let contentEnd = lineEnd;
    if (contentEnd > lineStart && input[contentEnd - 1] === 0x0d) {
      contentEnd--;
    }

    const lineBytes = input.slice(lineStart, contentEnd);

    // Capture the EOL (CR+LF or LF or nothing at end)
    const eolBytes = input.slice(contentEnd, isLF ? lineEnd + 1 : lineEnd);

    const lineStr = lineBytes.toString('utf-8').trim();
    if (lineStr.length > 0) {
      try {
        const raw = JSON.parse(lineStr);
        // Only remap JSON objects. Strings, numbers, arrays, and null are passed
        // through unchanged — they cannot contain structural path fields.
        if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
          const parsed = raw as Record<string, unknown>;
          const changed = remapLine(parsed, oldPath, newPath);
          // Only re-serialize when a path actually changed; otherwise preserve the
          // original bytes so checksums remain stable for unmodified lines.
          parts.push(changed ? Buffer.from(JSON.stringify(parsed), 'utf-8') : lineBytes);
        } else {
          parts.push(lineBytes);
        }
      } catch {
        // Not valid JSON — pass through as-is
        parts.push(lineBytes);
      }
    } else {
      parts.push(lineBytes);
    }

    parts.push(eolBytes);
    lineStart = i + 1;
  }

  return Buffer.concat(parts);
}

/**
 * Given a JSONL buffer, extracts the first `cwd` value found.
 * Used to determine the original project path for remapping.
 */
export function extractCwdFromJsonl(input: Buffer): string | null {
  const text = input.toString('utf-8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof parsed['cwd'] === 'string' && parsed['cwd'].length > 0) {
        return parsed['cwd'] as string;
      }
    } catch {
      continue;
    }
  }
  return null;
}
