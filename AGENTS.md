# AGENTS.md

## Start here

Before changing code or documentation:

1. Read `docs/handoff/CODEX_PROJECT_INSTRUCTIONS.md`.
2. Read `docs/handoff/DECISIONS.md`, `docs/handoff/CURRENT_STATUS.md`, and `docs/handoff/OPEN_DECISIONS.md`.
3. Read `investment_policy.md`, `strategy_spec.md`, `backtest_spec.md`, and `IMPLEMENTATION.md` as relevant to the task.
4. Inspect the current Git branch, worktree, and related pull request before editing.

## Source of truth

Use this precedence order:

1. The user's latest explicit instruction.
2. Active decisions in `docs/handoff/DECISIONS.md`.
3. `investment_policy.md`, `strategy_spec.md`, and `backtest_spec.md`.
4. Current implementation and status documents.

The original ChatGPT question sequence is not a specification. Do not restore abandoned options or treat earlier recommendations as approved decisions. Items in `OPEN_DECISIONS.md` must not be settled arbitrarily; use research/backtests, or request human approval when the choice is material.

## Engineering constraints

- Use TypeScript and Bun. Use the Node.js version required by the repository.
- Keep Python out of the project unless the user explicitly changes this decision.
- Put deterministic calculations, validation, portfolio constraints, and safety controls in code.
- AI may interpret macro/news/policy/consensus inputs, but must not silently override hard portfolio or risk constraints.
- Preserve point-in-time behavior. Prevent look-ahead bias, survivorship bias, and use of an ETF before its listing date.
- Model transaction costs and data quality explicitly. Never present unadjusted research data as final total-return evidence.
- Do not change the approved investment policy or risk guardrails without explicit user approval.
- For an approved implementation task, proceed autonomously within scope and report changes, tests, and limitations.
- Run `bun test` and the relevant executable path before declaring implementation complete. If execution is unavailable, state that clearly.
- Do not merge a pull request, expose secrets, or commit downloaded market-data caches unless explicitly requested.
