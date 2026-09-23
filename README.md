# RentManager 実装ガイド

日本語の中小企業向け備品貸出管理の公開デモ。仕様書と実装タスクは準備済み、アプリ本体は未実装です。

## 仕様

- [要件定義書](docs/requirements/01-requirements.md)
- [機能要件](docs/requirements/02-functional-requirements.md)
- [非機能要件](docs/requirements/03-nonfunctional-requirements.md)
- [デザイン・AI実行方針](docs/design-and-execution.md)

## 実装順

#1 → #2 → #3 → #4〜#9を並列 → #10。

最初の環境設定もAIが実施します。CLI/MCP/APIに加え、必要時は認可されたcomputer useを使用してください。ユーザー本人のログイン・MFA・連携承認が必要な場面のみ引き継ぎます。

| Issue | タイトル |
|---|---|
| [#1](https://github.com/K-suk/rentmanager/issues/1) | Neon Auth・無料公開環境をAIで設定し、成立性を検証する |
| [#2](https://github.com/K-suk/rentmanager/issues/2) | Next.js・DBスキーマ・共通契約・検証基盤を構築する |
| [#3](https://github.com/K-suk/rentmanager/issues/3) | Neon Authログイン・権限制御・デザイン基盤を実装する |
| [#4](https://github.com/K-suk/rentmanager/issues/4) | 備品一覧・検索・貸出登録を実装する |
| [#5](https://github.com/K-suk/rentmanager/issues/5) | 自分の貸出・返却・延長・管理者の代理操作を実装する |
| [#6](https://github.com/K-suk/rentmanager/issues/6) | 貸出履歴と延長履歴を実装する |
| [#7](https://github.com/K-suk/rentmanager/issues/7) | 管理者向け備品登録・編集・削除を実装する |
| [#8](https://github.com/K-suk/rentmanager/issues/8) | 管理者向け社員追加・編集・無効化を実装する |
| [#9](https://github.com/K-suk/rentmanager/issues/9) | デモデータと安全な初期化コマンドを用意する |
| [#10](https://github.com/K-suk/rentmanager/issues/10) | 結合検証・レスポンシブ確認・無料公開を完了する |

## デザイン

白/淡いグレー/青の落ち着いたUI、読みやすい日本語、PCの一覧とスマートフォンのカード表示を基本にします。GPT Imagesによる想定図は会話で提示する参考案です。このリポジトリに画像ファイルは含まれていないため、実装時は上記の文書化したデザイン方針を参照してください。デザイン・UIの設計、実装、レビューでは `apple-design` スキルの使用を必須とする。着手前に実装環境の該当SKILL.mdを読み、各画面と共通コンポーネントへ適用する。使用したスキルの取得元/パスと適用内容をPRに記録する。見つからない場合は既存スキルの場所・取得元を調べ、それでも特定できなければユーザーに場所を確認する。スキル未使用のままデザイン実装を完了扱いにしない。認証・DBなど独立した作業は継続する。

## 認証成立性試作の起動（Issue #1）

2026-09-23の本人承認により、認証は**Neon Postgres + アプリ内Better Auth**へ変更しました。Managed Neon Authでの自己変更成功の証拠と承認例外は [認証ADR](docs/architecture-decisions.md) に保存しています。現在は最小ログイン画面と認証APIのみで、貸出・備品管理は未実装です。

Node.js 24、`npm ci`、`npm run dev`（port 3101）。秘密値は [.env.example](.env.example) に列挙した名前で安全なランナーから注入してください。値をGit・ログ・コマンド引数へ書かないでください。`BETTER_AUTH_URL` は完全一致のOriginです。公開先では正規HTTPS Originだけを許可します。ローカルは開発時のみlocalhost:3101〜3109のうち指定した1つを使用できます。

専用環境確認後、`DATABASE_URL_UNPOOLED` に直接接続を注入して認証テーブルを移行します。通常の `DATABASE_URL` はプール接続、`RENTMANAGER_DB_HOST` はその完全一致ホストです。

```sh
RENTMANAGER_ENVIRONMENT=rentmanager-app-dev RENTMANAGER_MIGRATE_ACK=rentmanager-dedicated-only npm run db:migrate
RENTMANAGER_MIGRATE_ACK=rentmanager-dedicated-only npm run db:bootstrap
npm run typecheck
npm run lint
npm test
npm run build
RENTMANAGER_PROBE_ACK=rentmanager-app-dev-only npm run test:auth
```

bootstrapは `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` から保護された架空管理者を一度だけ作成します。再実行では既存管理者を維持します。デモ全体を初期化するコマンドではありません。全デモ社員・備品・履歴のシードとリセットはIssue #9で実装します。

公開先はVercel Hobby、Node 24、Singapore（`sin1`）。進行役が専用公開DBへ `RENTMANAGER_ENVIRONMENT=rentmanager-public` で移行・bootstrapし、Vercelに `DATABASE_URL` / `RENTMANAGER_DB_HOST` / `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` を設定します。bootstrap秘密値と直接DB URLは実行時だけ使い、ホストへ常設しません。公開前に [検証手順](scripts/probes/README.md) とADRの未確認事項を確認してください。
