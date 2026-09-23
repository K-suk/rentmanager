# Issue #1 認証・無料公開の成立性記録

確認日: 2026-09-23。状態: **Draft / 外部実測待ち / Issue #1未完了**。

## 判断

承認済み要件のNeon Authを維持する。公開登録停止の設定は公式管理APIに存在するが、公開資格情報を持つ初期管理者の自己変更防止は成立を確認できていない。画面やNextのプロキシで機能を隠すだけでは、Neon Authの直接URLに対する要求を防げない。NFR-03・FR-12を未達のまま後続Issue #2へ進めない。

進行役と合意した方針は「Neon Authを維持し、専用fixtureで直接HTTP試験を準備、制限機能の確認まで基盤実装を保留」。別認証への置換、要件緩和、課金変更は未承認・未実施。

## 証拠の区分

| 項目 | 確認済み | 未確認・残作業 |
|---|---|---|
| 専用プロジェクト/ブランチ・権限 | プローブに対象照合ガードを実装。本人からNeon認証完了の申告あり | 進行役がCLI接続を再確認中。対象作成・権限・他案件データ不存在は未確認 |
| メール/パスワードと社員作成 | 公式資料にログイン・Admin createUserが存在 | 外部の社員作成・確認/招待メールなしのログインは未実測 |
| 自由登録の禁止 | 管理APIの `disable_sign_up` を確認 | 直接 `/sign-up/email`、OAuth等の別経路、社員未登録のアプリ拒否は未実測 |
| 初期管理者保護 | 自己 `changePassword` / `updateUser` が公式機能。保護用設定を発見できず | Auth APIでの自己変更・削除、管理API経路の攻撃実測。資料に無いことを不可能の実証とはしない |
| 無効社員の既存セッション | 毎回DBの有効社員・権限を検査する方式を選定 | アプリ未実装。次リクエスト拒否・降格反映は未実測 |
| 無料ホスト | Vercel CLI認証済み/Hobbyと進行役報告、本人から個人・非商用用途と回答。Vercel Hobbyを選定 | ビルド・無料実行枠・外部公開動作 |
| 許可ドメイン/環境変数/レート制限 | 必要名・方針を以下に記録 | 外部許可ドメインは未設定・未確認。レート制限の実装・実測なし |
| AIによる外部設定 | 進行役が接続作業を担当 | 専用無料環境/Auth/許可ドメイン/シークレットの設定完了証拠なし |
| ローカルプローブ | 依存なしTypeScript、HTTP攻撃経路、秘密非出力、ガード/復元確認の17テスト成功 | 実Neon HTTPには未接続。SDKの実行互換性試験ではない |

## ADR-001: Neon AuthのAPI設定と保護の不足

調査対象は現行Managed Better Auth（Neon Auth）。旧Stack Authベースの資料と混在させない。[現行概要](https://neon.com/docs/auth/overview)、[管理APIガイド](https://neon.com/docs/auth/guides/manage-auth-api)、[公式OpenAPI](https://neon.com/api_spec/release/v2.json)を参照。

管理APIの `PATCH /projects/{project_id}/branches/{branch_id}/auth/email_and_password` は次の設定を公開している。これは**設定案**であり、まだ適用していない。

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
| Auth接続 | `NEON_AUTH_BASE_URL` | 専用環境取得待ち |
| 管理/プローブ | `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_BRANCH_ID` | プローブ実行時のみ安全に注入。ブラウザへ渡さない |
| プローブ専用 | `PROBE_ORIGIN`, `PROBE_ORIGIN_MODE`, `PROBE_DISPOSABLE_BRANCH_ACK`, `PROBE_EMAIL`, `PROBE_PASSWORD`, `PROBE_USER_ID`, `PROBE_DELETE_FIXTURE_ACK`, `PROBE_NO_EMAIL_POLICY_ACK` | [実行手順](../scripts/probes/README.md) |
| ローカル許可Origin | `http://localhost:3101` | 登録予定・未設定。公開環境のlocalhost許可は原則不要 |
| 公開許可Origin | ホストの正規HTTPS Originだけ | URL未取得・未設定。任意previewワイルドカードを許可しない |
| 環境分離 | 開発/プローブ/公開を別Auth設定・ブランチで運用 | 外部実測待ち |

[許可ドメイン仕様](https://neon.com/docs/auth/guides/configure-domains)を基に進行役が設定する。CORS/Origin制限をサーバーからの直接Auth要求の権限制御として扱わない。Vercel Hobbyの[Runtime Logs](https://vercel.com/docs/logs/runtime)保持は1時間と公式資料で確認した。ログ保存の実測は未実施で、独自ログ基盤は追加しない。

## 再開時の合格ゲート

1. 本人認証完了後、専用無料プロジェクト・権限・空の検証ブランチを確認する。
2. [プローブ](../scripts/probes/README.md)のinspectを実行し、Auth設定・現行OpenAPI経路を確認する。
3. メールなし管理者作成と直接ログイン、正常なセッション取得を成功させる。
4. 公開登録、プロフィール・パスワード・メール変更、削除、管理者権限API、OTP/再設定等の全経路を実環境スキーマから列挙し、同一保護ポリシーのfixtureで直接要求を試す。成功、拒否理由、変更前後、復元/清掃を秘密なしで記録する。
5. Neon Auth側で初期管理者保護が成立しなければ代替案の本人合意を取得し、Issue #1を未達のまま維持する。
6. 選定したVercel Hobbyで使用版を固定してbuild・公開URL・Cookie・レート制限・ログ保持を実測する。

現時点でIssueチェックボックスは完了にしない。Draft PRは検証準備のレビュー用であり、Issueを閉じる/マージする成果ではない。
