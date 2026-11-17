# Running stations on Claude Managed Agents

Needs an Anthropic API key (Claude Code login does not cover it). Set it in your own shell, never in a file:
`$env:ANTHROPIC_API_KEY = "<key>"` (PowerShell). Never paste keys into chat or commit them.

One-time setup (agent and environment are created once, then referenced by id):
1. Create an environment (cloud, limited networking with package managers on) and an agent (model claude-sonnet-5-5, the agent toolset) in the Console or with the SDK.
2. Scratch repo for the sandbox to clone and push to: https://github.com/wikzAM/bulletin-sandbox (private). Create a fine-grained GitHub token limited to that repo (Contents: read/write) and set `$env:BULLETIN_GITHUB_TOKEN`.
3. Set `$env:BULLETIN_MA_AGENT_ID` and `$env:BULLETIN_MA_ENV_ID`.

Code: `sdkManagedClient(client.beta.sessions, setup)` in apps/api/src/managed-client.ts feeds `ManagedAgentsRunner`. Each attempt is a session with a hard budget equal to the unit allowance; the agent pushes `bulletin/<mission>/<unit>-aN` and the runner fetches it back. Wiring into the CLI (`--runner managed`) is the next step once the setup above exists.
