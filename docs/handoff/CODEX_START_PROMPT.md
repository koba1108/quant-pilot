# Codex Start Prompt (M1 credentialed-sample continuation)

Copy the following into the first task of the Codex Project opened at `/Users/ykoba/IdeaProjects/quant-pilot`.

```text
Quant Pilotの実装をChatGPTから引き継いでください。

最初に、次の順で読んでください。

1. AGENTS.md
2. docs/handoff/CODEX_PROJECT_INSTRUCTIONS.md
3. docs/handoff/DECISIONS.md
4. docs/handoff/CURRENT_STATUS.md
5. docs/handoff/EXECUTION_ROADMAP.md
6. docs/handoff/OPEN_DECISIONS.md
7. investment_policy.md
8. strategy_spec.md
9. backtest_spec.md
10. IMPLEMENTATION.md
11. README.md
12. universe_master.csv

重要な現状:

- PR #9（production market-data readiness評価とJ-Quants v2 research adapter）まで `main` へマージ済みです（`9690bbe7e40c64a3fc2591b5da785f01bc0bbbc4`）。
- 合成fixture、provider-neutralなPoint-in-Time契約、data quality、reconciliation、robustness、provider評価まで実装済みです。
- credentialed-sampleのfixture capture／immutable artifact／reconciliation／offline replayは実装済みです。実credentialed vendor sample、正式provider、Strategy C、Forward-Test persistence/schedulingは未実施です。
- `etf_realistic` は未解禁です。
- Active delivery milestoneは `EXECUTION_ROADMAP.md` のM1 Credentialed data sliceです。

最初のタスク:

1. `/Users/ykoba/IdeaProjects/quant-pilot` でGit状態を確認する
2. `EXECUTION_ROADMAP.md` のactive milestone、exit criterion、次に実行可能にするcommand/artifactをplanへ書く
3. 現在の作業ブランチと `main` の基準commitを確認する
4. Node/Bunのバージョンを確認する
5. `credentialed-sample` fixture captureとoffline replayを含む既存runnerの検証を行う
6. M1のsoftware pathがマージ済みなら、Gate G1/G2なしにlive fetchへ進まない。未マージなら同じ縦切りだけを完了する
7. 欠損・将来データ・不一致をfail closedで検証する
8. `etf_realistic` が未解禁のままであることを確認する
9. 問題があれば新しいbranchとPRで修正する
10. Roadmap、CURRENT_STATUS、IMPLEMENTATIONを実績に合わせて更新する

方針:

- 元のChatGPTの大量の質問や候補は仕様ではありません。DECISIONS.mdのActive決定だけを採用してください。
- OPEN_DECISIONS.mdを独断で恒久仕様にしないでください。調査と再現可能な比較を行い、重要な金融・リスク方針はユーザー承認を得てください。
- Roadmapの現在milestoneにconsumerがない土台追加は行わず、将来案として記録してください。
- TypeScript + Bunを維持し、Pythonを追加しないでください。
- AIにハード制約や決定論的計算を任せないでください。
- Look-ahead bias、Survivorship bias、ETF上場前利用を禁止してください。
- Stooq単独の結果を最終的な投資根拠として扱わないでください。
- 実注文・証券口座連携は実装しないでください。
- ユーザーの明示指示なしにPRをマージしないでください。
- テスト未実行を成功と表現しないでください。

最初の検証を完了するところまで自走し、変更内容、テスト結果、制約、次の作業を報告してください。
```
