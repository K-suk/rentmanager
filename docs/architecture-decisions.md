# Issue #1 認証・無料公開の成立性記録

確認日: 2026-09-23。現行構成: **Neon Postgres + アプリ内Better Auth / dev直接API検証合格 / 公開実測待ち**。

## ADR-005: 本人承認に基づく認証構成変更（現行の決定）

進行役より2026-09-23に、本人が **Neon Postgres + アプリ内Better Auth** への変更を明示承認した旨を受領した。Managed Neon Authは直接自己プロフィール・パスワード変更を拒否できず、公開初期管理者の固定要件を満たさなかった。旧調査結果・失敗証拠は本書後半に保存する。旧記録中の「保留」「代替案未承認」は変更前の履歴であり、現在の指示ではない。

承認例外は、要件文書のManaged Neon Auth指定（FR-01/FR-11/NFR-01/NFR-03/O-02等）のみ。公開登録禁止、メール不要、自己変更・削除禁止、初期管理者保護、無料公開、社員認可の条件は維持する。独自セッション暗号やパスワード方式は作らず、Better AuthのCookie検証と公式 `hashPassword` を利用する。Managed Auth SDK/外部Auth URLは新アプリには組み込まない。

### バージョンと公開先

| 項目 | 採用 | 検証 |
|---|---|---|
| Next.js | 16.3.6 / App Router / Node runtime | 型・本番build成功 |
| React / React DOM | 19.3.0 | 最小ログイン画面表示・操作確認 |
| Better Auth | 1.7.5（アプリ内） | 専用Neon DBでメール/パスワード・Cookie検証成功 |
| PostgreSQL driver | pg 8.23.0 | TLS証明書検証ON・Neon pooled接続成功 |
| Vercel functions | 3.9.9 | VercelでのみattachDatabasePoolを登録。公開実測待ち |
| TypeScript | 6.0.3 | strict typecheck成功 |
| ホスト | Vercel Hobby / Node 24.x / sin1 | 本人の個人・非商用用途確認済み。Node 24.21.0本番build成功。公開実測待ち |

npm公式配布メタデータを確認し、package-lock.jsonで固定した。[Better Auth公式Next統合](https://better-auth.com/docs/integrations/next)、[設定仕様](https://better-auth.com/docs/reference/options)、[DB・migration仕様](https://better-auth.com/docs/concepts/database)、[セッション仕様](https://better-auth.com/docs/concepts/session-management)を参照。汎用SDKの採用は今回の構成変更承認に基づく。

[Vercel Hobby条件](https://vercel.com/docs/plans/hobby)は個人・非商用用途に限定。進行役がHobbyを確認し、課金変更なし。新規専用Vercelプロジェクト `rentmanager`、正規Origin `https://rentmanager-ebon.vercel.app` を選定した。Cloudflareは旧予備調査の履歴のみで、二重公開しない。無料枠は無制限を意味せず、枠超過時に課金プランへ自動移行する設定は行わない。

### 認証の境界

- HTTP公開経路は `/api/auth/sign-in/email`（POST）、`/api/auth/sign-out`（POST）、`/api/auth/get-session`（GET）の3つだけ。全ての他のAuthパスは、bodyやOriginによらず明示403。未対応HTTPメソッドも405で拒否する。
- Better Auth自身にも `before` フックの同じ許可リストを適用する。`disableSignUp=true`、メール変更/ユーザー削除をdisabledにし、ユーザー/アカウント更新・削除のDBフックを拒否する。新規OAuth・OTP・Magic Link・Admin・Organizationプラグインは登録しない。
- SMTP/APIメールクライアント、メール送信callback、メール認証・招待プラグイン、配送用環境変数は一切登録しない。メール非送信は、構成と実コードの不存在、禁止経路拒否、確認なしログインで確認する。外部メールプロバイダー自体がないため配送イベント試験は適用外。
- POSTは正規Origin完全一致必須。Originなし・外部Origin・cross-siteを拒否する。CORSだけに依存しない。要求body上限8KiB。
- 全保護リクエストでDB-backed sessionを検証し、社員のactive/roleを毎回DBから取得する。Cookie cacheは無効。Authセッション作成時にも有効社員の存在を確認する。
- CookieはHttpOnly/SameSite=Lax、HTTPSではSecure。トークンをJSON応答やlocalStorageへ返さない。ログアウトでDBセッションを失効し、コピーCookie再送も拒否する。
- 追加社員は管理者ガード + transaction内の再認可 + advisory lockを使い、`user`/`account`/`employee`を一括作成する。公式scryptハッシュのみをAuthのaccountテーブルへ保存。Authだけ成功する途中状態は作らない。最大20人、example.comのみ、12〜128文字パスワード、1〜100文字氏名を検証する。
- 初期管理者の社員行・Authユーザー行・資格情報行にはDBトリガーも適用。社員の変更/削除、Auth行の更新/削除、保護ユーザーへの別account追加を拒否する。DB所有者によるDDL改変は脅威境界外で、DB資格情報を閲覧者へ公開しない。
- 社員無効化・降格は管理者のみ。既存セッションの次リクエストから反映する。再有効化は提供しない。最後の管理者保護は同一advisory lock内で判定する。通常運用では常に初期管理者が有効adminとして残る。

### DB・環境分離とmigration

新規専用devブランチ: `br-calm-field-b382izdc` / `rentmanager-app-dev`（進行役が空mainから作成）。公開は同プロジェクトの専用mainを利用し、devプローブを公開環境には実行しない。既存の他案件データは利用しない。

`db:migrate` は固定Better Auth版の公式 `getMigrations` で差分を検出・SQL化し、所有する最小employee/rate-limit/環境識別テーブル・保護トリガーとともにトランザクションで適用する。DDLはコードとしてGit管理し、実行に専用対象ACK・UNPOOLED URL・プール側との同一endpoint/database/user照合・環境識別を必須とする。環境purposeの不一致は拒否。備品・貸出などIssue #2の業務スキーマは未作成。

`db:bootstrap` は初期管理者を一度だけ作り、再実行で既存保護管理者を維持する。Webからは実行できない。認証用の `employee.auth_user_id` を後続基盤の社員契約として引き継ぎ、認証schema/migrationの所有者を一本化する。

### 無料レート制限

Neon共有DBへの原子的UPSERTで、login/IPは最初の要求から5分間20回、write/社員は1分間60回。これは固定区間カウンター方式で、任意の移動窓の厳密上限ではない。IP保存キーは認証秘密値によるHMACで、生IPをrateテーブルには残さない。超過は429 + Retry-After、DB障害時は503で拒否。期限切れカウンターは少量ずつ掃除する。別の有料サービスは不要。

Vercel上はホストが設定する `x-vercel-forwarded-for` のみを使用する。[公式request headers](https://vercel.com/docs/headers/request-headers)を確認した。一般の `x-forwarded-for` / `x-real-ip` や任意clientヘッダーは採用しない。ローカルは全アクセスを単一loopback枠として扱う。ホスト不明・Vercel IP欠落時はfail closed。Vercel自身でのヘッダー上書きと429は公開試験待ち。

### 設定台帳（値は記載しない）

| 用途 | 環境変数名 |
|---|---|
| アプリruntime | DATABASE_URL, RENTMANAGER_DB_HOST, BETTER_AUTH_SECRET, BETTER_AUTH_URL |
| migration専用 | DATABASE_URL_UNPOOLED, RENTMANAGER_MIGRATE_ACK, RENTMANAGER_ENVIRONMENT |
| bootstrap専用 | BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD |
| dev suite専用 | RENTMANAGER_PROBE_ACK |

初期管理者パスワードは現在安全なランナーからだけ注入する。公開デモ資格情報の画面表示は後続Issue #3/#9で意図して用意するデモ値を使う。DB接続やCookie秘密値をデモ資格情報と混同しない。ホストruntimeにbootstrap資格情報や直接DB URLを常設しない。

dev許可Originは `http://localhost:3101`。将来の専用worktreeはdevelopment時のみlocalhost:3101〜3109から明示1つを許可できる。productionはHTTPS完全一致Originのみ。previewワイルドカードなし。

### 実測結果と残作業（現行構成）

| Issue #1項目 | 設定・実測結果 | 残る確認 |
|---|---|---|
| 専用プロジェクト/権限・分離 | 新規devでmigration/bootstrap/接続成功。mainとdev分離 | 公開側の実測結果受領待ち |
| ログイン・管理者作成・メールなし | adminログイン、管理者による架空社員追加、新社員の確認なしログイン成功 | 初期全4社員のseedは#9 |
| 自由登録禁止・社員未登録拒否 | 直接sign-upを含む63攻撃で403。社員未登録の新規ログイン・既存セッション拒否 | 公開側smoke待ち |
| 初期管理者の資格情報・自己削除保護 | 正しい公開資格情報を持つセッションでも拒否。DB6攻撃拒否・元の資格情報で再ログイン成功 | 公開側smoke待ち |
| 無効・降格社員の既存セッション | 無効後403、降格後の管理操作403、未登録403、再有効化403 | 業務routeにも共通ガード適用を#2/#3へ引継ぎ |
| 無料host/SDK | Hobby選定、固定依存、型/lint/build成功 | 公開Node24/Secure Cookie/第三者ブラウザ待ち |
| Origin/レート制限 | Origin無し/外部拒否、login20/21境界・spoof拒否・期限回復、write65並列中60だけ成功 | 本番ホストIP上書き実測待ち |
| AI設定 | 進行役がdev/prod分離・Vercel env、作業者がdev schema/bootstrap設定 | 本番migration/deploy/接続確認待ち |

`npm run typecheck`、`npm run lint`、`npm run build`、旧Managedプローブ安全性17テスト、新アプリ直接HTTP suiteが成功。新suiteは専用dev上でのみ実行し、作成fixtureを清掃する。途中のdevサーバー設定再起動で一度suiteが中断したため、設定確定後に全体再実行して合格した。未確認の外部公開を成功扱いにしない。

UIはログイン成立性の最小画面のみ。`/Users/kosuke/.codex/skills/apple-design/SKILL.md` を読み、システム日本語フォント、余白、抑制した青、明示ラベル、可視focus、44px以上の操作領域、即時処理表示を適用した。進行役のブラウザ確認で画面表示・ログイン成功。全画面・レスポンシブ・業務フローの検証は#3/#10で行う。

Issueは閉じず、PRはDraftのまま。公開実測情報を受けてこの表を更新してから進行役がゲートを判断する。

---

以下はManaged Neon Authでの旧調査・失敗証拠であり、新構成の設定や検証結果ではない。

# 旧Managed Neon Authの検証記録（履歴）

確認日: 2026-09-23。状態: **Draft / 外部一部実測済み・自己変更禁止未達 / Issue #1未完了**。

## 判断

承認済み要件のNeon Authを維持する。専用検証環境の直接APIで自己プロフィール・パスワード変更が成功し、現構成はNFR-03の自己変更禁止を満たさない。公開資格情報を持つ初期管理者を保護できる構成も未成立。画面やNextのプロキシで機能を隠すだけでは、Neon Authの直接URLに対する要求を防げない。NFR-03・FR-12を未達のまま後続Issue #2へ進めない。

進行役と合意した方針は「Neon Authを維持し、専用fixtureで直接HTTP試験を準備、制限機能の確認まで基盤実装を保留」。別認証への置換、要件緩和、課金変更は未承認・未実施。

## 証拠の区分

| 項目 | 確認済み | 未確認・残作業 |
|---|---|---|
| 専用プロジェクト/ブランチ・権限 | 進行役がNeon接続・free組織・新規専用環境作成を確認。プローブでも対象一致 | アプリ用開発/公開環境の設定は今後 |
| メール/パスワードと社員作成 | 専用fixtureで直接ログイン200・セッション検証成功、確認不要設定 | 管理者createUser・配送イベント非発生の証明は未実測。fixtureの一時signup作成は管理者作成の代替証明にしない |
| 自由登録の禁止 | 管理APIの `disable_sign_up` を確認 | 直接 `/sign-up/email`、OAuth等の別経路、社員未登録のアプリ拒否は未実測 |
| 初期管理者保護 | 専用fixtureの直接自己プロフィール/パスワード変更が200。パスワード変更後ログインも成功 | 現構成は自己変更禁止未達。保護ポリシーを持つ初期管理者は未作成、削除・別経路は未実測。あらゆるNeon構成で不可能との断定はしない |
| 無効社員の既存セッション | 毎回DBの有効社員・権限を検査する方式を選定 | アプリ未実装。次リクエスト拒否・降格反映は未実測 |
| 無料ホスト | Vercel CLI認証済み/Hobbyと進行役報告、本人から個人・非商用用途と回答。Vercel Hobbyを選定 | ビルド・無料実行枠・外部公開動作 |
| 許可ドメイン/環境変数/レート制限 | 必要名・方針を以下に記録。専用Authへの接続実測済み | 公開Origin未設定。レート制限の実装・実測なし |
| AIによる外部設定 | 進行役が新規無料環境/Auth/email-password設定を実APIで適用・読み戻し確認 | 公開環境・公開ドメイン・ホストシークレット未設定 |
| プローブ | 依存なしTypeScript、HTTP攻撃経路、秘密非出力、ガード/復元確認の17テスト成功。login/profile/password実Neon実測 | SDK・Nextアプリの実行互換性試験ではない |

## 実測台帳（進行役実行）

2026-09-23、専用環境にのみ実行。既存案件は利用・変更せず、新規プロジェクトで空のmainから検証用ブランチを分離したとの進行役報告。読み取りプローブのスコープ照合も成功。

| リソース | 確認内容 |
|---|---|
| 組織 | KosKos / `org-square-moon-08401809` / free |
| プロジェクト | `rentmanager` / `patient-recipe-53794275` |
| 検証ブランチ | `rentmanager-auth-probe-20260923` / `br-falling-star-b3b6n3zb` |
| 空のdefault main | `br-soft-dawn-b3u8zj3r`。プローブは拒否対象 |
| DB | PostgreSQL 17、AWS Singapore、0.25 CU |
| Auth | better_auth有効。下記email/password設定を実APIで確認 |

| プローブ | 実測 | 判定 |
|---|---|---|
| inspect | 対象一致、Auth OpenAPI 200、列挙11経路すべて存在 | 設定/経路の存在のみ確認 |
| signup（登録停止時） | 400 | 拒否理由精査待ち。400だけで禁止設定の合格にはしない |
| fixture bootstrap | 検証ブランチのみ一時signup許可、作成200、finallyで再禁止を読み戻し確認 | 社員管理の実装ではない |
| login | 200、fixture ID一致、セッション検証成功 | 直接メール/パスワードログイン確認 |
| profile | `/update-user` 200、元の名前へ復元・readback成功 | **自己更新禁止未達** |
| password | `/change-password` 200、変更後資格情報でログイン200、元へ復元後ログイン成功 | **資格情報固定未達** |
| Cookie | 直接Auth応答でHttpOnly=true、Secure=true、SameSite=None | NextアプリのCookie確認とは別。CSRF検証は残る |

実測はtrusted Originで実施。Origin省略/不正Origin、管理者createUser、自己削除、メール送信API、アプリ認可、Next/Vercel公開はまだ未実測。秘密値・Cookie本文・入力資格情報は記録しない。

## ADR-001: Neon AuthのAPI設定と保護の不足

調査対象は現行Managed Better Auth（Neon Auth）。旧Stack Authベースの資料と混在させない。[現行概要](https://neon.com/docs/auth/overview)、[管理APIガイド](https://neon.com/docs/auth/guides/manage-auth-api)、[公式OpenAPI](https://neon.com/api_spec/release/v2.json)を参照。

管理APIの `PATCH /projects/{project_id}/branches/{branch_id}/auth/email_and_password` は次の設定を公開している。**専用検証ブランチでは進行役が適用し、実APIで読み戻し確認済み**。公開環境は未設定。

```json
{
  "enabled": true,
  "disable_sign_up": true,
  "require_email_verification": false,
  "send_verification_email_on_sign_up": false,
  "send_verification_email_on_sign_in": false
}
```

この設定だけでOTP・パスワード再設定・招待の全送信停止は証明できない。不要OAuth・Magic Link・Phone Number・Organization等の設定/経路も確認する。`require_email_verification=false` と「メールを一切送らない」は別条件。

プローブは再設定/OTP/招待を送信しない。自己削除の確認メールも上記設定では停止を保証できないため、独立した非配送確認がなければ削除プローブを起動しない。これらは未実測範囲である。

[Adminプラグイン](https://neon.com/docs/auth/guides/plugins/admin)の `admin.createUser` はメール・パスワード・氏名を受け取る。管理APIの `CreateBranchNeonAuthNewUserRequest` はメール・氏名のみであり、パスワード付き社員作成の同等手段とは扱わない。Adminプラグインは認証済みAuth管理者セッションを必要とする。アプリの `admin` とAuthの `admin` は分離し、公開デモユーザーにAuth全管理権限を与えない設計が必要。専用サーバー側作成権限の最小化と提供可否は未決定。

[ユーザー管理](https://neon.com/docs/auth/guides/user-management)には自己プロフィール更新と現在パスワードによる変更APIがある。公開するデモパスワードは本人確認の秘密にならない。メール変更は同資料では未対応だが、他経路や現行実環境の不存在を証明したわけではない。

[Webhooks](https://neon.com/docs/auth/guides/webhooks)と管理API仕様にはユーザー作成前イベントがある一方、更新・削除の拒否に使えるイベントは列挙されていない。[ロードマップ](https://neon.com/docs/auth/roadmap)でAdminプラグインのカスタマイズは今後の項目。公開仕様上、初期管理者の資格情報固定を満たす方法は見つかっていない。

代替案（未承認）:

1. Neon Auth提供側の制限機能を確認できるまで保留する（現在の選択）。要件変更なし、後続をブロック。
2. 承認後にNeon Postgres上でBetter Authを自己ホストし、登録/自己変更/削除経路を無効化し保護フックを実装する。NFR-01のManaged Neon Auth方針変更、Authスキーマ・鍵・更新・CPU負荷・運用責任が増える。実装・無料互換性とも未検証。
3. 初期管理者の公開資格情報または固定要件を変更する。FR-12/NFR-03とデモ体験の変更となるため本人承認が必要。定期リセットによる復旧は「変更禁止」の代替合格にはならない。

## ADR-002: SDK/バージョン候補

2026-09-23にnpm公式配布メタデータと公開SDKパッケージを確認した。まだ依存の導入・lock確定・本番buildは行っていない。

| 用途 | 候補 | 確認範囲 |
|---|---|---|
| Next.js | `16.3.6` | 配布 `engines.node >=20.9.0`。アプリ未作成 |
| Neon Auth | `@neondatabase/auth@0.5.0-beta` | 現在のlatestもbeta。`next >=16.0.0`、React >=18。Next用 `/next/server` exportsあり |
| SDK内Better Auth | `1.6.23` | 上記SDKの直接依存。Managedサーバーの稼働版とは限らない |
| Cloudflare OpenNext代替経路 | `@opennextjs/cloudflare@1.20.6` | peer next `>=15.5.24 <16 || >=16.3.3`。Next候補と範囲一致のみ確認 |
| Cloudflare既定推奨 | `vinext@1.0.0-beta.11` | Node >=22、React ^19.2.6、Vite ^8。Neon SDKとの実互換性は未確認 |
| プローブ実行 | Node `25.8.2`（ローカル） | Node >=22.18の直接TypeScript実行。ホストのNode版選定とは別 |

出典: [Neon SDK](https://github.com/neondatabase/neon-js/tree/main/packages/auth)、[Auth配布メタデータ](https://registry.npmjs.org/@neondatabase/auth/0.5.0-beta)、[Next配布メタデータ](https://registry.npmjs.org/next/16.3.6)、[OpenNext配布メタデータ](https://registry.npmjs.org/@opennextjs/cloudflare/1.20.6)、[vinext配布メタデータ](https://registry.npmjs.org/vinext/1.0.0-beta.11)。

Neon Auth専用SDKを候補とし、汎用Better Authクライアントや旧Stack Auth SDKに置換しない。[NextサーバーSDK](https://neon.com/docs/auth/reference/nextjs-server)の `createNeonAuth` / `auth.getSession` で検証する。SDK proxyを置くことはAuth本体の危険経路無効化とは異なる。

## ADR-003: セッションとアプリ認可

SDKの署名済みHttpOnlyセッションキャッシュ既定TTLは300秒。認証ユーザーIDの取得後、**全保護リクエストで**社員テーブルから有効状態・権限をサーバーで再取得する。社員未登録、無効、必要権限なしを拒否。ロールや有効状態をセッションキャッシュだけで決めない。無効化後の次操作から拒否する方式をこれに決定するが、実装・実測は未完了。

Server Action/Route Handler/保護ページのデータ取得にも共通ガードが必要。社員作成でAuthだけ成功した場合、社員対応付け完了まで拒否し、安全な再試行対象として管理する。ログアウト後のコピーCookie再送、Authセッションキャッシュの失効整合性、Secure/HttpOnly/SameSiteの本番実測は別途必要。

## ADR-004: 無料公開先とレート制限

**公開先はVercel Hobbyを選定。** [Hobby条件](https://vercel.com/docs/plans/hobby)は個人・非商用用途限定。進行役からHobby認証済み、本人から個人・非商用デモとの回答が共有された。用途条件の確認と、SDK・build・無料実行枠・公開URLの実測は区別する。実測は未完了であり、有料プランへ変更しない。以下のCloudflare調査は無料で成立しない場合の予備案で、二重デプロイはしない。

Cloudflareの[現行Next.jsガイド](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)はvinextを推奨する。betaの互換性検証が必要。[OpenNextガイド](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/)はApp Router/Route Handler/RSC/Server Action等を支持するがNode.js Middlewareは未対応と記載。Next 16の `proxy.ts` + Neonのサンプルをそのまま移植して互換性確認済みとしない。

[Workers無料制限](https://developers.cloudflare.com/workers/platform/limits/)は確認時点で100,000要求/日、CPU 10ms/要求、128MBメモリ、Workerサイズ64MiB。古い3MiB情報を採用しない。Neonへのfetch待ち時間はCPU時間外だが、認証署名・SSRのCPU消費、ビルドサイズ、公開先でのログインは未測定。無料で動くと断定せず、実際のbundleとCPU、未認証ブラウザからの公開確認が必要。

レート制限方式案: ホスト確定後、追加有料サービスなしでNeon共有DBの原子的カウンターを使用し、ログインは信頼できるホスト由来IP（保存キーはハッシュ化）ごと5分20回、書込は検証済み社員ごと1分60回を判定する。プロセスメモリだけには保存しない。DB障害時は保護操作を拒否し、期限切れ行を掃除する。DB定義は後続基盤担当の所有であり、ここでは作成しない。

[Cloudflare Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)は10/60秒窓・拠点ごとの制限であり、要求の5分窓をそのまま満たさない。アプリ側レート制限でも直接Neon Authへの攻撃は抑止できないため、Neon側制限も確認が必要。レート制限の無料成立・429・Retry-Afterは未検証。

## 設定台帳

| 区分 | 名前/方針 | 現状 |
|---|---|---|
| アプリ秘密値 | `DATABASE_URL`, `NEON_AUTH_COOKIE_SECRET` | 未設定・値の記録禁止 |
| Auth接続 | `NEON_AUTH_BASE_URL` | 検証ブランチで取得・一致確認・接続済み。公開環境は未設定 |
| 管理/プローブ | `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_BRANCH_ID` | プローブ実行時のみ安全に注入。ブラウザへ渡さない |
| プローブ専用 | `PROBE_ORIGIN`, `PROBE_ORIGIN_MODE`, `PROBE_DISPOSABLE_BRANCH_ACK`, `PROBE_EMAIL`, `PROBE_PASSWORD`, `PROBE_USER_ID`, `PROBE_DELETE_FIXTURE_ACK`, `PROBE_NO_EMAIL_POLICY_ACK` | [実行手順](../scripts/probes/README.md) |
| ローカル許可Origin | `http://localhost:3101` | 登録予定・未設定。公開環境のlocalhost許可は原則不要 |
| 公開許可Origin | ホストの正規HTTPS Originだけ | URL未取得・未設定。任意previewワイルドカードを許可しない |
| 環境分離 | 開発/プローブ/公開を別Auth設定・ブランチで運用 | 空mainとprobeを分離済み。アプリ開発/公開の設定は今後 |

[許可ドメイン仕様](https://neon.com/docs/auth/guides/configure-domains)を基に進行役が設定する。CORS/Origin制限をサーバーからの直接Auth要求の権限制御として扱わない。Vercel Hobbyの[Runtime Logs](https://vercel.com/docs/logs/runtime)保持は1時間と公式資料で確認した。ログ保存の実測は未実施で、独自ログ基盤は追加しない。

## 再開時の合格ゲート

1. 確認済みの専用無料プロジェクト・検証ブランチを再照合する。他環境へ広げない。
2. [プローブ](../scripts/probes/README.md)のinspectを再実行し、Auth設定・現行OpenAPI経路を確認する。
3. 管理者によるメールなし社員作成を実測する。直接ログイン/セッション取得成功だけで社員作成を合格にしない。
4. 公開登録、プロフィール・パスワード・メール変更、削除、管理者権限API、OTP/再設定等の全経路を実環境スキーマから列挙し、同一保護ポリシーのfixtureで直接要求を試す。成功、拒否理由、変更前後、復元/清掃を秘密なしで記録する。
5. Neon Auth側で初期管理者保護が成立しなければ代替案の本人合意を取得し、Issue #1を未達のまま維持する。
6. 選定したVercel Hobbyで使用版を固定してbuild・公開URL・Cookie・レート制限・ログ保持を実測する。

現時点でIssueチェックボックスは完了にしない。Draft PRは検証準備のレビュー用であり、Issueを閉じる/マージする成果ではない。
