# rc-client — publishable package

**Date:** 2026-09-19
**Status:** approved for planning (autonomous run; judgment calls listed at the end)

## Problem

`rc-client` works and is verified live, but it is not a package anyone else can
install. It is marked `private`, exports raw `.ts` source with no build, carries
no license, ships reverse-engineering notes about Royal's private mobile gateway,
throws plain `Error` from two functions despite a documented typed-error
contract, and has grown three copies of the same coercion helpers. A survey of
the whole repo found 45 items: 6 blocking, 19 should-fix, 20 nits.

## Goal

A package that a stranger can `npm install`, import from plain Node with types,
read the README and use — with nothing secret or identifying anywhere in the
tarball or the git history, every exported symbol documented, and the code
shaped so the next change lands in an obvious place.

## Non-goals

- Publishing. The package becomes publishable; the `npm publish` is the owner's
  act (nobody is logged in to npm here).
- Changing what the library does. No new endpoints, no behaviour changes beyond
  the error contract fix. CruiseWatch is the only consumer and must stay green.
- A base-URL override. Royal's hosts are the only ones that answer; a consumer
  cannot meaningfully point this elsewhere.
- Renaming the package. `rc-client` is free on npm and every consumer import is
  the bare specifier; the description and keywords carry discoverability.

## 1. Secrets, keys and identifying data

**What the scan found.** No credential, token, or unredacted PII exists in any
tracked file or anywhere in the 13-commit history. Fixtures are already
scrubbed (`REDACTED`, zero-uuids, `example.com`). The only real key in the code
is Royal's **public** web app key — the value their own site sends from public
JavaScript, and without which sign-in cannot complete.

**Decisions.**
- The app key stays, but is renamed to say what it is: `RC_PUBLIC_APP_KEY`, with a
  JSDoc stating it is Royal's public client identifier shipped in their site JS,
  not a secret, and that it can be overridden (see §3). Removing it would ship a
  client that cannot sign in.
- A committed test, `test/fixtures-redacted.test.ts`, fails if any fixture ever
  contains an email outside `example.com`, a JWT-shaped string, a non-`REDACTED`
  value under any key in the capture script's redaction set, or a non-zero uuid.
  The redaction set is exported from a small module both the capture script and
  the test import, so they cannot drift.
- `scripts/` (which read `RC_USERNAME`/`RC_PASSWORD` from the environment) are
  dev tooling and are excluded from the tarball.
- The git author email is ordinary commit metadata and stays.

## 2. What ships, and what must not

`docs/endpoints.md` currently documents Royal's **private** gateway hostnames
(`*.private.prd.ecom.rccl.io`), the mobile app's APK signing-certificate hash,
and notes on Akamai Bot Manager. That is research, not consumer documentation,
and publishing it on npm is a legal and reputational exposure with no upside
for a user of the library.

- The whole "The mobile app" section moves to `docs/research/mobile-app.md`.
  The private hostnames are removed from `docs/endpoints.md`; where a hostname
  is needed to explain a symptom, the public `www.royalcaribbean.com` route is
  named instead. `docs/research/` is excluded from the tarball and linked from
  the README as background only.
- The tarball is exactly: `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`,
  `docs/endpoints.md`, `docs/design.md`. Verified by `npm pack --dry-run` in the
  plan.

## 3. Configuration instead of hard-coding

A consumer can legitimately need to change the user agent (pinned to a Chrome
version that will go stale), the app key (if Royal rotates it), and the
request timeout and retry count. Today these are module constants.

- New `src/config.ts`: `interface RcConfig { appKey: string; userAgent: string;
  timeoutMs: number; retries: number }`, `DEFAULT_CONFIG`, and
  `resolveConfig(partial?: Partial<RcConfig>): RcConfig`.
- `RcClient` gains a second constructor argument, `options?: Partial<RcConfig>`,
  and passes the resolved config to every call it makes.
- Header builders take `(session, config = DEFAULT_CONFIG)`. Domain functions
  that build headers take an optional trailing `config` parameter. `request()`
  reads its timeout and retry defaults from a config argument. Standalone
  callers who pass nothing get today's behaviour exactly.
- Two query-level values that vary by market are exposed on their query types
  with today's values as defaults: `RoomQuery.officeCode` (`'MIA'`) and
  `ProductQuery.regionCode` (`'ALCAN'`).

## 4. Error contract

Every failure a consumer can catch is an `Rc*Error`. Two functions break this:
`searchCruises` and `fetchItineraryPorts` throw a plain `Error` when GraphQL
reports errors inside a 200, and `downloadPdf` throws a plain `Error` on a
non-OK status.

- GraphQL errors become `RcRequestError` (the request was well-formed HTTP but
  rejected by the API), with the GraphQL error list on `body`.
- `downloadPdf` throws `RcError` carrying `status` and `url`, or
  `RcUnavailableError` for 429/503, matching `request()`.
- A test pins each.

## 5. Shape of the code

- **One coercion module**, `src/coerce.ts`, exporting `str`, `num`, `int` and
  `money`. The seven local copies (`nn`, `str`, `text`, `num`, `int`) are
  replaced by imports. The two `money` helpers have different semantics
  (products rejects zero; certificates strips `$` and allows zero), so
  `money` in `coerce.ts` is the products one and certificates keeps a local,
  distinctly named `dollarsFromCell`.
- **`certificates.ts` splits** into a directory: `discover.ts` (campaign
  candidates and HEAD probing), `pdf.ts` (download), `parse.ts` (page and tier
  parsing), `index.ts` re-exporting the same public names. No public name
  changes.
- **Public surface is deliberate.** `src/index.ts` is reorganised into labelled
  groups: the client; domain functions and types; errors; and, under a heading
  saying so, the transport layer (`request`, header builders, config) for
  callers who manage their own session. `SORT_FIELDS` is kept because
  `OfferSortField` is derived from it and consumers need the runtime list to
  validate input. `roomTypeOf` is exported, since `parseTierPages` output is
  only interpretable with it.
- `RcClient` gains `static itineraryPorts()` beside `static search()`, since the
  two are the same credential-free GraphQL and one was reachable through the
  client while the other was not. Certificates stay a standalone module: they
  are PDF tooling, not an API call, and the README says so.
- `casinoLoyalty()`, `bookings()`, `products()` on `RcClient` get JSDoc like
  their siblings; `RcResponse`, `RequestOptions`, `RoomQuery`, `SearchParams`,
  `ListBookingsOptions` get field-level JSDoc; `RcError` gets a class doc.
- **A documentation gate.** `test/exports-documented.test.ts` parses
  `src/index.ts`, resolves each exported name to its declaration, and fails if
  the declaration is not immediately preceded by a `/** … */` block. This is a
  regex-level check, not a type-checker walk, and that is enough.
- Return shapes are left as they are and the rule is written down in
  `docs/design.md`: a bare array when the call cannot partially fail, a wrapper
  object when it carries an outcome or a partial-failure count. Changing
  `listBookings` would break the only consumer for no user-visible gain.

## 6. Packaging

- `tsconfig.build.json` extends the base with `noEmit: false`, `declaration`,
  `declarationMap`, `sourceMap`, `outDir: dist`, `rootDir: src`, `include:
  src/**`. A probe confirmed: the emitted JS rewrites `.ts` specifiers to `.js`
  and loads in plain Node; the `.d.ts` files keep `.ts` specifiers and a
  NodeNext consumer with `skipLibCheck: false` still typechecks and runs.
- `package.json`: `private` removed; `version` `1.0.0`; `license` `MIT`;
  `exports: { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`;
  `types`; `files` as in §2; `sideEffects: false`; `repository`, `homepage`,
  `bugs`, `author`, `keywords`; scripts `build`, `prepare` (build, so a
  `file:` or git consumer gets `dist/` on install), `prepublishOnly`
  (typecheck, test, build), `pack:check` (`npm pack --dry-run`).
- `dist/` is git-ignored.
- `LICENSE` (MIT, owner's name from git config), `CHANGELOG.md` starting at
  1.0.0 with the breaking note that the package now ships compiled output.
- `engines.node >= 20.3` — `AbortSignal.any` is the floor.

## 7. Documentation

- README: an Install section; the mobile row removed from the auth table (it
  is research, not a feature); the "Status" section replaced by a short
  "Verified" list plus a link to CHANGELOG; a "Configuration" section for §3; a
  "Standalone functions" section naming the transport exports and the
  certificate tooling; every code sample checked against the real signatures.
- `docs/design.md`: the "Not done" section is stale (offers *are* verified
  against 13 real offers; no Celebrity agency id exists in the code; only
  `rooms` has a brand switch). It is rewritten to say what is true, and gains
  the return-shape rule and the configuration rationale.
- `docs/endpoints.md`: sanitised per §2; otherwise unchanged.

## 8. Consumer compatibility

CruiseWatch resolves `rc-client` through a `file:` symlink and imports only the
bare specifier. After the `exports` change it will load `dist/index.js`, so the
plan ends with: build, run CruiseWatch's `npm install` (which triggers
`prepare`), and require CruiseWatch's `npm test` and `npm run typecheck` to pass
unchanged. Every public name CruiseWatch imports is preserved.

## Testing

- Existing 30 tests keep passing at every task.
- New: fixtures-redacted gate; exports-documented gate; typed-error tests for
  the three functions in §4; a `coerce.ts` unit test; a packaging test that
  builds, packs to a temp dir, installs into a throwaway consumer, and
  typechecks and runs it (the same probe done by hand today, made permanent).

## Judgment calls made without asking (revisit if wrong)

1. **The public app key ships**, renamed to say it is public. The alternative
   is a package that cannot sign in.
2. **MIT license.** Conventional for a client library; change the file if you
   want something else.
3. **Package name stays `rc-client`.** It is free on npm.
4. **The mobile-app research leaves the tarball** but stays in the repo under
   `docs/research/`. If the GitHub repo is public, that content is still
   public; deleting it from history is a separate decision.
5. **Return shapes unchanged.** Consistency was weighed against breaking the
   only consumer, and consistency lost; the rule is documented instead.
6. **Not addressed:** a base-URL override; the `req-app-vers: 1.0.7` header
   pin; `any` at the JSON boundary (load-bearing, and `raw` is kept by design).
