# Running Bulletin locally

The API and web app can run together with the local JSONL stores. Start from
the repository root in each terminal.

## First run with Claude Code

1. Install Node.js 22 or later, pnpm 10, Git, and Claude Code. Sign in to Claude
   Code before starting. Planning, interviews, and automatic answers use it
   with either execution runner.
2. Install dependencies and verify the checkout.

   ```sh
   pnpm install --frozen-lockfile
   pnpm run verify
   ```

3. Choose an existing local Git repository with at least one commit as the
   target project. Have its path and a goal ready. The API uses Claude Code for
   mission execution by default.
4. Start the API in the first terminal. Use `PORT` to change its listening port
   or `BULLETIN_SCRATCH_DIR` to change where it stores data and worktrees.

   ```sh
   pnpm --filter @bulletin/api exec tsx src/serve.ts
   ```

   Request `/health` at the printed address to confirm the API is ready.
5. In the second terminal, point `NEXT_PUBLIC_API_URL` at the API's printed
   address and start the web app. The web app uses mock data when this variable
   is unset. For a different browser origin, add it to `BULLETIN_WEB_ORIGINS`
   in the API terminal before starting the API.

   ```sh
   pnpm --filter @bulletin/web dev
   ```

6. Open the web app's printed address and go to `/new`. Enter the goal and
   repository path, answer or skip interview questions, and review the Briefing
   and plan before approving. The project page shows live progress. Review the
   integration branch in the target repository after the run.

## Run stations in Managed Agents

Complete the installation and sign-in steps above. Before starting the API,
set up a sandbox repository and a Managed Agents environment and agent.

1. Provide the platform key in `ANTHROPIC_API_KEY` and the sandbox repository's
   scoped GitHub credential in `BULLETIN_GITHUB_TOKEN`.
2. Create the environment and agent once. The setup script saves their IDs in
   `.bulletin-local.json`. You can provide existing IDs through
   `BULLETIN_MA_AGENT_ID` and `BULLETIN_MA_ENV_ID` instead.

   ```sh
   pnpm --filter @bulletin/api exec tsx scripts/ma-setup.ts
   ```

3. Select Managed Agents through `BULLETIN_RUNNER` and point
   `BULLETIN_SANDBOX_REPO` at the sandbox repository. Use a local clone of the same
   repository as the project in `/new`. Start the API and web app with the same
   commands as above, then review and approve the plan.

The API startup warning lists missing configuration by name. See
[Managed Agents setup](MANAGED-AGENTS.md) and the [API reference](API.md).

## API access and local data

Direct local web access uses the API with bearer authentication disabled. To
protect API access, configure `BULLETIN_API_TOKEN` in the API process and have a
server-side proxy or API client send the bearer header, including for SSE.

Mission events and Briefings live under `.bulletin-scratch/api` by default.
Keep the numbered JSONL segments with their original files to retain the full
history across restarts. Question board entries live in memory for the API
process, and their events remain in mission history.
