# Quant Pilot

既存の米国株インデックス投資とは別軸で、ETFのみを使うAI主導・Quant制約付き月次運用を検証するプロジェクト。

## Runtime

- TypeScript
- Bun（推奨）
- Node.js 26.7.0+
- Python依存なし

```bash
bun install
bun test
```

## Codex Project / Handoff

Codex Projectへ移行する場合は、最初に次を読んでください。

1. [`AGENTS.md`](./AGENTS.md)
2. [`docs/handoff/CODEX_PROJECT_INSTRUCTIONS.md`](./docs/handoff/CODEX_PROJECT_INSTRUCTIONS.md)
3. [`docs/handoff/DECISIONS.md`](./docs/handoff/DECISIONS.md)
4. [`docs/handoff/CURRENT_STATUS.md`](./docs/handoff/CURRENT_STATUS.md)
5. [`docs/handoff/OPEN_DECISIONS.md`](./docs/handoff/OPEN_DECISIONS.md)

引き継ぎ資料には、ChatGPTで行った大量の質問そのものではなく、最終的に承認された決定、現在の実装状態、未確定事項、実行手順を整理しています。

PR #1はすでに `main` へマージ済みです。マージされた市場データ・バックテスト実装は、Codex Projectで最初にローカル検証してください。

## Backtest quick start

1. 設定ファイルをコピーする。

```bash
cp backtest.config.example.json backtest.config.json
```

2. CSVを `data/raw/<symbol>.csv` に配置する。最低限 `Date,Close`、推奨は `Date,Close,AdjustedClose,Volume,TradingValue`。
3. 実行する。

```bash
bun run backtest --config=backtest.config.json
```

Stooqを使う場合はAPIキーを設定してproviderを切り替える。

```bash
export STOOQ_API_KEY=...
bun run backtest --config=backtest.config.json --provider=stooq
```

Stooqは研究用OHLCV providerとして扱う。分配金込みTotal Returnや公式な実取引検証は、別の調整済みデータ源で再検証する。

## Backtest pipeline

`MarketDataProvider -> validation -> monthly frames -> Strategy A/B -> inverse-vol allocation -> cost model -> -30% DD stop`

Point-in-Time制約として、設定された上場日前・上場廃止日後のデータは取得対象にしない。月次シグナルはその月末までのデータだけで作り、翌月リターンを評価に使う。

## Structure

- `src/data/` — market data providers / point-in-time Universe / validation
- `src/strategies/` — Strategy A Trend / Strategy B Rotation
- `src/portfolio/` — allocation / risk / costs
- `src/backtest/` — frame builder / simulator / metrics / CLI runner
- `src/ai/` — Strategy C AI investment committee
- `docs/handoff/` — Codex Project向け引き継ぎ資料
- `investment_policy.md` — 投資方針とガードレール
- `universe_master.csv` — Universe初版
- `strategy_spec.md` — Strategy A/B/C
- `backtest_spec.md` — バックテスト設計

Forward Testは各Strategy仮想100万円、最低12か月。実弾は最終予算100万円までの段階投入を想定。
