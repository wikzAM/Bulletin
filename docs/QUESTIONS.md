# Questions

Open questions found while building. Each names the spec section, the reversible option taken, and stays
here until answered.

- **Section 12, prices.** The Haiku 5.5 cache-read price was not in the reference used to fill
  `config/prices.json`. Taken: 0.1x input ($0.01 per million). Confirm against the pricing page.
- **Section 12, prices.** Haiku 5.5 costs more above 100K prompt tokens ($0.50 / $2.50). `prices.json`
  has one price per model. Taken: the under-100K price, since answerer and triage prompts are small.
- **Section 8, rule 7.** "Allowed command patterns" has no defined source. Taken: a list passed in the
  validation context, defaulting to the repository's package-manager commands (`pnpm *`, `npm *`, `npx vitest *`).
- **Section 11, lessons.** "Any lesson that has happened twice becomes one line in rules.md, written as a rule
  about how to cut units" needs judgment to word well. Taken: a fixed sentence per repeated reason (see DECISIONS).
- **Section 7, touches.** A touch is "any resolved decision plus any manual edit"; `plan_approval` is itself a
  decision kind. Taken: plan approval counts as one touch.
- **Section 6.** The spec lists Docker for checks, but the local runner works in worktrees on the host.
  Taken for M1: the pass-worker can run checks directly in a clean worktree when Docker is not available, and
  says so in the verdict evidence; Docker stays the default.
