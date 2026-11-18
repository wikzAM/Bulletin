# M5 team sync design

M5 adds opt-in sharing for individual missions. The desktop host keeps the
local SQLite event log and runs the mission. A small sync service manages
invites and membership, relays shared Bulletin events, and feeds the war table
and phone inbox. See the [Platform, data model, and security rules](SPEC.md).

## Invite and join

1. The Commander enables sharing for a mission and generates an expiring,
   single-use invite link scoped to that mission.
2. The teammate follows the link and signs in once. The service atomically
   redeems the invite and creates a membership for that user and mission as
   `member`. Store only a digest of the invite token and keep complete invite
   links out of logs. The Commander can revoke any unused invite.
3. The teammate receives the shared event history and follows new events from
   their last acknowledged cursor. Every read and write checks current
   membership. Removing a member cuts off future access, including active
   subscriptions.

## Shared Bulletin

The sync service assigns an ordered cursor per mission. The host and teammate
clients can resume from their last applied cursor after a disconnect. Retried
uploads use a stable source ID plus event ID so the service can deduplicate
them. Local event IDs are scoped to their source and remain unchanged.

A teammate can answer a shared question or claim an available unit. The
service authenticates the actor, checks membership and role, and records who
acted in the append-only event history. The service accepts at most one claim
for a unit at a time. A teammate's Claude Code runner can use its own worktree
and connect through Bulletin MCP with a short-lived token scoped to that
mission and unit. Git access is arranged separately. Proposed work still goes
through the same pass on the mission host. Station tokens permit station
messages and access to their scoped dispatches. Human decisions require a
signed-in member.

## Data leaving the machine

The service stores sign-in identity and membership to manage access. The only
mission data uploaded is a projection of events for the missions the Commander
shares. The projection can include opaque mission, unit and actor IDs,
timestamps, status changes, claim and decision outcomes, and numeric receipt
totals. Shared questions and answers carry text entered for sharing or
explicitly reviewed for publication.

Build the projection from an allowlist of event types and fields. Keep raw
dispatch payloads, repository paths and contents, Briefing Markdown, diffs,
attachments, and command output in the local app. Keep provider keys, Git
credentials, environment values, and keychain values local as well. Use the
same data boundary for live sync and history replay.

## Mission roles

- The **Commander** owns the mission, manages invites, and can approve plans,
  closed-lane merges, and budget increases. The Commander can answer questions
  and claim units.
- A **Member** can view the shared mission, answer questions, and claim units.
  Plans, closed-lane merges, and budget increases require Commander approval.

Load roles from the membership keyed by `(mission_id, user_id)` for the
authenticated actor. Enforce the role on the service before accepting a
decision and on the mission host before it takes effect.
