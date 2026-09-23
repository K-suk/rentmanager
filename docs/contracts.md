# Foundation contracts — approved requirements, implementation agreement 2026-09-23

This document specifies implementation choices for Issues #3–#9; it does not replace or relax the three approved requirement documents. Their original text and dated approval/auth exception are preserved. ADR-005 is current: application-hosted Better Auth 1.7.5 on Neon Postgres. Managed Neon Auth references in the original requirements are historical. No feature UI is implemented by #2.

## Shared ownership and files

Only the foundation owner, under coordinator review, changes `db/migrations/*`, `scripts/auth/*`, `src/lib/{auth,db,security,provision,dates,validation,errors,transactions,operations,contracts}.ts`, `package*.json`, `tsconfig.json`, common CI and `tests/fixtures/data.ts`. Request shared changes rather than editing these from a feature branch. Existing dependency versions remain fixed. No feature migration or dependency installation without coordination.

| Owner | Page paths / files | HTTP routes and feature modules |
|---|---|---|
| #3 | `src/app/login/page.tsx`, `src/app/page.tsx` redirect, `src/app/(app)/layout.tsx`, `src/app/layout.tsx`, `src/app/style.css`, `src/components/ui/*`, `src/components/app-shell/*` | existing `/api/auth/[...all]`, `/api/me` remain shared; #3 owns login/session UI and protected layout |
| #4 | `src/app/(app)/equipment/page.tsx`, `src/features/equipment-list/*` | `src/app/api/equipment/route.ts` GET; `src/app/api/loans/borrow/route.ts` POST; `src/features/equipment-list/server.ts` |
| #5 | `src/app/(app)/my-loans/page.tsx`, `src/app/(app)/admin/loans/page.tsx`, `src/features/loan-actions/*` | `/api/loans/mine` GET, `/api/admin/loans` GET, `/api/loans/return` POST, `/api/loans/extend` POST; `src/features/loan-actions/server.ts` |
| #6 | `src/app/(app)/history/page.tsx`, `src/features/history/*` | `/api/history` GET, `/api/history/[id]/extensions` GET; `src/features/history/server.ts` |
| #7 | `src/app/(app)/admin/equipment/page.tsx`, `src/features/equipment-admin/*` | `/api/admin/equipment` GET/POST, `/api/admin/equipment/[id]` PATCH/DELETE; `src/features/equipment-admin/server.ts` |
| #8 | `src/app/(app)/admin/employees/page.tsx`, `src/features/employee-admin/*` | existing `/api/employees` POST/PATCH plus GET; `src/features/employee-admin/server.ts` |
| #9 | no web page/API | `scripts/demo/*`, `docs/demo-reset.md`, `tests/demo/*`; public seed/reset orchestration using existing tables |

Feature owners own their read queries, HTTP handlers, forms, UI, and end-to-end acceptance. They reuse the shared mutation kernel rather than copying SQL/locks. Feature-specific tests belong in `tests/<feature>*.test.ts` or `tests/<feature>/*`; DB tests use the isolated guard and independent DB. #3 reserves the shell and shared components, not feature pages. Route groups do not change the URLs above. All design/UI work must first read apple-design and record its application per `design-and-execution.md`. White/light gray/blue, Japanese labels, text+color status, PC lists/mobile cards, keyboard/focus/error/loading behavior remain required; these are #3–#10 acceptance, not foundation visual claims.

## Data shapes and read operations

`src/lib/contracts.ts` exports `EmployeeView`, `EquipmentView`, `LoanView`, `ExtensionView`, `EquipmentQuery`, `LoanQuery`, `ListResult<T>`, and mutation inputs. IDs for equipment/loans/extensions are UUID strings; employee ID is exactly `employee.auth_user_id` (text Better Auth ID), not another invented identity. Passwords exist only in Better Auth `account`, never employee/list DTOs. Dates are `YYYY-MM-DD`; timestamps serialize UTC ISO8601; display JST. PG `date` must be selected `::text`, never converted via host timezone.

Feature-owned server functions (all take validated active `actorId: string` from `employee(headers)`, never request body identity):

- #4 `listEquipment(actorId, query: EquipmentQuery): Promise<ListResult<EquipmentView>>`. GET query `search` (trim, max100), `category` fixed enum, `status=available|active|overdue`; omitted filters mean all. Search is literal case-insensitive substring of name/asset number (escape SQL LIKE `%`, `_`, `\`); parameterize all SQL. Exclude deleted rows. `total` is filtered count; no pagination needed at cap100.
- #5 `listMyLoans(actorId): Promise<ListResult<LoanView>>`, `listAdminLoans(actorId): Promise<ListResult<LoanView>>`. Both only unreturned; second rechecks admin. No arbitrary borrower query parameter. Newest borrowed first then ID.
- #6 `listHistory(actorId, query: LoanQuery): Promise<ListResult<LoanView>>`, `listExtensions(actorId, loanId: string): Promise<{items: ExtensionView[]}>`. History HTTP only accepts `status=all|active|returned`, `limit` integer1–200(default50), `offset` integer0–100000(default0); scope is forced `all`. `active` includes overdue. Latest borrowed first then ID; extensions ascending changedAt then ID. Preserve deleted/inactive flags and loan-time snapshots; returnedByName comes from return snapshot, extension actorName from extension snapshot.
- #7 `listAdminEquipment(actorId): Promise<ListResult<EquipmentView>>` returns nondeleted items, requires admin.
- #8 `listEmployees(actorId): Promise<{items: EmployeeView[]; total:number}>` includes inactive, requires admin. Protected admin exposes immutable marker. Email is never editable.

Lists return `{items,total,today}` so empty dataset and zero filter matches can be distinguished by UI fetching an unfiltered count when needed. Server `today=jstToday()` controls overdue status. Reads perform fresh employee authorization; do not trust layout-only authorization or cached client roles. All protected reads are dynamic and `Cache-Control: no-store`.

## Mutation functions (implemented shared kernel)

All in `src/lib/operations.ts` unless specified. First argument `actorId` comes only from authenticated server guard. Inputs are `unknown` at runtime and validated. Unknown fields are rejected; borrowerId, email/password/protected changes cannot silently succeed. HTTP JSON body uses exactly the fields below; route parameter IDs are merged by the handler and checked.

| Function | Input | Result / HTTP success |
|---|---|---|
| `borrowEquipment(actorId,input)` | `BorrowInput`: equipmentId,dueDate,idempotencyKey | `LoanMutationResult` / 201 |
| `returnLoan(actorId,input)` | `ReturnInput`: loanId,expectedDueDate,idempotencyKey | `LoanMutationResult` / 200 |
| `extendLoan(actorId,input)` | `ExtendInput`: loanId,expectedDueDate,dueDate,idempotencyKey | `LoanMutationResult` / 200 |
| `createEquipment(actorId,input)` | assetNumber,name,category,description? | `{id}` / 201 |
| `updateEquipment(actorId,input)` | id,assetNumber,name,category,description? (assetNumber must match original) | `{id}` / 200 |
| `deleteEquipment(actorId,input)` | id | `{id}` / 200, repeat no-op |
| `updateEmployee(actorId,input)` | id,name?,role,active | `{ok:true}` / 200; optional name retains #1 PATCH compatibility |
| `provision(input,actorId)` in provision.ts | email,password,name,role | `{created:true,id}` / 201; transaction creates Auth user/account/employee atomically |

`LoanMutationResult = {id,dueDate,returnedAt,returnedBy}`. `bootstrap=true` on provision is developer-only, never pass client-controlled values or expose it in HTTP. Existing `validateEmployee` export remains compatible.

HTTP write order: `csrf(request)` → `employee(request.headers,adminRequired)` → `rateLimit('write',actor.id)` → `jsonBody(request)` → kernel → `json(result,status)`; catch via `failure(error)`. JSON content type and 8KiB body cap are shared. Auth preserves its three-endpoint allowlist, mail-free login, disabled self mutation, DB-backed session revocation and protected identity triggers.

## Locking, concurrency, history

All business mutation transactions use READ COMMITTED and this order: shared reset advisory lock **741000**, employee/admission advisory lock **741001**, equipment capacity advisory lock **741003** when creating, equipment row `FOR UPDATE`, then loan row `FOR UPDATE`. Provision/update employee use the same employee lock. A later active/role change waits for in-flight mutations, then all subsequent mutations re-read the actor and fail. This deliberately serializes writes at the small demo scale; no performance claim is made before #10 load tests. Never obtain employee lock after an equipment/loan lock in feature code. Migration uses exclusive **741002**; coordinate migrations with stopped feature writers.

- FR03/09: borrow and delete lock the same equipment row. Delete checks open loans after lock; borrow checks deletion after lock. Partial unique index additionally guarantees one open loan per equipment. A losing request gets409 CONFLICT.
- FR05/10: both lock equipment then loan. Return and extend require `expectedDueDate` from last displayed server state. If extend wins, stale return gets409; if return wins, extension gets409. Return of an already returned loan returns its first timestamp/actor unchanged regardless of stale expected date.
- Request keys: 16–128 ASCII letters/digits/hyphen/underscore, scoped to actor. Generate once per user intent; preserve on network retry. `app_operation` records canonical validated request+result in the same transaction. Exact retry returns prior result (even after later state changes); same key with different operation/arguments gets409. Refresh current list after success. Auth/active checks run before replay. Return with a new key still never overwrites first return. Do not automatically retry409 with a new key.
- Extension updates due date and inserts one immutable record atomically. Deferred constraints require a continuous increasing chain from `initial_due_date` to current due date, including multi-extension fixture transactions. UNIQUE loan+old/new dates prevents forks. DB checks reject due-date-only or history-only commits.
- Employee total cap20 includes inactive. Equipment cap100 includes nondeleted only. All creates serialize before counting. Email lowercase uniqueness includes inactive; asset number uppercase uniqueness includes soft-deleted. Protected employee/Auth/account rows remain immutable. Last-admin guard uses741001; protected initial admin also guarantees an admin normally remains. No reactivation or employee delete API.
- Loan creation captures original asset number/equipment name/borrower name. Return captures actor name only on first return. Renames never rewrite these or extension actor snapshots. FK RESTRICT and history triggers prevent ordinary physical deletion. Equipment soft delete only; no restore.

## Validation and errors

`validation.ts`: `validateEquipment`, `validateEmployee`, `object`, `onlyKeys`, `text`, `role`, `identifier` (Auth text IDs), `uuid`, `idempotencyKey`, `categories`. Asset number1–32 ASCII alnum/hyphen normalized uppercase; name1–100 Unicode characters trimmed; description0–1000; categories exactly パソコン/モニター/カメラ/周辺機器/その他. Employee email lowercased example.com only max254; password12–128 JS code units, not trimmed. `dates.ts`: `dateOnly(value,field?)`, `jstToday(now?)`, `addDays(day,days)`, `validateDueDate(value,now?,previous?)`, `loanStatus(dueDate,returnedAt,now?)`. Today is valid; overdue starts next JST midnight; extension must also exceed old date.

Keep #1 envelope compatibility: `{error: string, fields?: Record<string,string>, traceId?:string}`. Success objects are unwrapped.400 INVALID_INPUT (+Japanese field messages),401 UNAUTHENTICATED,403 EMPLOYEE_FORBIDDEN/PROTECTED_ADMIN/REACTIVATION_DISABLED/ORIGIN_REJECTED,404 NOT_FOUND,409 CONFLICT/EMAIL_EXISTS/ASSET_NUMBER_EXISTS/EMPLOYEE_LIMIT/EQUIPMENT_LIMIT/LAST_ADMIN,413 BODY_TOO_LARGE,415 JSON_REQUIRED,429 RATE_LIMITED with Retry-After,503 SERVICE_UNAVAILABLE with safe traceId. `errors.ts` exports `HttpError`, `ErrorEnvelope`, `errorMessage(code)` for Japanese fallback. Never render SQL exceptions. UI retains inputs on failure and distinguishes authentication, permission, validation, conflict, rate and network errors. SQL uses bound params only.

## Migrations, isolated tests and reset support

`npm run db:migrate` compiles auth migration from the fixed Better Auth version, reapplies compatible protected identity guards, then applies sorted `db/migrations/*.sql` once with SHA256 checksums in `app_migration`. A changed applied migration fails. New migrations belong to foundation owner. No DB secret goes to source/control/logs. `.env.example` contains names only. Pooled runtime URL and matching direct migration URL are injected per worker; no dev host is hardcoded. `app_environment` purpose must match; tests also require `test_id` exact match and `current_database()` identity.

Coordinator-created isolated DBs on a dedicated development branch are supported, as are cloned Neon test branches. For a clone, do not simply set test env against a copied public marker: coordinator must explicitly provision/relabel the isolated clone, use a database named `rentmanager_*test`, and set its `purpose=rentmanager-test` and unique `test_id`. The test runner refuses public/dev markers. Never relabel an existing dev/public database to make a test pass. Supply `RENTMANAGER_TEST_ID` matching that marker plus `RENTMANAGER_TEST_ACK=isolated-test-only`; on empty test DB migration creates both markers. No test requires a particular Neon hostname. TLS remains verified on Neon.

CI alone permits loopback PostgreSQL17 without TLS when all `CI=true`, `RENTMANAGER_DB_MODE=isolated-ci`, test purpose/ACK and test DB-name checks match. No production fallback. CI credentials in workflow are disposable local service values, never Neon secrets. Workflow installs locked dependencies, checks types/lint/unit/build, migrates and bootstraps twice, runs DB suite twice, then200-history fixtures.

`loadFixtures(4|200)` in `tests/fixtures/data.ts` is test-only and guarded before mutations; CLI `npm run db:fixtures [-- --200]`. It retains the protected admin and its credentials, removes test-only nonprotected employees/Auth rows, and recreates three fictional employees and20 equipment with active/overdue/returned/extended data based on current JST. Extra histories bring total to200, not204. `RENTMANAGER_FIXTURE_PASSWORD` is injected and never printed. This deliberately destructive operation must never target shared dev/public. Integration tests leave cap fixtures; rerunning fixtures restores canonical test data. No concurrent fixture loaders on one DB; workers receive separate DBs.

#9 public reset is NOT this test fixture command. Implement explicit developer-only scope/ack (extra public confirmation), an exclusive741000 transaction, resumable `app_reset_run` phase audit, and `app_fixture_identity` tracking. Preserve protected `employee`, `user`, `account` rows exactly. Within the explicit reset transaction, truncate only `app_operation,loan_extension,loan,equipment` together (never CASCADE), clear owned fixture mappings, and delete only identified nonprotected employees with their session/account/user rows in FK-safe order. Do not disable protection triggers globally; PostgreSQL TRUNCATE of the enumerated business tables does not invoke row DELETE triggers. Auth tables and employee must never be truncated. Only the DB-owning developer command may use that mechanism, never web routes. Gather reset fixture IDs and hashing before locked mutation, require re-run safety and failure evidence. #9 owns public seed/reset acceptance and initial4 login credentials; #2 makes no public reset claim.
