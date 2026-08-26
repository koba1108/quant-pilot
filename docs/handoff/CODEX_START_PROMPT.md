# Codex Start Prompt

Copy the following into the first task of the Codex Project opened at `/Users/ykoba/IdeaProjects/quant-pilot`.

```text
Quant Pilotの実装をChatGPTから引き継いでください。

最初に、次の順で読んでください。

1. AGENTS.md
2. docs/handoff/CODEX_PROJECT_INSTRUCTIONS.md
3. docs/handoff/DECISIONS.md
4. docs/handoff/CURRENT_STATUS.md
5. docs/handoff/OPEN_DECISIONS.md
6. investment_policy.md
7. strategy_spec.md
8. backtest_spec.md
9. IMPLEMENTATION.md
10. README.md
11. universe_master.csv

重要な現状:

- PR #1はすでにmainへマージ済みです。
- PR #1のマージ前には、ローカルでのbun testとTrend/Rotation CLIの統合検証が完了していません。
- 古いfeature branchの続きを前提にせず、最新mainを検証してください。

最初のタスク:

1. `/Users/ykoba/IdeaProjects/quant-pilot` でGit状態を確認する
2. mainを最新化する
3. Node/Bunのバージョンを確認する
4. bun install
5. bun test
6. コミット可能な小さなCSV fixtureを用意する
7. trendとrotation双方をCLIで実行する
8. Point-in-Time境界、履歴不足、コスト、最大3本、-30% DD stopを検証する
9. 問題があれば新しいbranchとPRで修正する
10. docs/handoff/CURRENT_STATUS.md と IMPLEMENTATION.md を実績に合わせて更新する

方針:

- 元のChatGPTの大量の質問や候補は仕様ではありません。DECISIONS.mdのActive決定だけを採用してください。
- OPEN_DECISIONS.mdを独断で恒久仕様にしないでください。調査と再現可能な比較を行い、重要な金融・リスク方針はユーザー承認を得てください。
- TypeScript + Bunを維持し、Pythonを追加しないでください。
- AIにハード制約や決定論的計算を任せないでください。
- Look-ahead bias、Survivorship bias、ETF上場前利用を禁止してください。
- Stooq単独の結果を最終的な投資根拠として扱わないでください。
- 実注文・証券口座連携は実装しないでください。
- ユーザーの明示指示なしにPRをマージしないでください。
- テスト未実行を成功と表現しないでください。

最初の検証を完了するところまで自走し、変更内容、テスト結果、制約、次の作業を報告してください。
```
