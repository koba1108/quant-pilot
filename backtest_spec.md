# Backtest Specification v0.1

## 評価層
1. Long-term: 可能な限り長期の指数/原資産データでロジック検証
2. 10Y: 現代市場での頑健性
3. 5Y: 直近環境で壊れていないか
4. ETF-realistic: 当時実在したETFだけで実取引条件を再現
5. Forward: Strategy確定後、未来データのみで各100万円を最低12か月

## バイアス対策
- Look-ahead bias禁止
- Survivorship bias対策: 上場廃止ETF履歴を保持
- ETF上場前にそのETF価格を使用しない
- 長期研究ではETFではなく指数/原資産系列を利用可。ただしETF-realisticと区別
- 現在のニュースを過去時点AI判断に混入させない

## Point-in-Time Universe

- 実行用masterはversioned observation、明示的revision chain、listing date、最終eligible date、availability timestamp、source provenanceを保持する
- `last_eligible_date` は最終利用可能日をinclusiveで表す。providerの法的な上場廃止日から暗黙に換算しない
- 各signal dateでは、その日までにavailableなmetadata revisionだけを利用する
- Universe statusはresearch configが明示的にopt-inする。loaderが最終membersやO-003/O-004を決めない
- metadata不足、曖昧なrevision、future availability、status未指定は暗黙補完せず除外またはerrorにする
- ETF種別、米国株・暗号資産・leveraged・inverse分類、対応通貨をfree textから推論せず明示fieldでfail closed判定する
- 各資産自身の月末取引日でmembershipを判定し、forward endpointも最終eligible dateを超えないことを確認する
- 十分な履歴があるがUniverseが空の月は省略せず100% cash frameとして保持する

## Return Basis

- 入力系列を `unadjusted_price`、`provider_adjusted`、正規化済み `price_return`、正規化済み `total_return` として明示する
- `AdjustedClose` だけを根拠にTotal Returnと認定しない
- Price Return正規化には完全なCorporate Action coverageを要求する
- Total Return正規化には完全な分配金coverageと明示的な会計ポリシーを要求する
- ポートフォリオ累積損益と入力データのTotal Return basisを同じ名称で表現しない

## Distribution Accounting

- 研究用Total Returnはex-dateで認識し、同日終値で理論再投資する
- 仮想口座はex-dateで未収分配金を計上し、pay-dateでのみ利用可能現金へ振り替える
- 分配金現金は次回の月次リバランスまで自動再投資しない
- ex-date時点の推定額と後日の確定訂正を別イベントとしてPoint-in-Time記録する
- forecast採点は未収分を含む分配金収益を含め、支払時に二重計上しない
- NAV・市場価格へ反映済みの信託報酬を明示コストとして二重控除しない
- 投資家固有の税処理は別レイヤーとし、未実装時は税引前と明示する

## JPY FX Normalization

- 非円の正規化済みreturn系列は、現地returnとFX returnを乗算して無ヘッジJPY returnへ変換する
- 為替レートは `JPY per 1 source-currency unit` の方向を明示する
- rate date、observed timestamp、availability timestamp、provenanceを保持する
- 各価格日・分配金認識日の完全一致レートを要求し、前方補完・前月値・暗黙逆数・暗黙cross rateを使用しない
- 後日の訂正はsupersession eventとしてPoint-in-Time適用し、過去snapshotを遡及上書きしない
- 評価用reference rateと実売買のFX spread・手数料を分離する
- 最終FX providerと休日alignment policyはO-001の検証対象とする

## コスト
- 売買手数料
- Bid/Ask spread
- Slippage
- FX conversion cost
- ETF trading unit
- Trust fee / management fee
- 先物型ETFはロールコスト・乖離を可能な限り反映

## Execution
基本: 月末時点の情報で判定し、翌営業日約定を基準。
頑健性確認として月中/25日前後等でも結果が極端に変わらないか検証。

## Metrics
- CAGR / cumulative return
- Volatility
- Sharpe
- Sortino
- Max Drawdown
- turnover
- total transaction cost
- cash ratio
- correlation to S&P 500 (日常表示ではなく研究指標)
- worst month / worst year
- crisis period behavior

## Data Quality / Reconciliation

- raw/normalized artifactはcontent/request fingerprint、source/dataset、source/adapter version、observed/available/retrieved timestampを保持できること
- 品質結果は `pass`、`research_only`、`blocked` を区別する
- 比較はcode/date/field/basis/currency/unit/quote conventionが一致するsource間だけで行う
- toleranceはversioned policyとして明示し、material conflict時にsource winnerや補間値を自動選択しない
- 単一source、未調整Price、provenance不足を複数source合格やTotal Returnとして表示しない
- daily-bar品質reportはnormalized `price_return` / `total_return` を自己申告できない。別のnormalization artifactとcoverage lineageを要求する
- semantic dateまたはavailabilityがdecision cutoffより後の照合値は除外数を記録し、required比較が空ならblockedとする
- required照合はversion/fingerprint、親artifact、対象code/date range、price fieldへ結合し、古いquote evidenceは明示coverageなしに流用しない
- dataset終点auditと各signal時点のrow-level availability gateを区別する。後者が未統合のrunnerは `research_only` とする

## Robustness Grid

- Strategy A/B weight、volatility window、最大保有数、cost assumptionを明示的なcellとして全組合せ実行する
- resultにはstrategy/input version、parameter、data layer、provenance fingerprintを残す
- result自体に `evidenceDisposition=research_only` と未正規化のreturn basisを機械可読に残す
- 全cellとmin/median/maxを保存し、最良の一点を自動採用しない
- engine未対応のrebalance timingやreplacement ruleは既存modeで代用せず `unsupported` として返す
- annualized metricsは連続月だけを受け付け、gapを短い期間として年率換算しない
- strategyだけでなく各axis/valueごとのmetric rangeとcompleted/unsupported件数を保存する
- O-005/O-006/O-011の採用判断はgrid実装だけでは確定しない

## 選抜
バックテスト合格候補の中から、ロジックと過去リターン特性が異なる3戦略をAI委員会が推薦し、人間が承認。
