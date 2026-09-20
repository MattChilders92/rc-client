import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';

// On Windows, npm.cmd is a batch file and must run through the shell. execFileSync's
// shell mode joins `file` and `args` with plain spaces before handing them to cmd.exe,
// so any argument that itself contains a space or a backslash-adjacent quote (the temp
// directory, which may contain spaces) has to be quoted here — shell mode does not do
// it for us. Plain `node` invocations below stay off the shell entirely, since Windows
// passes argv arrays through natively without needing any of this.
const quoteForWindowsShell = (arg: string): string =>
  /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;

const run = (cmd: string, args: string[], cwd: string): string => {
  const useShell = isWin && /\.cmd$/i.test(cmd);
  return execFileSync(cmd, useShell ? args.map(quoteForWindowsShell) : args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: useShell,
  });
};

// `npm pack --json` runs the `prepare` lifecycle script first, and that script (our own
// `build`) can print tsc/npm noise. In practice that noise lands on stderr, which we
// never capture, but nothing guarantees that on every npm version — so parse the last
// top-level JSON array in stdout rather than assuming the whole string is JSON.
const parsePackJson = (stdout: string): { filename: string; files: { path: string }[] } => {
  const lines = stdout.split(/\r?\n/);
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '[') {
      start = i;
      break;
    }
  }
  const jsonText = start === -1 ? stdout : lines.slice(start).join('\n');
  const [entry] = JSON.parse(jsonText) as [{ filename: string; files: { path: string }[] }];
  return entry;
};

test(
  'the packed tarball installs, typechecks and runs in a plain NodeNext consumer',
  { skip: process.env.RC_SKIP_PACKAGING ? 'RC_SKIP_PACKAGING set' : false },
  () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-client-pack-'));
    try {
      run(npm, ['run', 'build'], ROOT);
      const packed = run(npm, ['pack', '--json', '--pack-destination', tmp], ROOT);
      const { filename, files } = parsePackJson(packed);

      const shipped = files.map((f) => f.path);
      assert.ok(shipped.includes('dist/index.js') && shipped.includes('dist/index.d.ts'), 'dist is shipped');
      assert.ok(shipped.includes('LICENSE') && shipped.includes('README.md'), 'license and readme ship');

      // Strict allowlist: nothing sensitive (src/, test/, scripts/, docs/research,
      // .superpowers, .env, stray tarballs) ever leaves the package.
      const allowedExact = new Set([
        'README.md',
        'LICENSE',
        'CHANGELOG.md',
        'docs/endpoints.md',
        'docs/design.md',
        'package.json',
      ]);
      const unexpected = shipped.filter((p) => !p.startsWith('dist/') && !allowedExact.has(p));
      assert.deepEqual(unexpected, [], `unexpected files shipped: ${unexpected.join(', ')}`);

      const consumer = path.join(tmp, 'consumer');
      fs.mkdirSync(consumer);
      fs.writeFileSync(
        path.join(consumer, 'package.json'),
        JSON.stringify({ name: 'c', version: '0.0.0', type: 'module', private: true }),
      );
      fs.writeFileSync(
        path.join(consumer, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            noEmit: true,
            target: 'ES2023',
            skipLibCheck: false,
            types: [],
          },
          include: ['main.ts'],
        }),
      );
      fs.writeFileSync(
        path.join(consumer, 'main.ts'),
        [
          "import { RcClient, RcError, RC_PUBLIC_APP_KEY, type RcOffer } from 'rc-client';",
          "const c = new RcClient({ username: 'u', password: 'p' }, { retries: 0 });",
          "const e: RcError = new RcError('x', { url: 'u' });",
          'const o: RcOffer | null = null;',
          // One pre-joined string: console.log colours a bare null or number when the
          // parent terminal has colour on, and the assertion below must not depend on that.
          "console.log([typeof c.offers, e.url, String(o), RC_PUBLIC_APP_KEY.length].join(' '));",
        ].join('\n'),
      );
      run(npm, ['install', '--no-audit', '--no-fund', '--silent', path.join(tmp, filename)], consumer);
      // The consumer needs a compiler; borrow this repo's.
      fs.symlinkSync(
        path.join(ROOT, 'node_modules', 'typescript'),
        path.join(consumer, 'node_modules', 'typescript'),
        'junction',
      );
      run('node', [path.join(consumer, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], consumer);
      const out = run(
        'node',
        ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', 'main.ts'],
        consumer,
      );
      assert.match(out, /^function u null 32/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
);
