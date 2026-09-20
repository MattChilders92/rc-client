import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** `export { a, b as c, type T } from './x.ts'` → [{ name, from }] */
function exportsOf(indexSource: string): { name: string; from: string }[] {
  const out: { name: string; from: string }[] = [];
  const re = /export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g;
  for (const m of indexSource.matchAll(re)) {
    for (const raw of m[1]!.split(',')) {
      const name = raw.replace(/\btype\b/, '').trim().split(/\s+as\s+/)[0]!.trim();
      if (name) out.push({ name, from: m[2]! });
    }
  }
  return out;
}

/** Follow one level of re-export (a barrel like certificates/index.ts). */
function resolveDeclaration(name: string, from: string): { file: string; source: string } | null {
  const file = path.normalize(from);
  const source = read(file);
  const decl = new RegExp(`^export\\s+(?:async\\s+)?(?:function|const|let|class|interface|type|enum)\\s+${name}\\b`, 'm');
  if (decl.test(source)) return { file, source };
  for (const e of exportsOf(source)) {
    if (e.name === name) return resolveDeclaration(name, path.join(path.dirname(file), e.from));
  }
  return null;
}

function isDocumented(name: string, source: string): boolean {
  const decl = new RegExp(`^export\\s+(?:async\\s+)?(?:function|const|let|class|interface|type|enum)\\s+${name}\\b`, 'm');
  const at = source.search(decl);
  if (at < 0) return false;
  // A JSDoc documents a declaration only when it ends on the line directly
  // above it. A blank line in between is what separates a file's header
  // comment from the first export beneath it — and a header describes the
  // module, not that symbol. An earlier version asked only that *something*
  // precede the block, which an `import` line satisfied, so a header sitting
  // after the imports silently passed for the export under it.
  const before = source.slice(0, at);
  if (!/\*\/[ \t]*\r?\n[ \t]*$/.test(before)) return false;
  const open = before.lastIndexOf('/*');
  return open >= 0 && before.startsWith('/**', open) && !before.startsWith('/**/', open);
}

test('every public export has a JSDoc on its declaration', () => {
  const missing: string[] = [];
  for (const { name, from } of exportsOf(read('index.ts'))) {
    const found = resolveDeclaration(name, from);
    if (!found) { missing.push(`${name} (declaration not found from ${from})`); continue; }
    if (!isDocumented(name, found.source)) missing.push(`${name} in ${found.file}`);
  }
  assert.deepEqual(missing, [], `undocumented exports:\n  ${missing.join('\n  ')}`);
});
