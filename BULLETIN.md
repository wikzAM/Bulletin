# Bulletin - open questions for the human, newest last

## [2026-11-16] Founder decision: acceptance target (spec section 17)
- question: Run acceptance against the sample todo app only, or also a real hackathon project?
- options: (a) todo app only until M3, then a real project at the dogfood gate; (b) both from M1
- recommendation: (a). The dogfood gate after M3 already requires a real project, and M1-M2 checks need a small, fast target.
- working default: (a)
- status: open

## [2026-11-16] Founder decision: budgets (spec section 17)
- question: What is the default mission budget, and the spend limit on the development API key?
- options: (a) $5 per mission, $50 monthly key limit; (b) $10 per mission, $100 key limit; (c) your numbers
- recommendation: (a). The sample mission should cost well under $1; a low cap proves the pause path early.
- working default: 500 cents per mission in code paths that need a number. The key limit is yours to set in the Console.
- status: open

## [2026-11-16] Founder decision: military theme (spec section 17)
- question: Does the UI use the military theme from day one, or plain language first?
- options: (a) glossary names in code and logs, plain language in Layer 0 UI copy; (b) themed everywhere
- recommendation: (a). The spec's glossary already fixes code names, and the product doc says to test the theme with non-technical users first.
- working default: (a)
- status: open

## [2026-11-16] Founder decision: open-sourcing (spec section 17)
- question: Release the board and graph engine first, or keep it private until the dogfood gate?
- options: (a) public repo now; (b) private until the dogfood gate
- recommendation: (a), which you already chose by asking for a public repo. Only docs/SPEC.md is published; the pitch, market and brainstorm docs stay out of the repo.
- status: open

## [2026-11-16] Merge the M1 logic units
- question: Merge `m1/integration` into `main`? Six units (plan validation, waves, send-back, merge policy, pass rules, treasury), 159 tests green with the engine loop, after two checker findings were fixed.
- options: (a) review `git diff main...m1/integration`, then `git merge m1/integration`; (b) ask for changes first
- recommendation: (a)
- status: open

## [2026-11-16] Log the Claude CLI in so graph.py can run stations
- question: `claude -p` fails with "OAuth session expired" outside the desktop app, so `graph.py` cannot start stations. Run `claude auth login` in a terminal?
- note: the plan passed `graph.py --dry-run`; this run's six units were built by in-session subagents in isolated worktrees instead.
- status: open

## [2026-11-16] Give gh the workflow scope so CI can be pushed
- question: GitHub rejected `.github/workflows/ci.yml` because the gh token lacks the `workflow` scope. Run `gh auth refresh -s workflow`, then `git merge ci-workflow && git push`?
- note: the CI commit is parked on the local branch `ci-workflow`. M0's "CI runs lint, typecheck, and tests" box is not verified until this lands.
- status: open

## [2026-11-16] Docker daemon would not start
- question: Docker Desktop crashes on start ("remove ...dockerInference: The file cannot be accessed by the system"). Windows refuses to delete the three stale socket files in `%LOCALAPPDATA%\Dockerun` (dockerInference, dockerEthernetVfkit, userAnalyticsOtlpHttp.sock) even from Node: access denied. Reboot, or delete them from an administrator terminal, then start Docker and run `docker compose up` and `curl localhost:4000/health`?
- note: the api and pass-worker `/health` endpoints were verified by running them directly with tsx.
- status: open
