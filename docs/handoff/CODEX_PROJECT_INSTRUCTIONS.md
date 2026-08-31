# Codex Project Instructions

## 1. この文書の目的

この文書は、ChatGPTで設計・初期実装した `quant-pilot` をCodex Projectへ移行し、そのまま実装を継続するための実行指示書です。

会話全文や大量の選択式質問は仕様として引き継ぎません。ユーザーが最終的に承認した方針は `DECISIONS.md`、未確定事項は `OPEN_DECISIONS.md` に正規化済みです。

Codexは、過去の候補・提案・途中案ではなく、リポジトリ内のActiveな決定と最新のユーザー指示だけを基準にしてください。

## 2. Project情報

- Repository: `https://github.com/koba1108/quant-pilot`
- Local path: `/Users/ykoba/IdeaProjects/quant-pilot`
- Default branch: `main`
- Runtime: TypeScript + Bun
- Node.js requirement: repositoryで指定された最新バージョン
- Python dependency: 禁止。ユーザーの明示的な方針変更がある場合のみ再検討
- Current state: PR #11は `main` へマージ済み（merge commit `60aa5266100945583f9dc1b4eff4d9bd70a76b52`）。現在のdelivery milestoneはM2 Manual Pre-Forward
- Important caveat: 合成backtestとcredentialed sampleは引き続きresearch-onlyであり、実運用可能な `etf_realistic` 証拠でも正式Forward Testでもない

## 3. 最初に読むファイル

作業開始前に、必ず次の順で読み込んでください。

1. `AGENTS.md`
2. `docs/handoff/CODEX_PROJECT_INSTRUCTIONS.md`
3. `docs/handoff/DECISIONS.md`
4. `docs/handoff/CURRENT_STATUS.md`
5. `docs/handoff/EXECUTION_ROADMAP.md`
6. `docs/handoff/OPEN_DECISIONS.md`
7. `investment_policy.md`
8. `strategy_spec.md`
9. `backtest_spec.md`
10. `IMPLEMENTATION.md`
11. `README.md`
12. `universe_master.csv`

優先順位は次の通りです。

1. ユーザーの最新の明示的指示
2. `DECISIONS.md` のActive決定
3. Investment / Strategy / Backtest仕様
4. Current Statusと既存実装

文書間に矛盾がある場合は、最新の明示的指示と `DECISIONS.md` を優先し、矛盾を報告して文書も修正してください。

`EXECUTION_ROADMAP.md` は承認済み投資方針ではなく、現在のdelivery順序と集中ルールです。実装を始める前に、active milestone、進めるexit criterion、新しく実行可能になるcommand/artifact、対象外をplanへ書いてください。現在のmilestoneにconsumerがない土台追加は行いません。

## 4. Projectの目的

ユーザーは米国株インデックスを長期資産形成の中心にしています。Quant Pilotはそれを置き換えるものではありません。

目的は、米国株インデックスとは別のリターン源になり得る、ETF限定・ロングオンリー・月次中心の運用システムを研究し、仮想運用で検証することです。

システムは次の3戦略を比較します。

- Strategy A: Trend Control
- Strategy B: Cross-Asset Rotation
- Strategy C: Adaptive Macro AI

最終的にはロジックと値動きの異なる3戦略を、仮想100万円ずつ最低12か月Forward Testします。実弾運用の総予算上限は100万円ですが、実弾投入はForward Test合格後に段階的に検討します。

## 5. 絶対に守る投資・リスク制約

次の制約を、独断で緩和・削除・回避してはいけません。

- ETFのみ
- 東証ETFを基本に、不足する資産だけ海外ETFで補完
- 米国株ETFを除外
- 暗号資産ETFを除外
- レバレッジETF、インバースETFを除外
- 空売り、先物、FX投機、オプションを使用しない
- ロングオンリー
- 最大保有数は3本
- 条件を満たさない資金は現金。100%現金も許可
- 為替ヘッジを必須にせず、円ベースの最終成績で評価
- 配分はAIの自己申告確信度ではなくQuantのリスクモデルで決定
- 同じマクロ仮説への集中にハード上限を設ける。具体値は未確定
- High-Water Markから-30%で強制停止
- 停止後の再開にはAI分析、Quant再検証、人間の明示承認が必要
- 実注文、証券口座接続、自動発注は現在のスコープ外

## 6. AIとコードの責任分離

決定論的に判定できるものはTypeScriptコードで実装します。

コード側の責任:

- 市場データの検証
- 日付・上場期間の検証
- Look-ahead bias防止
- Survivorship bias対策
- リターン、ボラティリティ、ランキング計算
- ウェイト計算
- 売買コスト
- 最大ドローダウン
- ハードリスク制約
- Point-in-Time Universe
- 再現可能なバックテスト

AI側の責任:

- マクロ、政策、景気、金利、地政学、需給の解釈
- 市場コンセンサスとの差分
- 価格への織り込みの評価
- 1〜3か月の投資仮説
- 反対材料と不確実性の整理
- 情報不足による見送り判断

AIはハード制約を上書きできません。数値不足を推測で埋めたり、データ異常を物語で正当化したりしてはいけません。

## 7. 現在の実装状態

PR #11までに以下が `main` に入りました。

- `MarketDataProvider` abstraction
- CSV provider
- Stooq research provider
- J-Quants v2 read-only research adapter
- daily barsからmonthly frameを生成する処理
- Strategy A/B CLI runner
- fail-closed production-provider evaluation CLI
- credentialed J-Quants/EODHD sample capture、immutable artifact、部分失敗の保持、reconciliation、offline replay
- example config
- frame-builder test
- Codex handoff documents

正規化 `price_return` / `total_return`、行単位availability、signal/forward別snapshot、JPY換算は明示的なresearch-only opt-in経路に統合済みです。通常のraw経路は `not_normalized` のままで、`etf_realistic` は未解禁です。

Stooqは研究用OHLCVの接続確認に使うだけで、最終的なTotal Returnや実弾判断の根拠にはしません。

現在のM2 branchでは、明示的な`asOf`、実生成時刻を持つimmutable Decision Package、append-only virtual ledger、月1回の通常run、D-009期待便益/cost/safety-margin gate、duplicate-safe replayを持つ手動Pre-Forward経路を実装しています。合成fixtureの期待便益・安全余裕を承認済みO-005/O-006値として扱ったり、合成成功をM2の実データexit criterion達成と表現したりしてはいけません。保持済みJ-Quants sampleは3日分のため明示的にblockedとなります。

## 8. Codex移行後の最初の作業

### Phase 0: mainの検証

最初にローカル状態を確認してください。

```bash
cd /Users/ykoba/IdeaProjects/quant-pilot
git status
git switch main
git pull --ff-only origin main
node --version
bun --version
bun install
bun test
```

失敗があれば、原因を特定して新しい修正ブランチを作成してください。

```bash
git switch -c fix/validate-market-data-backtest
```

### Phase 0.1: CLIの統合検証

`backtest.config.example.json` を確認し、リポジトリへコミット可能な小さなfixtureを用意してください。ダウンロードした大量の市場データはコミットしないでください。

次を両方実行します。

```bash
bun run backtest --config=<trend用fixture設定>
bun run backtest --config=<rotation用fixture設定>
```

最低限、次を確認します。

- TrendとRotationの双方が実行できる
- 同じ入力から同じ結果が出る
- 履歴不足が明示的エラーまたは明示的除外になる
- 上場日前・上場廃止日後を使用しない
- 月末時点より後のデータをシグナルに使用しない
- 売買コストが結果へ反映される
- 最大3本を超えない
- -30% DD stopがintegration testで作動する
- データ不足をゼロや前月値で暗黙補完しない

### Phase 0.2: 状態文書の更新

検証結果に基づいて以下を更新してください。

- `docs/handoff/CURRENT_STATUS.md`
- `IMPLEMENTATION.md`
- 必要なら `README.md`

PR #11はすでにマージ済みです。以後の作業では、現在の作業ブランチや未完了実装を完了済みと表現しないでください。

## 9. 検証後の実装順序

Phase 0が通ったら、次の順で進めます。

実際のdelivery順序、NOW/NEXT/LATER、各milestoneのexit criteria、判断gateは `EXECUTION_ROADMAP.md` を正とします。以下のPhase一覧は能力領域の整理であり、Roadmapより先に別Phaseへ着手する許可ではありません。

### Phase 1: データを金融的に正しくする

1. O-001 provider候補を公式資料、credentialed sample、Point-in-Time改訂、license、costで評価する。評価コードはproviderを自動選定してはならない
2. 明示承認後に小さな同一銘柄sampleを複数sourceから取得・保存・照合し、O-001を人間判断へ戻す
3. Total Return / 分配金 / corporate actionのproduction接続はO-001承認後に行う
4. `universe-master-v1` の検証済みデータ接続はO-003/O-004を確定せずに行う
5. 残りのrebalance/replacement等robustness axesを比較実験として追加

### Phase 2: バックテストを頑健にする

1. Strategy A/B parameter grid（実装済み。O-005は未解決）
2. 3M/6M/12M重みの感度分析
3. 月末・月中・25日前後のリバランス感度
4. 即入替・ヒステリシス・最低保有期間の比較
5. コスト感度
6. 最大DD、CAGR、Sharpe、Sortino、turnover、cash ratio
7. 最悪月・最悪年・危機局面分析
8. 戦略間リターン相関

最良の1点を採用せず、広いパラメータ領域で安定するものを優先してください。

### Phase 3: Strategy CとForward Test

1. Decision Package schema
2. Portfolio Manager interface
3. Macro Analyst interface
4. Risk/Critic interfaceと限定的拒否権
5. timestamped evidence
6. contrary evidence
7. thesis expiry
8. model/version記録
9. virtual positions/orders persistence
10. monthly scheduleと重要イベント通知
11. 1分ダッシュボードと詳細レポート

Strategy Cは、検証済みデータを受け取るまでは資産選択に使用しないでください。

## 10. 未確定事項の扱い

`OPEN_DECISIONS.md` の項目は、Codexが好みで確定してはいけません。

次の順で処理してください。

1. 問題と選択肢を整理
2. 一次情報・公式仕様・実データを確認
3. 再現可能な比較実験を実施
4. 結果、トレードオフ、推奨案を提示
5. 金融方針・リスク許容・実弾運用に関わるものは人間承認を得る
6. 承認後に `DECISIONS.md` へ移す

実装上の軽微な選択は自律的に進めて構いません。ただし、投資方針、Universe、リスク制約、評価基準を実質的に変える変更は承認対象です。

## 11. Git / PR運用

- `main` を直接編集せず、作業ごとにbranchを作る
- 小さくレビュー可能なPRへ分割する
- PR本文に目的、変更、検証、データ上の制約、未解決事項を書く
- テスト未実行を「成功」と表現しない
- ユーザーの明示指示なしにPRをマージしない
- downloaded market data、API key、secret、`.env` をコミットしない
- lockfileはコミットする
- 既存の未関連コードを大規模に整理しない

## 12. 完了報告フォーマット

各作業の最後に、次の形式で報告してください。

```text
## 実施内容
- ...

## 検証
- bun test: PASS / FAIL
- CLI: PASS / FAIL
- 使用データ: ...

## 得られた結果
- ...

## 制約・不確実性
- ...

## 変更ファイル
- ...

## 次の作業
- ...
```

バックテスト結果を報告する場合は、データ源、期間、Total ReturnかPrice Returnか、為替処理、コスト、対象Universe、Point-in-Time条件を必ず併記してください。

## 13. 初回タスクの完了条件

Codex移行後の最初のタスクは、次がすべて満たされた時点で完了です。

- `main` の最新状態を取得済み
- `bun install` 成功
- `bun test` 成功、または失敗原因と修正PRがある
- fixtureを用いたTrend CLI成功
- fixtureを用いたRotation CLI成功
- Point-in-TimeとDD stopのintegration coverageがある
- マージ済みPR #1を前提に引き継ぎ文書が更新されている
- 検証結果をPRまたは作業報告へ記録している

この完了条件を満たすまでは、実データの利益率をプロジェクトの有効性として評価しないでください。
