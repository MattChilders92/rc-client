import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { signIn } from '../src/auth/index.ts';
import { RcShapeError } from '../src/errors.ts';

/**
 * `signIn` decodes the id_token's JWT payload itself (`atob` + `JSON.parse`).
 * Both throw un-typed built-ins on malformed input — `DOMException` for a
 * base64-invalid segment, `SyntaxError` for base64-valid non-JSON — and both
 * must come out as `RcShapeError`, per the "every throw is an Rc*Error"
 * guarantee this library advertises.
 */

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubAuthorizeFlow(idToken: string) {
  let step = 0;
  globalThis.fetch = (async () => {
    step++;
    if (step === 1) {
      // Step 1: OpenAM authenticate.
      return new Response(JSON.stringify({ tokenId: 't' }), { status: 200 });
    }
    // Step 2: OAuth2 authorize.
    return new Response(
      JSON.stringify({ access_token: 'a', id_token: idToken, expires_in: 3600 }),
      { status: 200 },
    );
  }) as typeof fetch;
}

test('a base64-invalid id_token payload segment is an RcShapeError', async () => {
  stubAuthorizeFlow('a.!!!.c');
  await assert.rejects(
    signIn({ username: 'u', password: 'p' }),
    (e: unknown) => {
      assert.ok(e instanceof RcShapeError, `expected RcShapeError, got ${(e as Error).constructor?.name}`);
      assert.match((e as Error).message, /not decodable JSON/);
      return true;
    },
  );
});

test('a base64-valid but non-JSON id_token payload is an RcShapeError', async () => {
  const payload = Buffer.from('not json').toString('base64');
  stubAuthorizeFlow(`a.${payload}.c`);
  await assert.rejects(
    signIn({ username: 'u', password: 'p' }),
    (e: unknown) => {
      assert.ok(e instanceof RcShapeError, `expected RcShapeError, got ${(e as Error).constructor?.name}`);
      assert.match((e as Error).message, /not decodable JSON/);
      return true;
    },
  );
});
