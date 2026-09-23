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
