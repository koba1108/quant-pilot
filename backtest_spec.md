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

## 選抜
バックテスト合格候補の中から、ロジックと過去リターン特性が異なる3戦略をAI委員会が推薦し、人間が承認。
