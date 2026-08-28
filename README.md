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

CLI出力は `backtest-summary-v2`。通常のCSV/Stooq経路は `returnNormalization.status=not_normalized`、`evidenceDisposition=research_only` と警告を出す。`cumulativePortfolioReturn` はポートフォリオの累積損益であり、入力系列がTotal Returnであることを意味しない。通常のCSV入力を `total_return` と宣言することはできない。strict Universe masterを使わない互換経路は、明示した `synthetic_fixture` / `proxy` researchに限定される。正規化return・行単位availability・JPY換算が通常runnerへ統合されるまで、`researchLayer=etf_realistic` は実行を拒否する。

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

厳格なPoint-in-Time Universe masterを通す同等の統合経路もある。

```bash
bun run backtest --config=tests/fixtures/configs/trend-universe.json
bun run backtest --config=tests/fixtures/configs/rotation-universe.json
```

ルートの `universe_master.csv` は初期候補カタログであり、上場履歴、availability、symbol、provenanceが不足しているため、そのまま歴史的Universeとしては使用できない。実行用の `universe-master-v1` 契約と制約は [`docs/universe-master.md`](./docs/universe-master.md) を参照する。

## Return normalization

`src/data/return-normalization.ts` は、raw CloseとPoint-in-Timeイベントから正規化指数を作る基盤を提供する。

- `price_return`: 完全なCorporate Action coverageを要求し、split/reverse splitを正規化して分配金を除外
- `total_return`: さらに完全な分配金coverageと、`ex_date`／`pay_date`を含む明示的ポリシーを要求
- 外貨分配金、未対応Corporate Action、coverage不足、認識日時点で未入手のイベントはfail closed

D-018により、研究用Total Returnはex-date終値での理論再投資に決定した。方針は `APPROVED_RESEARCH_TOTAL_RETURN_POLICY` として明示的に渡し、暗黙のデフォルトにはしない。仮想口座ではex-dateに未収金、pay-dateに現金化し、次回リバランスまで自動再投資しない。詳細は [`docs/return-normalization.md`](./docs/return-normalization.md) と [`docs/distribution-accounting.md`](./docs/distribution-accounting.md) を参照する。

## Point-in-Time JPY FX normalization

`src/data/fx-normalization.ts` は、正規化済みの非円Price Return／Total Returnを、為替変動込みの無ヘッジJPY系列へ変換する。レートは「1 source currencyあたりのJPY」を明示し、各取引日・分配金認識日に完全一致するPoint-in-Time観測を要求する。欠損時の前方補完、前月値利用、暗黙の逆数・クロスレートは禁止する。

評価用reference rateと実売買のFXコストは分離する。最終providerはO-001として未決定で、現在のCLIには未接続。詳細は [`docs/fx-normalization.md`](./docs/fx-normalization.md) を参照する。

## Data quality and reconciliation

versioned provenance、決定論的な品質report、provider-neutralな複数source照合hookを提供する。単一sourceや未調整Priceを合格扱いせず、`research_only` と `blocked` を明示する。現段階はdataset終点のsidecar auditであり、各signal frameのproduction gateではない。

```bash
bun run data-quality --config=tests/fixtures/configs/data-quality.json
```

fixtureは意図どおり `research_only` になる。詳細は [`docs/data-quality.md`](./docs/data-quality.md) を参照する。

## Strategy A/B robustness grid

Strategy weights、コスト、最大保有数、volatility windowを全組合せで実行し、全cellと安定性rangeを出力する。最良cellを自動採用しない。未実装の月中・25日・hysteresis等は、既存結果で代用せず明示的な `unsupported` cellになる。

```bash
bun run robustness --config=tests/fixtures/configs/robustness-grid.json
```

詳細は [`docs/robustness-grid.md`](./docs/robustness-grid.md) を参照する。

## Backtest pipeline

`MarketDataProvider -> validation -> monthly frames -> Strategy A/B -> inverse-vol allocation -> cost model -> -30% DD stop`

Point-in-Time制約として、設定された上場日前・上場廃止日後のデータは取得対象にしない。月次シグナルはその月末までのデータだけで作り、翌月リターンを評価に使う。

## Structure

- `src/data/` — market data providers / Point-in-Time Universe / provenance / quality / reconciliation
- `src/strategies/` — Strategy A Trend / Strategy B Rotation
- `src/portfolio/` — allocation / risk / costs
- `src/backtest/` — frame builder / simulator / metrics / CLI runner
- `src/ai/` — Strategy C AI investment committee
- `docs/handoff/` — Codex Project向け引き継ぎ資料
- `investment_policy.md` — 投資方針とガードレール
- `universe_master.csv` — Universe初期候補カタログ（歴史実行用masterではない）
- `strategy_spec.md` — Strategy A/B/C
- `backtest_spec.md` — バックテスト設計

Forward Testは各Strategy仮想100万円、最低12か月。実弾は最終予算100万円までの段階投入を想定。
