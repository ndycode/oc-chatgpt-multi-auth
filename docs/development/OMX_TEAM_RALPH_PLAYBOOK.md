# OMX Team + Ralph Reliability Playbook (WSL2-First)

This runbook defines the repository-standard execution flow for high-rigor work using `omx team` plus `omx ralph`.

## Scope

- Repository-specific workflow for `oc-chatgpt-multi-auth`.
- Primary mode: team execution on WSL2 + tmux.
- Controlled fallback: single-agent Ralph execution.
- Completion requires parity quality gates in both modes.

## Defaults and Guardrails

- Default team topology: `6:executor`.
- Retry policy: fail-fast with at most `2` controlled retries per run.
- No normal shutdown when tasks are non-terminal.
- Mandatory completion gates:
  - terminal state (`pending=0`, `in_progress=0`, `failed=0`) for team mode
  - `npm run typecheck`
  - `npm test`
  - `npm run build`
  - `npx tsc --noEmit --pretty false` diagnostics
  - architect verification (`--architect-tier` and `--architect-ref`)
- Ralph completion requires explicit state cleanup (`omx cancel`).

## Atomic Phases

### Phase 0 - Intake Contract

Lock execution contract for this run:

- target task statement
- default worker topology (`6:executor`)
- gate policy and architect verification format

### Phase 1 - Baseline Integrity Gate

From repo root:

```bash
git fetch origin --prune
git rev-parse origin/main
```

If working on an isolated branch/worktree, confirm:

```bash
git status --short
git branch --show-current
```

### Phase 2 - Mainline Deep Audit

Audit surfaces before mutation:

- workflow docs (`docs/development`)
- scripts contract (`scripts`)
- package scripts (`package.json`)
- `.omx/tmux-hook.json` integrity

### Phase 3 - Isolation Provisioning

Create isolated worktree from synced `origin/main`:

```bash
git worktree add <path> -b <branch-name> origin/main
```

Never implement directly on `main`.

### Phase 4 - Deterministic Routing

Run preflight:

```bash
npm run omx:preflight
```

JSON mode:

```bash
npm run omx:preflight -- --json
```

Optional distro selection:

```bash
npm run omx:preflight -- --distro Ubuntu
```

#### Preflight Exit Codes

| Exit Code | Mode | Meaning | Required Action |
| --- | --- | --- | --- |
| `0` | `team_ready` | Team prerequisites are satisfied | Continue with team mode |
| `2` | `team_blocked` | Fixable blockers (for example hook config) | Fix blockers, rerun preflight |
| `3` | `fallback_ralph` | Team-only prerequisites failed | Execute controlled Ralph fallback |
| `4` | `blocked` | Fatal blocker for both team and fallback (for example `omx` missing in both host and WSL runtimes) | Stop and fix fatal prerequisite |
| `1` | script error | Invocation/runtime failure | Fix command/environment |

### Phase 5 - Ralph Execution Loop

#### Team Path (preferred)

Inside WSL tmux session:

```bash
omx team ralph 6:executor "execute task: <clear task statement>"
```

Capture startup evidence:

```bash
omx team status <team-name>
tmux list-panes -F '#{pane_id}\t#{pane_current_command}\t#{pane_start_command}'
test -f ".omx/state/team/<team-name>/mailbox/leader-fixed.json" && echo "leader mailbox present"
```

Monitor until terminal:

```bash
omx team status <team-name>
```

Terminal gate for normal completion:

- `pending=0`
- `in_progress=0`
- `failed=0`

#### Controlled Fallback Path

Use fallback only when preflight mode is `fallback_ralph`:

```bash
omx ralph "execute task: <clear task statement>"
```

### Phase 6 - Hardening and Evidence

Capture evidence before shutdown/handoff:

```bash
npm run omx:evidence -- --mode team --team <team-name> --architect-tier standard --architect-ref "<architect verdict reference>" --architect-note "<optional note>"
```

Ralph cleanup before fallback evidence:

```bash
omx cancel
```

Fallback evidence:

```bash
npm run omx:evidence -- --mode ralph --architect-tier standard --architect-ref "<architect verdict reference>" --architect-note "<optional note>"
```

Ralph state cleanup (required for completion):

```bash
omx cancel
```

### Phase 7 - Shutdown and Handoff

For team mode, only after evidence passes:

```bash
omx team shutdown <team-name>
test ! -d ".omx/state/team/<team-name>" && echo "team state cleaned"
```

Handoff package must include:

- branch name and commit SHA
- gate evidence file path
- architect verification reference
- unresolved blockers (if any)

## Fail-Fast Controlled Retry Contract

Retry budget is `2` retries maximum for a single run.

Retry triggers:

- team task failures
- no-ACK startup condition
- non-reporting worker condition after triage

Retry steps:

1. Capture current status and error output.
2. Attempt resume:
   - `omx team resume <team-name>`
   - `omx team status <team-name>`
3. If unresolved, controlled restart:
   - `omx team shutdown <team-name>`
   - stale pane/state cleanup
   - relaunch with same task
4. After second retry failure, stop and escalate as blocked.

## Reliability Remediation

### tmux-hook placeholder target

If `.omx/tmux-hook.json` contains:

```json
"value": "replace-with-tmux-pane-id"
```

Set a real pane id:

```bash
tmux display-message -p '#{pane_id}'
```

Then validate:

```bash
omx tmux-hook validate
omx tmux-hook status
```

### Stale pane and team state cleanup

Inspect panes:

```bash
tmux list-panes -F '#{pane_id}\t#{pane_current_command}\t#{pane_start_command}'
```

Kill stale worker panes only:

```bash
tmux kill-pane -t %<pane-id>
```

Remove stale team state:

```bash
rm -rf ".omx/state/team/<team-name>"
```

## Failure Matrix

| Symptom | Detection | Action |
| --- | --- | --- |
| `tmux_hook invalid_config` | `.omx/logs/tmux-hook-*.jsonl` | fix `.omx/tmux-hook.json`, revalidate |
| `omx team` fails on tmux/WSL prerequisites | command output | use preflight routing, fallback if mode `fallback_ralph` |
| startup without ACK | missing mailbox updates | resume/triage then controlled retry |
| non-terminal task counts at completion | `omx team status` | block shutdown until terminal gate |
| architect verification missing | no `--architect-*` evidence | block completion |
| fatal preflight blocker (`blocked`) | preflight exit code `4` | stop and fix prerequisite |

## Done Checklist

- [ ] Preflight routing executed and mode recorded.
- [ ] Team startup evidence captured (if team mode).
- [ ] Terminal task-state gate satisfied before shutdown.
- [ ] Fresh quality gates passed (`typecheck`, `test`, `build`, diagnostics).
- [ ] Architect verification recorded with tier + reference.
- [ ] Evidence file created under `.omx/evidence/`.
- [ ] Ralph cleanup state is inactive in evidence output (`omx cancel` done before final ralph evidence).
- [ ] Team shutdown + cleanup verified (team mode only).

## Command Reference

```bash
# Preflight
npm run omx:preflight

# Team execution
omx team ralph 6:executor "execute task: <task>"
omx team status <team-name>
omx team resume <team-name>
omx team shutdown <team-name>

# Ralph fallback
omx ralph "execute task: <task>"
omx cancel

# Evidence
npm run omx:evidence -- --mode team --team <team-name> --architect-tier standard --architect-ref "<verdict-ref>"
npm run omx:evidence -- --mode ralph --architect-tier standard --architect-ref "<verdict-ref>"
```
