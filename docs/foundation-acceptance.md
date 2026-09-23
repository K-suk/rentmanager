# Issue #2 acceptance evidence — 2026-09-23

Base: `affd6cc7514421332c24708977b10f2ce3a4ebd1` (verified Issue #1). Scope: foundation only; feature UI and public seed/reset are subsequent issues. Original requirement documents and their approved2026-09-23 auth override were read and preserved. No UI files changed; apple-design application is required of #3 onward. Skills read: Orca orchestration (`/Users/kosuke/.agents/skills/orchestration/SKILL.md` + version-matched CLI guide), Neon postgres and parent Neon (`/Users/kosuke/.codex/plugins/cache/openai-curated-remote/neon-postgres/2.0.0/skills/`). Existing pg and fixed dependencies retained per explicit task instruction.

## Verified so far

- Locked `npm ci`:403 packages, audit0 vulnerabilities. Existing versions and lockfile retained; no new dependency.
- Node24.21.0: `npm run typecheck`, `npm run lint`, `npm test` (21 passing), `npm run build` passed. Static auth probe UI and dynamic auth/me/employees routes build successfully; feature routes intentionally not yet present.
- Coordinator-provisioned empty `rentmanager_foundation_test` database on development Neon branch `br-calm-field-b382izdc`, identity `rentmanager-foundation-test-20260923`: empty migration, repeat migration and protected-admin bootstrap passed. This is separate database isolation on the dedicated development branch, not a claim of another branch or public clone.
- Existing dedicated application dev DB migration passed without reset. No public DB migration, reset, deployment, merge or issue close performed by this worker.
- First real Neon integration suite:7 tests passed (top-level +6 subtests),159.7s. Concurrent borrow/delete/extend/return outcomes, retries, inactive/unauthorized rejection, snapshots/FK/immutable protected rows, inactive-inclusive employee20 cap, active equipment100 cap. A second run adds explicit multi-extension-chain and history-only commit rejection; results appended when complete.

## Acceptance scope and remaining work

Foundation supplies the transaction kernel, SQL integrity, types, validation/JST helpers, immutable protected identity compatibility, error contract, test-only fixtures, guarded migration/bootstrap, and CI. Each feature owner must implement and verify its own HTTP/read-query/UI boundary using `docs/contracts.md`; no UI acceptance is claimed. #9 owns public seed/reset and re-run acceptance with protected admin retention. #10 owns full browser/device, shared-demo business flow and performance acceptance; serialized mutation locking favors correctness at the specified small demo size and is not a performance measurement.

Secrets are runtime-injected through coordinator runners outside Git. `.env.example` lists names only. Live fixture writes only target the named isolated test database; read/change protected identity attacks roll back. The existing dev database receives only additive migrations. CI uses a new disposable PostgreSQL17 service under explicit isolated-CI mode, with no Neon secret requirement.
