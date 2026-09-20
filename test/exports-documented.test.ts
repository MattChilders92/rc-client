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
  // The text immediately before the declaration, ignoring blank lines, must end a JSDoc block.
  const before = source.slice(0, at).replace(/\s+$/, '');
  if (!before.endsWith('*/')) return false;
  // Find the JSDoc block that actually touches the declaration — the *last* of
  // possibly several `/** ... */` blocks in `before` — rather than a single
  // greedy match from the first `/**` in the file, which would also swallow an
  // unrelated block sitting further up (e.g. a module doc two blocks earlier).
  const blocks = [...before.matchAll(/\/\*\*[\s\S]*?\*\//g)];
  const last = blocks.at(-1);
  if (!last) return false;
  // A JSDoc that is the very first thing in the file is the module's header
  // comment, not this declaration's. When nothing but that header (no imports,
  // no other code) separates it from the declaration it still passes the
  // whitespace-only test above, but it isn't really documenting this specific
  // export — e.g. errors.ts opens with a doc about the error taxonomy in
  // general, directly above `RcError`, which needs its own explanation of what
  // `status`/`url`/`body` mean. Require *something* — even one prior doc block
  // — before the one immediately touching the declaration.
  return before.slice(0, last.index).trim() !== '';
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
