# Codex Start Prompt

Copy the following into a new Codex session opened at `/Users/ykoba/IdeaProjects/quant-pilot`.

```text
このリポジトリの実装を引き継いでください。

最初に、次の順で読み込んでください。

1. AGENTS.md
2. docs/handoff/README.md
3. docs/handoff/CODEX_HANDOFF.md
4. docs/handoff/DECISIONS.md
5. docs/handoff/CURRENT_STATUS.md
6. docs/handoff/OPEN_DECISIONS.md
7. investment_policy.md
8. strategy_spec.md
9. backtest_spec.md
10. IMPLEMENTATION.md

その後、Gitの現在状態、ブランチ、PR #1 の差分を確認してください。
作業対象は `feat/market-data-backtest` を前提とします。

最初の目的は、PR #1 の実データ接続とStrategy A/Bバックテストをローカルで検証可能な状態にすることです。

まず以下を実行・確認してください。

- bun install
- bun test
- CSV fixtureを使ったtrend/rotation双方のCLI実行
- Point-in-Time境界、履歴不足、コスト、-30% DD stopの挙動
- READMEと実装の一致

問題があれば修正してください。その後、優先順位に従って次へ進んでください。

1. Total Return / 分配金の正規化設計
2. 非円資産のJPY換算
3. universe_master.csvのPoint-in-Time loader
4. データ品質・複数ソース照合
5. Strategy A/Bのrobustness grid

重要事項:

- 元のChatGPTの大量の質問や候補は仕様ではありません。DECISIONS.mdのActive決定だけを採用してください。
- OPEN_DECISIONS.mdを独断で恒久仕様にしないでください。まず調査・バックテストで候補を比較し、重要な金融方針はユーザー承認を得てください。
- TypeScript + Bunを維持し、Pythonを追加しないでください。
- AIにハード制約や計算を任せず、決定論的ロジックはコードに置いてください。
- Look-ahead bias、Survivorship bias、ETF上場前利用を禁止してください。
- Stooq単独の結果を最終的な投資根拠として扱わないでください。
- 実注文・証券口座連携は実装しないでください。
- PRをマージせず、変更内容・テスト結果・未解決事項を報告してください。

実装を進め、最初の検証結果と修正内容をまとめてください。
```
