# Codex Start Prompt (post-PR #7 continuation)

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

- PR #7（Point-in-Time Universe、データ品質・照合、robustness foundation）は `main` へマージ済みです（`2a522904695070a3b75770b2d1b84a459a6ebfe8`）。
- PR #7の検証は合成・research-onlyデータ中心です。`etf_realistic` は未解禁です。
- 現在のprovider-neutralな正規化 runner統合は最終全CLI監査まで完了し、PRレビューへ進む段階です。

最初のタスク:

1. `/Users/ykoba/IdeaProjects/quant-pilot` でGit状態を確認する
2. 現在の作業ブランチと `main` の基準commitを確認する
3. Node/Bunのバージョンを確認する
4. 既存fixtureで対象runnerの検証を行う
5. 最新の検証結果（131 tests、raw/normalized Trend/Rotation、data-quality、robustness）を再確認する
6. 欠損・将来データ・不一致をfail closedで検証する
7. `etf_realistic` が未解禁のままであることを確認する
8. 問題があれば新しいbranchとPRで修正する
9. docs/handoff/CURRENT_STATUS.md と IMPLEMENTATION.md を実績に合わせて更新する

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
