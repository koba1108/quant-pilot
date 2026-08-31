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
5. [`docs/handoff/EXECUTION_ROADMAP.md`](./docs/handoff/EXECUTION_ROADMAP.md)
6. [`docs/handoff/OPEN_DECISIONS.md`](./docs/handoff/OPEN_DECISIONS.md)

引き継ぎ資料には、ChatGPTで行った大量の質問そのものではなく、最終的に承認された決定、現在の実装状態、未確定事項、実行手順を整理しています。

PR #11（credentialed providerの部分失敗を保持するcapture/audit/replay）まで `main` へマージ済みです。現在はM2 Manual Pre-Forwardの実行経路を実装中です。現在の実装・検証状況は `docs/handoff/CURRENT_STATUS.md`、Forward Testまでの一本道と脱線防止ルールは `docs/handoff/EXECUTION_ROADMAP.md` を参照してください。O-001/O-003/O-004 などの未決事項は確定せず、`etf_realistic` は必要なデータ層の統合と人間によるprovider承認まで実行できません。

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

CLI出力は `backtest-summary-v3`。通常のraw CSV/Stooq経路は `returnNormalization.status=not_normalized`、`evidenceDisposition=research_only` と警告を出す。`price_return` / `total_return` は明示的なopt-in経路で、`ReturnEventCoverage.availableAt`、signal/forward別PIT snapshot、signal prefixの固定、exact-date JPY換算、full fingerprintsを適用する。全月次実行の `end` は暦月末を必須とし、normalized経路では各資産のsnapshot cutoffにその月の実際の最終取引日を使う。出力の `start` / `end` は実現リターン期間、`signalStart` / `signalEnd` は判断期間を表す。`cumulativePortfolioReturn` はポートフォリオの累積損益であり、入力系列がTotal Returnであることを意味しない。`etf_realistic` は引き続き実行を拒否する。

Stooqを使う場合はAPIキーを設定し、設定ファイル側で `provider=stooq` を明示する。

```bash
export STOOQ_API_KEY=...
bun run backtest --config=<provider=stooqの設定>
```

Stooq利用時は設定の `returnBasis` を `unadjusted_price`、`researchLayer` を `proxy` にする。設定に明示したproviderと異なるCLI overrideは、入力sourceと研究層の誤表示を防ぐため拒否する。現在のadapterは未調整Closeだけを返す。Stooqは研究用OHLCV providerとして扱い、分配金込みTotal Returnや公式な実取引検証は別のデータ源で再検証する。

J-Quants v2の日次価格adapter spikeも、読み取り専用の研究経路として用意している。

```bash
export JQUANTS_API_KEY=...
bun run backtest --config=<provider=jquants_v2の設定>
```

この経路は `returnBasis=unadjusted_price` と `researchLayer=proxy` を必須とする。J-Quantsのsecurity codeは4桁数字または5桁英数を使い、4桁はAPI仕様の5桁codeへ正規化する。adjusted fieldをPrice Return／Total Returnとは認定せず、行単位availability、改訂履歴、分配金、FX、歴史Universeを暗黙生成しない。実API credentialを使った検証済みfixtureはコミットしていない。

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

正規化済みPrice ReturnのPoint-in-Time経路は、次の合成fixtureで検証できる。

```bash
bun run backtest --config=tests/fixtures/configs/trend-normalized.json
bun run backtest --config=tests/fixtures/configs/rotation-normalized.json
```

この経路も合成データ専用であり、production providerや投資成績の証拠ではない。

ルートの `universe_master.csv` は初期候補カタログであり、上場履歴、availability、symbol、provenanceが不足しているため、そのまま歴史的Universeとしては使用できない。実行用の `universe-master-v1` 契約と制約は [`docs/universe-master.md`](./docs/universe-master.md) を参照する。

## Return normalization

`src/data/return-normalization.ts` は、raw CloseとPoint-in-Timeイベントから正規化指数を作る基盤を提供する。

- `price_return`: 完全なCorporate Action coverageを要求し、split/reverse splitを正規化して分配金を除外
- `total_return`: さらに完全な分配金coverageと、`ex_date`／`pay_date`を含む明示的ポリシーを要求
- 外貨分配金、未対応Corporate Action、coverage不足、認識日時点で未入手のイベントはfail closed

D-018により、研究用Total Returnはex-date終値での理論再投資に決定した。方針は `APPROVED_RESEARCH_TOTAL_RETURN_POLICY` として明示的に渡し、暗黙のデフォルトにはしない。仮想口座ではex-dateに未収金、pay-dateに現金化し、次回リバランスまで自動再投資しない。詳細は [`docs/return-normalization.md`](./docs/return-normalization.md) と [`docs/distribution-accounting.md`](./docs/distribution-accounting.md) を参照する。

## Point-in-Time JPY FX normalization

`src/data/fx-normalization.ts` は、正規化済みの非円Price Return／Total Returnを、為替変動込みの無ヘッジJPY系列へ変換する。レートは「1 source currencyあたりのJPY」を明示し、各取引日・分配金認識日に完全一致するPoint-in-Time観測を要求する。欠損時の前方補完、前月値利用、暗黙の逆数・クロスレートは禁止する。

評価用reference rateと実売買のFXコストは分離する。明示的なnormalized入力はこの換算経路を使用できるが、production FX providerは未接続で、最終providerはO-001として未決定。詳細は [`docs/fx-normalization.md`](./docs/fx-normalization.md) を参照する。

## Data quality and reconciliation

versioned provenance、決定論的な品質report、provider-neutralな複数source照合hookを提供する。単一sourceや未調整Priceを合格扱いせず、`research_only` と `blocked` を明示する。現段階はdataset終点のsidecar auditであり、各signal frameのproduction gateではない。

```bash
bun run data-quality --config=tests/fixtures/configs/data-quality.json
```

fixtureは意図どおり `research_only` になる。詳細は [`docs/data-quality.md`](./docs/data-quality.md) を参照する。

## Production provider evaluation

O-001候補を、機能、Point-in-Time availability／revision、複数source照合、ライセンス、コスト承認、credentialed artifactの有無でfail-closed評価する。

```bash
bun run provider-evaluation --config=research/provider-evaluation/o001-candidates.json
```

2026-08-29 snapshotでは、J-Quants＋EODHDとJ-Quants＋Twelve Dataの両bundleが`blocked`、`selection=not_selected`、`canEnableEtfRealistic=false`となる。J-Quantsは5銘柄（1308/1348/1473/1597/2510）の2026-04-20..22 credentialed captureに成功し、rawをGit管理外のowner-only artifactへ保存した。EODHDは現アカウントでJapan/XJPX/Tokyo exchangeなし、同じ5銘柄の`.TSE` requestがすべてHTTP 404、`search/1308`に日本結果なしだったため、JPX daily-price comparatorとしては扱わず海外ETF/FX候補に限定する。これはEODHD全体の恒久的な日本非対応を意味しない。Total Return、PIT改訂、ETF event、東京ETF quote、cross-source value reconciliationは未完了であり、O-001は未選択のままである。候補調査と証拠計画は [`docs/provider-evaluation.md`](./docs/provider-evaluation.md) を参照する。

## Credentialed sample capture contract

M1の最小縦切りは、J-QuantsとEODHDの同一5銘柄fixtureを、redacted request、raw response byte hash、immutable artifact、field別reconciliation、offline replayまで接続する。

```bash
bun run credentialed-sample --config=research/provider-samples/fixture.config.json
```

出力されたaudit artifact IDを使い、providerへ接続せず再計算できる。

```bash
bun run credentialed-sample \
  --config=research/provider-samples/fixture.config.json \
  --replay-artifact=sha256:<64-hex-digits>
```

fixtureは常に`research_only`、`failClosed=true`、`canEnableEtfRealistic=false`である。G1/G2承認後のlive auditも、EODHD 5件の404を`providerFailures`として保存した`captureStatus=partial`であり、終了コード1のままfail closedする。live artifactはGit管理外の`data/generated/`へowner-onlyで保存し、vendor response本文やキーはコミットしない。仕様と残る証拠ギャップは [`docs/credentialed-sample.md`](./docs/credentialed-sample.md) を参照する。

## Manual Pre-Forward dry run

M2の手動運用経路は、保持済みartifactからTrendとRotationを実行し、仮想注文・約定・ポジション・現金・コストをimmutable Decision Packageとappend-only SQLite ledgerへ保存する。同じportfolio/月の同一cutoff再実行は同じDecision Packageを検証して返し、注文や現金移動を重複させない。別cutoffによる月中再判定は、承認済みtrigger/audit modeが未実装のため拒否する。

合成fixtureで経路全体を検証する場合:

```bash
bun run pre-forward:seed-fixture --config=tests/fixtures/pre-forward/config.json
bun run pre-forward \
  --config=tests/fixtures/pre-forward/config.json \
  --as-of=2025-01-07T00:00:00Z
```

同じコマンドをもう一度実行すると`idempotent=true`、`stateTransitionApplied=false`になる。Decision Package IDを指定したoffline replayも可能である。

```bash
bun run pre-forward \
  --config=tests/fixtures/pre-forward/config.json \
  --as-of=2025-01-07T00:00:00Z \
  --replay-decision=sha256:<decision-package-id>
```

成功するfixtureは合成データであり、投資成績やM2の実データexit criterionを証明しない。D-009の売買gateを検証するため、fixtureは合成の期待便益1,000 bpsと安全余裕25 bpsを明示しているが、これはO-005/O-006の採用値ではない。通常注文は期待便益が片道執行コスト＋安全余裕を厳密に上回る場合だけ生成し、保有銘柄の通常入替はO-006承認までblocked、-30%強制清算だけはD-010として優先する。ただし保有unitをsplit後価格で誤評価しないよう、強制清算にも対象期間のCorporate Action／分配coverageを要求する。fixtureだけは明示的な「完全・イベントなし」合成証跡を持ち、実データで証跡がなければ評価も注文も行わない。既存のJ-Quants live auditは3日分しかないため、履歴・Universe・執行前提不足を明示して終了コード1、現金維持、state transitionなしになる。全出力は`pre_forward_dry_run` / `research_only` / `formalForwardClockStarted=false`で、実注文や正式Forward Testではない。仕様と現状の境界は [`docs/pre-forward.md`](./docs/pre-forward.md) を参照する。

## Strategy A/B robustness grid

Strategy weights、コスト、最大保有数、volatility windowを全組合せで実行し、全cellと安定性rangeを出力する。最良cellを自動採用しない。未実装の月中・25日・hysteresis等は、既存結果で代用せず明示的な `unsupported` cellになる。出力スキーマは `robustness-grid-v2`。

```bash
bun run robustness --config=tests/fixtures/configs/robustness-grid.json
```

詳細は [`docs/robustness-grid.md`](./docs/robustness-grid.md) を参照する。

## Backtest pipeline

`MarketDataProvider -> validation -> monthly frames -> Strategy A/B -> inverse-vol allocation -> cost model -> -30% DD stop`

Point-in-Time制約として、設定された上場日前・上場廃止日後のデータは取得対象にしない。normalized月次シグナルは各資産の実際の月末取引日までに利用可能なsnapshotだけで作り、そのsnapshotを固定したうえで翌月endpointまでのリターンを評価する。

## Structure

- `src/data/` — market data providers / Point-in-Time Universe / provenance / quality / reconciliation
- `src/strategies/` — Strategy A Trend / Strategy B Rotation
- `src/portfolio/` — allocation / risk / costs
- `src/backtest/` — frame builder / simulator / metrics / CLI runner
- `src/pre-forward/` — manual virtual cycle / Decision Package / append-only ledger / replay CLI
- `src/ai/` — Strategy C AI investment committee
- `docs/handoff/` — Codex Project向け引き継ぎ資料
- `investment_policy.md` — 投資方針とガードレール
- `universe_master.csv` — Universe初期候補カタログ（歴史実行用masterではない）
- `strategy_spec.md` — Strategy A/B/C
- `backtest_spec.md` — バックテスト設計

Forward Testは各Strategy仮想100万円、最低12か月。実弾は最終予算100万円までの段階投入を想定。
