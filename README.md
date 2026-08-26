# AI ETF Monthly System v0.1

既存の米国株インデックス投資とは別軸で、ETFのみを使うAI主導・Quant制約付き月次運用を検証するプロジェクト。

## Runtime

- TypeScript
- Bun（推奨）
- Python依存なし

```bash
bun install
bun test
bun run backtest
```

Node.js 26.7.0+でもTypeScript type strippingを使ってコアテストを実行可能です。

```bash
npm run test:node
```

## Structure

- `src/data/` — point-in-time Universe / market data adapters / validation
- `src/strategies/` — Strategy A Trend / Strategy B Rotation
- `src/portfolio/` — allocation / risk / costs
- `src/backtest/` — simulator / metrics / runner
- `src/ai/` — Strategy C AI investment committee
- `investment_policy.md` — 投資方針とガードレール
- `universe_master.csv` — Universe初版
- `strategy_spec.md` — Strategy A/B/C
- `backtest_spec.md` — バックテスト設計

Forward Testは各Strategy仮想100万円、最低12か月。実弾は最終予算100万円までの段階投入を想定。
