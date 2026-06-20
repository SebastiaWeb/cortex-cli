# Cortex Path Hint in CLAUDE.md

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inyectar automáticamente en `.claude/CLAUDE.md` un bloque que le indica a Claude cuál es la ruta del proyecto en esta máquina, para que resuelva rutas de sesiones compartidas correctamente sin tocar el historial.

**Architecture:** Una función `injectCortexPathBlock(content, cwd)` en `claude-skills.ts` gestiona el bloque delimitado `<!-- cortex-sync:start/end -->`. `install.ts` y `team/pull.ts` la llaman al escribir CLAUDE.md. El bloque se reemplaza en cada pull para mantenerse actualizado.

**Tech Stack:** TypeScript (strict, ESM), vitest.

---

## Estructura de archivos

- **Modify:** `src/lib/claude-skills.ts` — añadir y exportar `injectCortexPathBlock`
- **Modify:** `src/commands/install.ts` — llamar `injectCortexPathBlock` antes de escribir CLAUDE.md
- **Modify:** `src/commands/team/pull.ts` — igual, en los tres branches (new, overwrite, merge)
- **Modify:** `tests/lib/claude-skills.test.ts` — añadir tests de la nueva función
- **Modify:** `package.json` + `.claude/CLAUDE.md` — bump a 0.4.12

---

### Task 1: Tests para `injectCortexPathBlock` (failing)

**Files:**
- Modify: `tests/lib/claude-skills.test.ts`

- [ ] **Step 1: Añadir el describe block al final del archivo existente**

Leer primero el contenido actual de `tests/lib/claude-skills.test.ts`, luego añadir al final:

```typescript
// ── injectCortexPathBlock ──────────────────────────────────────────
import { injectCortexPathBlock } from '../../src/lib/claude-skills.js';

const START = '<!-- cortex-sync:start -->';
const END = '<!-- cortex-sync:end -->';

describe('injectCortexPathBlock', () => {
  it('prepends block when no existing block', () => {
    const result = injectCortexPathBlock('# Team docs\n\nSome content.', '/home/alice/project');
    expect(result.indexOf(START)).toBe(0);
    expect(result).toContain('`/home/alice/project`');
    expect(result).toContain(END);
    expect(result).toContain('# Team docs');
  });

  it('replaces existing block in-place, preserving surrounding content', () => {
    const old = [
      START,
      '> **[cortex-sync]** Project root on this machine: `/home/old/path`',
      '> Sessions shared via cortex-sync may reference paths from other machines. Always resolve file operations against the project root above.',
      END,
      '',
      '# Team docs',
    ].join('\n');

    const result = injectCortexPathBlock(old, '/home/new/path');
    expect(result).toContain('`/home/new/path`');
    expect(result).not.toContain('`/home/old/path`');
    expect(result).toContain('# Team docs');
    expect(result.split(START).length).toBe(2); // only one block
  });

  it('works with empty content (no team CLAUDE.md)', () => {
    const result = injectCortexPathBlock('', '/home/alice/project');
    expect(result).toContain(START);
    expect(result).toContain('`/home/alice/project`');
    expect(result).toContain(END);
  });

  it('works with Windows paths', () => {
    const result = injectCortexPathBlock('# Docs', 'C:\\Users\\alice\\project');
    expect(result).toContain('`C:\\Users\\alice\\project`');
  });

  it('block is always at the very start of the output', () => {
    const result = injectCortexPathBlock('# Existing content', '/home/alice/project');
    expect(result.startsWith(START)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr solo los nuevos tests para confirmar que fallan**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A 3 "injectCortexPathBlock"
```

Expected: `ReferenceError: injectCortexPathBlock is not defined` o `FAIL`.

- [ ] **Step 3: Commit tests failing**

```bash
git add tests/lib/claude-skills.test.ts
git commit -m "test: add injectCortexPathBlock tests (failing)"
```

---

### Task 2: Implementar `injectCortexPathBlock` en `claude-skills.ts`

**Files:**
- Modify: `src/lib/claude-skills.ts`

- [ ] **Step 1: Añadir la función al final de `src/lib/claude-skills.ts`**

```typescript
const CORTEX_BLOCK_START = '<!-- cortex-sync:start -->';
const CORTEX_BLOCK_END = '<!-- cortex-sync:end -->';

export function injectCortexPathBlock(content: string, cwd: string): string {
  const block = [
    CORTEX_BLOCK_START,
    `> **[cortex-sync]** Project root on this machine: \`${cwd}\``,
    `> Sessions shared via cortex-sync may reference paths from other machines. Always resolve file operations against the project root above.`,
    CORTEX_BLOCK_END,
  ].join('\n');

  const startIdx = content.indexOf(CORTEX_BLOCK_START);
  const endIdx = content.indexOf(CORTEX_BLOCK_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Reemplazar bloque existente en su lugar
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + CORTEX_BLOCK_END.length);
    return before + block + after;
  }

  // No hay bloque previo — prepend
  const separator = content.length > 0 ? '\n\n' : '';
  return block + separator + content;
}
```

- [ ] **Step 2: Correr todos los tests**

```bash
npm test 2>&1
```

Expected: todos pasan — los nuevos de `injectCortexPathBlock` en verde.

- [ ] **Step 3: Commit**

```bash
git add src/lib/claude-skills.ts tests/lib/claude-skills.test.ts
git commit -m "feat: add injectCortexPathBlock to inject local project root in CLAUDE.md"
```

---

### Task 3: Usar `injectCortexPathBlock` en `install.ts`

**Files:**
- Modify: `src/commands/install.ts`

Actualmente `install.ts` escribe CLAUDE.md así:

```typescript
const claudeMd = await readFileFromPath(join(TEAM_DIR, 'CLAUDE.md'));
if (claudeMd) {
  await writeFileToPath(LOCAL_CLAUDE_MD, claudeMd);
  console.log('  + .claude/CLAUDE.md');
}
```

- [ ] **Step 1: Añadir el import de `injectCortexPathBlock` en `install.ts`**

Modificar la línea de import existente de `claude-skills.js`:

```typescript
import {
  readSkillsFromDir, writeSkillToDir, readFileFromPath, writeFileToPath,
  LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD, injectCortexPathBlock,
} from '../lib/claude-skills.js';
```

- [ ] **Step 2: Reemplazar el bloque de escritura de CLAUDE.md**

Reemplazar:

```typescript
const claudeMd = await readFileFromPath(join(TEAM_DIR, 'CLAUDE.md'));
if (claudeMd) {
  await writeFileToPath(LOCAL_CLAUDE_MD, claudeMd);
  console.log('  + .claude/CLAUDE.md');
}
```

Con:

```typescript
const teamMd = await readFileFromPath(join(TEAM_DIR, 'CLAUDE.md')) ?? '';
const claudeMdWithBlock = injectCortexPathBlock(teamMd, process.cwd());
await writeFileToPath(LOCAL_CLAUDE_MD, claudeMdWithBlock);
if (teamMd) console.log('  + .claude/CLAUDE.md');
```

> Nota: siempre escribimos el bloque, aunque el equipo no tenga CLAUDE.md — así todos los devs tienen el path hint independientemente.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1
```

Expected: sin errores.

- [ ] **Step 4: Correr tests**

```bash
npm test 2>&1
```

Expected: todos pasan.

- [ ] **Step 5: Commit**

```bash
git add src/commands/install.ts
git commit -m "feat: inject cortex path hint into CLAUDE.md on cortex install"
```

---

### Task 4: Usar `injectCortexPathBlock` en `team/pull.ts`

**Files:**
- Modify: `src/commands/team/pull.ts`

Actualmente el bloque de CLAUDE.md en `team/pull.ts` tiene tres ramas (`overwrite`, `merge`, sin conflicto/nuevo). En las tres hay que inyectar el bloque.

- [ ] **Step 1: Añadir el import de `injectCortexPathBlock`**

Modificar la línea de import existente de `claude-skills.js`:

```typescript
import {
  readSkillsFromDir, writeSkillToDir, readFileFromPath, writeFileToPath,
  LOCAL_SKILLS_DIR, LOCAL_CLAUDE_MD, injectCortexPathBlock,
} from '../../lib/claude-skills.js';
```

- [ ] **Step 2: Reemplazar el bloque completo de CLAUDE.md**

Reemplazar desde `const remoteMd = await readFileFromPath(join(TEAM_DIR, 'CLAUDE.md'));` hasta el `}` que cierra ese if, con:

```typescript
const remoteMd = await readFileFromPath(join(TEAM_DIR, 'CLAUDE.md'));
if (remoteMd) {
  const localMd = await readFileFromPath(LOCAL_CLAUDE_MD);
  if (!localMd) {
    await writeFileToPath(LOCAL_CLAUDE_MD, injectCortexPathBlock(remoteMd, process.cwd()));
    console.log('  + CLAUDE.md (new)');
  } else if (hasConflict(localMd, remoteMd)) {
    const resolution = await promptConflict('CLAUDE.md', localMd, remoteMd);
    if (resolution === 'overwrite') {
      await writeFileToPath(LOCAL_CLAUDE_MD, injectCortexPathBlock(remoteMd, process.cwd()));
      console.log('  ✓ CLAUDE.md overwritten');
    } else if (resolution === 'merge') {
      const merged = mergeContent(localMd, remoteMd);
      await writeFileToPath(LOCAL_CLAUDE_MD, injectCortexPathBlock(merged, process.cwd()));
      console.log('  ✓ CLAUDE.md merged');
    } else {
      console.log('  ~ CLAUDE.md skipped');
    }
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1
```

Expected: sin errores.

- [ ] **Step 4: Correr todos los tests**

```bash
npm test 2>&1
```

Expected: todos pasan.

- [ ] **Step 5: Commit**

```bash
git add src/commands/team/pull.ts
git commit -m "feat: inject cortex path hint into CLAUDE.md on cortex team pull"
```

---

### Task 5: Bump versión y build final

**Files:**
- Modify: `package.json`
- Modify: `.claude/CLAUDE.md`

- [ ] **Step 1: Bump versión**

En `package.json`: `"version": "0.4.11"` → `"version": "0.4.12"`

En `.claude/CLAUDE.md`: actualizar la línea de versión a `` `0.4.12` — published on npm as `cortex-sync` ``

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -3
```

Expected: `ESM ⚡️ Build success`

- [ ] **Step 3: Correr tests completos**

```bash
npm test 2>&1
```

Expected: todos pasan.

- [ ] **Step 4: Commit**

```bash
git add package.json .claude/CLAUDE.md
git commit -m "chore: bump to 0.4.12"
```

---

## Resultado final

Cuando un dev corre `cortex install` o `cortex team pull`, su `.claude/CLAUDE.md` queda así:

```markdown
<!-- cortex-sync:start -->
> **[cortex-sync]** Project root on this machine: `/Users/mimac/Documentos/OtroDevSimulacion`
> Sessions shared via cortex-sync may reference paths from other machines. Always resolve file operations against the project root above.
<!-- cortex-sync:end -->

# Team CLAUDE.md
... contenido del equipo ...
```

Claude lee esto al iniciar cualquier sesión en ese proyecto → sabe que las rutas de otras máquinas deben resolverse contra `/Users/mimac/...` → resuelve archivos correctamente sin tocar el historial.
