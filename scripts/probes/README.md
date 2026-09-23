# Issue #1 Neon Auth probe

このプローブは**成立性の未達を発見する道具**であり、正常終了だけでIssue #1を完了にしない。Node.js 22.18以降のTypeScript直接実行を使用し、npm依存追加は不要。Nextアプリ・DBスキーマは作成しない。

## 対象と安全境界

- 外部実行・fixture作成・設定変更は進行役が担当する。作業者は秘密値を受け渡さない。
- プロジェクト名 `rentmanager`、明示したプロジェクトID・ブランチID、ブランチ名 `rentmanager-auth-probe-*`、非デフォルトブランチ、管理APIが返すAuth URLとの完全一致を毎回照合する。
- これらの名前だけでは所有権・コピー元の無関係データ不存在を証明できない。進行役が専用プロジェクトの所有・権限と、空の検証ブランチであることを確認してから実行する。他案件をコピーしたブランチを使わない。
- `inspect` はGETのみ。他モードは認証セッションやfixtureを変更する。公開デモ、初期管理者、既存社員に対して実行しない。
- `PROBE_EMAIL` は `rm-probe-*@example.com`、ログイン応答のユーザーIDは `PROBE_USER_ID` と一致必須。初期管理者と同じ保護ポリシーを適用した使い捨てfixtureを用意する。単なる一般社員での拒否は初期管理者保護の証明にならない。
- リダイレクト追従禁止、15秒タイムアウト。URL・Cookie・レスポンス本文・例外詳細・トークン・パスワード・ユーザーIDを出力しない。セッションとランダム生成パスワードはプロセスのメモリ内だけで保持する。
- ファイルへの秘密値出力は禁止。シークレットマネージャ等から環境変数をプロセスへ注入する。シェル引数へ値を埋め込まない。`set -x` やHTTPデバッグを使用しない。

## 環境変数（値は記録しない）

| 名前 | 用途 |
|---|---|
| `NEON_API_KEY` | 対象確認用の管理API認証。スクリプトは管理APIにGET以外を送らない |
| `NEON_PROJECT_ID` / `NEON_BRANCH_ID` | 対象を明示。自動列挙・自動選択なし |
| `NEON_AUTH_BASE_URL` | 検証ブランチのAuth URL。アプリのプロキシURLではない |
| `PROBE_ORIGIN` | 許可済みOrigin（ローカルは `http://localhost:3101`） |
| `PROBE_ORIGIN_MODE` | `trusted`（既定）/ `omit` / `untrusted`。Origin検査を保護設定と誤認しないため各経路を試す |
| `PROBE_DISPOSABLE_BRANCH_ACK` | `rentmanager-auth-probe-only` の明示で変更可能モードを許可 |
| `PROBE_EMAIL` / `PROBE_PASSWORD` / `PROBE_USER_ID` | 専用使い捨てfixtureの資格情報と期待ID |
| `PROBE_DELETE_FIXTURE_ACK` | 削除試験のみ `delete-only-this-disposable-fixture` が必要 |
| `PROBE_NO_EMAIL_POLICY_ACK` | 削除試験前に、対象の削除確認メールが配送されないことを別途確認し `verified-no-email-delivery` を指定 |

## 実行

値を安全に注入したプロセス内で、次を実行する。

```sh
node scripts/probes/neon-auth.mts inspect
node scripts/probes/neon-auth.mts signup
node scripts/probes/neon-auth.mts login
node scripts/probes/neon-auth.mts profile
node scripts/probes/neon-auth.mts password
node scripts/probes/neon-auth.mts admin-create
# 最後に、削除専用fixtureでのみ実行
node scripts/probes/neon-auth.mts delete
```

`signup` は毎回ランダムな架空メール・パスワードで直接登録を試す。成功したら未達でありfixtureが残る。`admin-create` はNeon Auth管理者の専用fixtureから作成し、作成したユーザーで確認メールなしのログインを試す。公開デモ管理者にNeon Authの `admin` ロールを与えることを推奨するものではない。

`profile` と `password` は変更成功時に元へ戻すリクエストを行う。プロフィールはキャッシュ無効のセッション読み戻し、パスワードは変更後と復元後のログインも確認する。ただし通信切断・プロセス停止時の復元を保証しないため、使い捨てfixture以外は厳禁。`delete` は復元しない。枝全体の破棄など後片付けは進行役が専用対象を再確認して行う。スクリプトは管理キーで自動削除せず、対象を広げない。

終了コード:

- `0`: 読み取り調査または要求したログイン/作成プローブが終了した。要件全体の合格ではない。
- `1`: 禁止すべき変更APIが2xxを返した（`FAIL_ACCEPTED`）。実データ確認を追加して原因を確定する。
- `2`: 設定不備、通信・スコープ不一致、または拒否理由を証明できない（`UNVERIFIED`）。403だけでは合格にしない。

拒否の合格判定には、正常ログイン・有効セッション、完全な有効payload、対象ID、設定に起因する拒否、変更前後の同一性を進行役が追加確認する。404はその1経路の不存在しか示さない。429、CSRF、Origin、不正payload、失効セッション、5xxは要件の拒否証明ではない。

## 残る実測

この最小スクリプトは、メール配送先を発生させるパスワードリセット/OTP/招待要求を自動送信しない。メール非送信の証明にはプロバイダー設定と配送イベントの確認が別途必要。削除確認メールの有無もサインアップ用設定では保証できないため、削除は別途非配送確認のACKがなければ送信しない。`/change-email`、`/admin/set-user-password`、`/admin/remove-user`、OAuth/リンク操作、セッション失効API等の全経路網羅、アプリ社員未登録/無効化/降格、ログアウト済みCookieの再送も未実装・未検証である。

Auth OpenAPIの実環境スキーマで追加・変更経路を確認し、送信なしを保証できるfixture設定ができてから拡張する。初期管理者と同じポリシーのfixtureを作れない場合、保護要件は未確認のままにする。

## ローカル安全性検証

```sh
node --test scripts/probes/neon-auth.test.mts
```

ネットワークをスタブ化し、対象誤り・デフォルトブランチ・URL不一致・メール設定・確認指定不足でPOSTしないこと、秘密値を含む応答/例外を出力しないこと、登録成功を失敗と判定すること、403を合格にしないことを確認する。**Neon実測ではない。**

## 承認後のアプリ内Better Auth検証（現行）

2026-09-23、本人承認によりNeon Postgres + アプリ内Better Authへ変更。上記のManaged Neon Authプローブは失敗証拠の保存用で、新アプリの検証には `app-auth.ts` を使う。

環境変数は [.env.example](../../.env.example) の**名前のみ**を参照。秘密値は安全なランナーでプロセスへ注入し、出力しない。既存の別案件や公開DBでは実行しない。`BETTER_AUTH_URL=http://localhost:3101`、`RENTMANAGER_PROBE_ACK=rentmanager-app-dev-only`、DBの `app_environment.purpose=rentmanager-app-dev` が全て必要。

```sh
# 専用dev DBに対してだけ実行。値を注入したプロセスで使用する。
RENTMANAGER_ENVIRONMENT=rentmanager-app-dev RENTMANAGER_MIGRATE_ACK=rentmanager-dedicated-only npm run db:migrate
RENTMANAGER_MIGRATE_ACK=rentmanager-dedicated-only npm run db:bootstrap
npm run dev
# 別ターミナル、同じdev接続環境
RENTMANAGER_PROBE_ACK=rentmanager-app-dev-only npm run test:auth
```

プローブは直接HTTPで21種の禁止経路を3つのOrigin条件で攻撃し、正常ログイン、社員作成、既存セッションの無効化・降格・社員未登録、ログアウト、Cookie属性、DB保護、共有レート制限を確認する。初期管理者には専用devの架空管理者だけを使う。DBトリガー試験はSAVEPOINTでロールバックする。新規fixtureはランダムなメールとパスワードをメモリ内で生成し、作成IDだけを清掃する。公開初期管理者への破壊試験は行わない。

ローカルIPの共有レート枠は試験中だけ保存・初期化し、finallyで復元する。**この間、同じdev DB・3101ポートで他のログイン試験を並行しない。** 20/21回の境界を検査するための隔離であり、実装に公開リセットAPIはない。ネットワーク断・プロセス強制終了時は清掃を保証しない。再実行前に専用dev内だけで残fixtureを確認する。結果はPASS/FAILラベルのみで、レスポンス本文・ID・Cookie・秘密値を出力しない。

終了0はこのsuiteの合格。公開先のSecure Cookie/ホスト由来IP/第三者ブラウザの検証は進行役が別途行う。ブラウザ互換性・業務UI・貸出スキーマ・デモ全4人と備品20件のシードは後続Issueの対象。


### Issue #2 isolated test compatibility

The current app probe accepts the explicitly assigned localhost port3101–3109. For a dedicated `rentmanager-test` database it additionally requires `RENTMANAGER_TEST_ACK=isolated-test-only`, matching test ID and database marker/name via `assertTestDatabase`; public markers remain rejected. Run after canonical4-loan fixtures, not after the cap test that intentionally leaves20 employees. Inject `PORT` and matching `BETTER_AUTH_URL`; never run a second server/probe on the same DB. Probe ACK retains the legacy literal `rentmanager-app-dev-only` for compatibility even in guarded test mode. No authentication endpoint policy changed.
