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

2. CSVを `data/raw/<symbol>.csv` に配置する。`unadjusted_price`は最低限 `Date,Close`、`provider_adjusted`は `AdjustedClose`も必須。`Volume,TradingValue`を推奨する。
3. 実行する。

```bash
bun run backtest --config=backtest.config.json
```

設定の `returnBasis` は入力系列の意味を明示する。

- `unadjusted_price`: `Close`を使用
- `provider_adjusted`: `AdjustedClose`を使用するが、分配金込みTotal Returnとは認定しない

CLI出力は `backtest-summary-v2`。通常のCSV/Stooq経路は `returnNormalization.status=not_normalized` と警告を出す。`cumulativePortfolioReturn` はポートフォリオの累積損益であり、入力系列がTotal Returnであることを意味しない。通常のCSV入力を `total_return` と宣言することはできない。

Stooqを使う場合はAPIキーを設定してproviderを切り替える。

```bash
export STOOQ_API_KEY=...
bun run backtest --config=backtest.config.json --provider=stooq
```

Stooq利用時は設定の `returnBasis` を `unadjusted_price` にする。現在のadapterは未調整Closeだけを返す。Stooqは研究用OHLCV providerとして扱い、分配金込みTotal Returnや公式な実取引検証は別のデータ源で再検証する。

### 再現可能なfixture検証

リポジトリ内の小さな合成CSVを使い、外部データやAPIキーなしでStrategy A/BのCLI経路を検証できる。

```bash
bun run backtest --config=tests/fixtures/configs/trend.json
bun run backtest --config=tests/fixtures/configs/rotation.json
```

このfixtureは、履歴不足、上場期間外、最大3本、売買コスト、High-Water Markから-30%の停止を意図的に発生させる。CLIの `assetDiagnostics` には、各資産の実読込期間、使用可能frame数、明示的な除外理由が出力される。

fixtureはCorporate Actionのない合成 `unadjusted_price` 系列であり、分配金、JPY換算、実際のスプレッドや流動性を表現しない。出力は配管と制約の検証専用で、投資成績の根拠には使用しない。

## Return normalization

`src/data/return-normalization.ts` は、raw CloseとPoint-in-Timeイベントから正規化指数を作る基盤を提供する。

- `price_return`: 完全なCorporate Action coverageを要求し、split/reverse splitを正規化して分配金を除外
- `total_return`: さらに完全な分配金coverageと、`ex_date`／`pay_date`を含む明示的ポリシーを要求
- 外貨分配金、未対応Corporate Action、coverage不足、認識日時点で未入手のイベントはfail closed

再投資日などの恒久方針は未決定で、デフォルト値はない。詳細は [`docs/return-normalization.md`](./docs/return-normalization.md) と `OPEN_DECISIONS.md` O-002を参照する。

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
