# Quant Pilot Handoff

このディレクトリは、ChatGPTで行った企画・方針決定・初期実装をCodex Projectへ引き継ぐための正規化されたコンテキストです。

大量の質問文や選択肢そのものは保存していません。ユーザーが最終的に選択した内容、現在の実装状態、未確定事項、次の作業だけを管理します。

## Read order

1. [`CODEX_PROJECT_INSTRUCTIONS.md`](./CODEX_PROJECT_INSTRUCTIONS.md) — Codex Project移行後の統合指示書
2. [`DECISIONS.md`](./DECISIONS.md) — 承認済みの方針と理由
3. [`CURRENT_STATUS.md`](./CURRENT_STATUS.md) — main、実装済み範囲、検証状況
4. [`OPEN_DECISIONS.md`](./OPEN_DECISIONS.md) — バックテストや調査で決める未確定事項
5. [`CODEX_HANDOFF.md`](./CODEX_HANDOFF.md) — プロジェクト目的と設計の要約
6. [`CODEX_START_PROMPT.md`](./CODEX_START_PROMPT.md) — Codex Projectの初回タスクとして貼る開始指示

関連する詳細仕様:

- [`../../investment_policy.md`](../../investment_policy.md)
- [`../../strategy_spec.md`](../../strategy_spec.md)
- [`../../backtest_spec.md`](../../backtest_spec.md)
- [`../../IMPLEMENTATION.md`](../../IMPLEMENTATION.md)
- [`../../universe_master.csv`](../../universe_master.csv)

## Maintenance rules

- 最新の明示的なユーザー指示が最優先です。
- 方針が変わった場合は `DECISIONS.md` の既存項目を更新し、旧案を残す場合は `Superseded` と明記します。
- 実装状況が変わった場合は `CURRENT_STATUS.md` を更新します。
- 未確定事項を実装・検証で確定した場合は、`OPEN_DECISIONS.md` から `DECISIONS.md` へ移します。
- ChatGPTの会話全文は仕様の一次情報として扱いません。

Last updated: 2026-08-27
