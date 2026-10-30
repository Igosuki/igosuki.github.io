---
title: Multiplexers for agents, and layouts anyone can watch
description: Once agents run for an hour in five repos at a time, the terminal multiplexer is infrastructure. What's mature, how tmux, zellij, cmux and graith compare, and one layout file that sets up a backend, frontend, SRE or orchestrator workspace in any of them.
pubDate: 2026-10-30
kind: note
tags: [agents, terminal, tmux, zellij, worktrees, tooling]
draft: true
---

<!--
Q: open with your own moment? e.g. the reboot that lost six Claude sessions, or "which tab was asking me for permission?"
Facts marked (verify) come from docs or --help and haven't been run end to end.
-->

With one agent, any terminal works. You type, it answers, and you watch it. With five agents across three repos, the
terminal stops being a window and becomes the place where the work lives. One agent is halfway through a refactor
in the API, another is waiting for permission in the frontend, a third was started by the first one on a build box
and nobody has looked at it since lunch. If closing a laptop lid or restarting a GUI kills any of them, you lose an
hour of work and the context that came with it.

tmux was built for a human who detaches over SSH. The main users of a session are now processes that run for an
hour, stop to ask for permission, and start other processes. They need three things a plain terminal doesn't give
them:

- **Work that outlives the client.** The agent's process belongs to a daemon, not to the window you happen to have
  open, and after a reboot the conversation can be resumed.
- **Work that spans repos and machines.** A task touches the API and the web app, and some of it runs on a box with a
  GPU or in a container. The session has to reach those places and keep them in one view.
- **Work anyone can look at.** You, a teammate, a script, or another agent should be able to attach to a session and
  see at a glance what each agent is doing, without taking the keyboard away from it.

This post covers what's mature, how four tools I've used measure up, and then the part I actually wanted to write
about: workspaces built from layouts. A layout says "agent on the left, dev server and preview on the right, checks on
a second tab". It lives in the repo or in a shared bank, and it renders into whatever multiplexer you run. The code
is in [demos/agent-layouts](https://github.com/Igosuki/igosuki.github.io/tree/master/demos/agent-layouts).

## What I expect from a multiplexer now

Seven things, which the rest of the post comes back to:

1. **Sessions outlive the terminal.** This has two levels. First, the process survives a detach, because a daemon
   owns the PTY. Second, the conversation survives a reboot, because the agent can be resumed by session id.
2. **A programmatic interface.** A CLI or socket that can create a workspace, split a pane, run a command, send keys
   and read the screen. JSON output and an event stream are a bonus.
3. **Panes and tabs.** The agent next to its dev server, test watcher and logs.
4. **Agents talking to agents.** One agent starts another, sends it a message, reads its output, waits for it.
5. **Agent status.** Working, needs you, done, across every session, at a glance.
6. **Search and switching.** Jumping to "the one that needs me" without walking through tabs.
7. **Observers.** A read-only attach for humans and a screen or event API for processes.

## What's out there

The general-purpose multiplexers are old and stable, and they're still the base everything else builds on:

- **tmux** (C). 3.6 shipped in November 2025. A server owns every pane, the CLI drives all of it, and control mode
  (`tmux -C`) streams pane output as structured events. It runs anywhere SSH does. It's the default for a reason.
- **GNU screen** (C). Maintained, with 5.0 in 2024 and security fixes since, but it moves slowly and has little
  scripting surface by today's standards.
- **zellij** (Rust). Declarative KDL layouts, a plugin system, session resurrection, and since 0.43 a web client.
  0.44 added read-only attach, `list-panes`, per-pane `dump-screen` and `subscribe`, which makes it much better for
  observers than it used to be.
- **WezTerm** has a real multiplexer, with unix domains for a local daemon and SSH domains that need wezterm on the
  remote. **kitty** has remote control (`kitten @ launch`, `get-text`) and session files, but no daemon: the
  sessions live in the GUI process.
- **abduco** and **dtach** detach a single process and do nothing else. They work fine and are effectively finished.
- **Ghostty** has tabs and splits but no multiplexer, and the project has said it doesn't plan to build one. Its VT
  engine, libghostty, is now used by tools that do.

A second group is built for agents specifically:

- **cmux** ([manaflow-ai/cmux](https://github.com/manaflow-ai/cmux)) is two things in one repo: a native macOS
  terminal with vertical tabs, notification rings and a browser, and a Rust TUI multiplexer on libghostty-vt for
  macOS and Linux. This post is about the TUI. Don't confuse it with Coder's agent multiplexer, also once called cmux
  and since renamed [Mux](https://github.com/coder/mux), which is an Electron app.
- **graith** ([d0ugal/graith](https://github.com/d0ugal/graith)) is a Go daemon plus the `gr` CLI. Each session is
  one agent with its own worktree and branch. Messaging between agents is built in.
- **diri** is a desktop app (Rust/GPUI) with a headless daemon, `dirijord`, and the `dirijor` CLI, plus an MCP server
  that lets an agent start other agents and answer their prompts. Linux support is in beta.
  <!-- Q: link for diri? the research pass couldn't find a public page. -->
- **claude-squad**, **uzi** and **Agent-Manager** put a TUI over tmux with a worktree per agent. **Conductor**,
  **Superset** and **Vibe Kanban** are GUI apps in the same space.
- Claude Code has its own supervisor now: `claude --bg "<prompt>"` starts a session in the background, and
  `claude agents` lists them with their state (verify). It isn't a multiplexer, but anything that wants to know
  whether a Claude session needs you can ask it.

I'll go through four: tmux with its plugins as the baseline, zellij for its layouts, cmux for its socket API, and
graith for coordination.

## tmux, with the bells and whistles

Plain tmux already does the first level of persistence. Most of what makes it pleasant for agents comes from four
additions.

**sesh for workspaces.** [sesh](https://github.com/joshmedeski/sesh) gives each project a named session and a fuzzy
picker across configured sessions, running ones and zoxide directories. Its `sesh.toml` sets a path, a startup
command and named windows. It doesn't do panes, so the startup command is where a layout goes:

```toml
[[session]]
name = "api"
path = "~/dev/api"
startup_command = "layouts up backend --session api"
```

**resurrect and continuum for reboots.** tmux-resurrect saves sessions, windows, panes, working directories and exact
layouts. tmux-continuum saves on a timer and restores when the tmux server starts.

```tmux
set -g @plugin 'tmux-plugins/tpm'
set -g @plugin 'tmux-plugins/tmux-resurrect'
set -g @plugin 'tmux-plugins/tmux-continuum'
set -g @continuum-restore 'on'
set -g @continuum-save-interval '5'
set -g @resurrect-capture-pane-contents 'on'
set -g @resurrect-processes '"~claude->claude --continue"'
run '~/.tmux/plugins/tpm/tpm'
```

The catch is that resurrect restores programs by command line, not by state. The `->` rule above restarts `claude`
in each pane where it ran, with `--continue`, which picks up the most recent conversation in that directory. Two
agents in the same repo would both get the same one back. That gap is what I wrote **claude-ws** for. After each
save it maps every pane to its Claude session id, by matching the processes from `claude agents --json` to tmux panes, and on
restore it runs `claude --resume <id>` in the right pane. It also shows `◆ needs you / ● working / ○ idle` badges in a
project picker, searches past conversations, and has a `shutdown --poweroff` that waits until no agent is mid-turn.
<!-- Q: confirm claude-ws is yours, and whether to link it. -->

**worktrunk for worktrees.** [worktrunk](https://worktrunk.dev) (`wt`) creates, switches and removes git worktrees,
with hooks around each step. A worktree per task is the natural unit for an agent workspace, so the hook is where the
layout starts. There's more on that below.

**Status in the status bar.** Claude Code's `Notification` hook fires when it needs permission or has been idle for a
minute, and `Stop` fires when it finishes. A hook that sets a tmux user option on its pane
(`tmux set -p @state needs-you`) is enough to show it in `pane-border-format` or the status line.

tmux is the most scriptable of the four and the one that works on every machine you'll SSH into. What it lacks is any
idea of what an agent is. Everything above is something you add yourself.

## zellij, for its layouts

zellij deserves a mention here mostly for how it describes a workspace. A layout is a KDL file, and it's declarative:
you say what the panes are and zellij builds them, where tmux needs a script of splits.

```kdl
layout {
    tab name="code" focus=true {
        pane split_direction="vertical" {
            pane name="agent" size="55%" focus=true command="claude"
            pane split_direction="horizontal" {
                pane name="server" command="cargo" { args "watch" "-x" "run"; }
                pane name="tests" command="cargo" { args "nextest" "run"; }
            }
        }
    }
    tab name="data" {
        pane name="db" command="psql"
        pane name="logs" command="tail" { args "-F" "log/development.log"; }
    }
}
```

On top of that, `pane_template` and `default_tab_template` let you reuse pieces, and swap layouts
(`swap_tiled_layout`) rearrange panes as their number changes, which suits a tab that fills up with workers.
`start_suspended=true` shows the command and waits for Enter, which is a good default for a layout you got from
someone else. Layouts are looked up by name in `~/.config/zellij/layouts`, or loaded by path or URL (commands from a
URL start suspended).

Three commands matter for agents:

```sh
zellij --layout backend.kdl attach --create-background api   # start detached, with every pane running
zellij --session api run -n fix-auth -- claude "fix the auth test"   # add a pane from a script or another agent
zellij watch api                                             # attach read-only
```

`--layout` is a global flag and has to come before `attach`, and the session name is required. Without it you get a
randomly named session that ignores the layout. Since 0.43, `zellij web` serves sessions to a browser, and since
0.44 you can create read-only tokens for it. For a "watch what the agents are doing" link, that's the shortest path
of any tool here.

zellij's weak spot for this use is that it's less scriptable than tmux. `zellij action` covers a lot, but new tabs
added to a detached session with `new-tab --layout` only get their panes once a client attaches, so build the whole
layout at creation.

## cmux, for its socket

The cmux TUI is a daemon with a tree: session → workspace → screen → pane → tab, where a tab is a terminal or a
browser. Every node is reachable from a noun-first CLI that maps one-to-one onto a socket protocol, and every command
takes `--json`. Creating something returns its ids:

```sh
cmux server ensure --session api
cmux --session api --json workspace create --name api
# {"value":{"workspace_id":"ws_…","screen_id":"screen_…","pane_id":"pane_…","tab_id":"tab_…","terminal_id":"term_…"}}
cmux --session api --json pane pane_… split --right --ratio 0.45   # the new pane gets 45%
cmux --session api pane pane_… run --on-exit keep shell 'cargo watch -x run'
cmux --session api tab create browser --url http://localhost:5173 --pane pane_…
```

That makes it the easiest of the four to drive from code, and the only one with a browser tab next to the agent. The
browser attaches to Chrome over CDP rather than launching one, so you need a cmux browser provider or a `cdp_url` in
the config. Two small surprises: `pane run` adds a new tab to the pane rather than replacing the shell, so close the
shell tab afterwards, and `workspace run` goes to whichever pane has focus.

There's a `workspace <id> layout apply --layout <json>`, and `screen <id> layout export` prints the tree of splits
and ratios. The schema isn't documented yet, so I build layouts with individual calls.

For agents, cmux ships PATH shims that wire Claude Code and Codex hooks in automatically, so their state (working,
waiting, done) appears in the sidebar without setup. `cmux agent report --state` lets anything else report its own.
Observers get `cmux attach --session api` (several clients share one live session), `terminal <id> screen read` for
the visible text, `screen wait --pattern` to block until something appears, and `--jsonl session current events` for
a stream. I didn't find a read-only attach.

Remote hosts go through `cmux remote ssh user@host --session dev`, which bootstraps the binary on the far side, or a
machine rail fed from `~/.ssh/config`, or `--cloud` for cmux's hosted machines (verify: I haven't run the remote paths).

## graith, for coordination

graith takes the opposite position on layout: there isn't any. A session is one agent, full screen, in its own
worktree and branch, and you switch between sessions with tmux-style `ctrl+b` keys and a navigator grouped by repo.
What it has instead is everything agents need to work together:

```sh
gr new api-auth --agent claude --background -p "fix the flaky auth test"   # own worktree and branch
gr list --children orchestrator --json
gr msg send --no-reply --children "stop after this commit"   # to every child
gr msg pub -t reviews "PR 412 ready"                   # topics, threads, per-session inboxes
gr msg sub -t reviews --wait                           # block until something arrives
gr wait api-auth --idle --timeout 30m
gr status "migrating schema" --ttl 10m                 # an agent reports its own state
gr attach api-auth --read-only
gr logs api-auth -n 50
gr events --json                                       # status changes and public messages, fleet-wide
```

Sessions created from inside another session get it as their parent, so `gr stop --children` takes down a whole tree.
There's a shared store (`gr store`) and a todo list with dependencies (`gr todo`). Scenarios are the closest thing to
a layout: a TOML file listing sessions with a repo, agent, role and task, plus timeouts, retries and `depends_on`,
started by an orchestrator session with `gr scenario start`. The daemon survives its own upgrades, and an optional OS
sandbox (Landlock and seccomp on Linux, Seatbelt or safehouse on macOS) fails closed, so a sandboxed agent can't start
an unsandboxed child. Remote machines are reached by pairing daemons over Tailscale (`gr remote pair`), not by SSH.

Two things changed since I first looked at it: the MCP server and `gr dashboard` are gone, on purpose. Agents use the
CLI, and `gr list` and the navigator replace the dashboard.

Because graith owns its worktrees, it overlaps with worktrunk. Either let graith create them, or make the worktree
with `wt` and start the agent in it with `gr new x --in-place -C <worktree>`.

## One layout file, four multiplexers

Every tool above has its own idea of a layout: a tmux script, zellij KDL, a sequence of cmux calls, a graith
scenario. I want to write a workspace once, keep it in the repo next to the code it's for, and start it in whatever
multiplexer is running. So the demo has a small format and a ~450-line script, `layouts`, that renders it.

```yaml
# .layouts/backend.yaml
name: backend
description: An agent next to the API server, the test watcher, a database shell and the logs.
vars:
  agent: claude
  serve: cargo watch -x run
  test: cargo nextest run --no-fail-fast
  db: psql "$DATABASE_URL"
  logs: tail -F log/development.log
tabs:
  - name: code
    split: columns
    panes:
      - { name: agent, agent: "{agent}", size: 55%, focus: true }
      - split: rows
        panes:
          - { name: server, run: "{serve}" }
          - { name: tests, run: "{test}" }
  - name: data
    split: rows
    panes:
      - { name: db, run: "{db}" }
      - { name: logs, run: "{logs}" }
```

A pane runs a command (`run`), an agent (`agent`, with an optional `prompt`), or shows a URL (`url`). `split:
columns` puts children side by side and `rows` stacks them. Sizes are percentages of the parent. `{repo}`, `{root}`
and `{session}` are built in, and everything in `vars` can be overridden from the command line, so a Go service uses
the same file with `--set serve="go run ./cmd/api"`.

Where a layout comes from is a lookup path, first match wins:

1. `.layouts/` in the repo, versioned with the code and shared with everyone who clones it.
2. `~/.config/agent-layouts/`, your own bank.
3. The bundled bank in the demo.

To draft one, start from a template or from nothing:

```sh
layouts list                       # every layout on the path, and where it came from
layouts new web --from frontend    # copy the frontend template into .layouts/web.yaml, then edit its vars
layouts new scratch                # an agent pane and a shell
layouts show web                   # what each pane will run, after substitution
layouts render web --mux zellij    # the native config, to read or commit
layouts up web --mux tmux          # start it detached
```

The renderers are where the tools' differences show up. For tmux, each split takes a share of the pane before it,
so the script works out the fractions and names each pane through a user option shown in the border:

```sh
P1=$(tmux new-session -d -P -F '#{pane_id}' -s api -n code -c ~/dev/api -x 220 -y 60)
tmux set -w -t api:code remain-on-exit on
tmux respawn-pane -k -t "$P1" claude
P2=$(tmux split-window -h -d -P -F '#{pane_id}' -t "$P1" -l 45% -c ~/dev/api 'cargo watch -x run')
P3=$(tmux split-window -v -d -P -F '#{pane_id}' -t "$P2" -l 50% -c ~/dev/api 'cargo nextest run --no-fail-fast')
```

The first pane starts on a shell and is respawned with its command after `remain-on-exit` is set, so a command that
fails at once leaves its error on screen. In tmux that's a window option, so it has to be set on every window, not
once per session. That bug cost me a worker that vanished from the board the moment it exited.

For zellij the output is the KDL above, started with `attach --create-background`. For cmux it's the sequence of
calls, reading each new pane id out of the JSON. For graith, every agent pane becomes a `gr new --background` and
the rest is dropped with a comment: graith has nowhere to put a log tail, and that's a choice, not a gap.

## A bank of layouts

Four I use, then three for when the work has a different shape. The sketches show the first tab.

**Backend.** The agent with the server and the tests in view, so it sees a failing request in the server log as soon
as it does. A second tab holds a database shell and the logs, for you more than for it.

```text
┌──────────────────┬─────────────┐
│                  │ server      │
│ agent      55%   ├─────────────┤
│                  │ tests       │
└──────────────────┴─────────────┘   + data: db / logs
```

**Frontend.** The dev server and a preview next to the agent. In cmux the preview is a real browser tab, and with a
CDP-connected browser the agent can look at it too. Elsewhere it's a probe that prints the HTTP status every five
seconds, which tells you more than you'd think about whether the dev server fell over. Type checks and tests go on
a second tab so they don't crowd the agent.

```text
┌────────────────┬───────────────┐
│                │ dev       30% │
│ agent    50%   ├───────────────┤
│                │ preview       │
└────────────────┴───────────────┘   + checks: types | tests
```

**SRE.** The agent runs on the bastion, not your laptop, with a prompt that keeps it read-only and makes it append
findings to `incident.md`. The timeline pane tails that file on the same host, so anyone who attaches during the
incident reads the story so far without asking. Logs come from `stern`, and k9s gets its own tab.

```yaml
targets:
  bastion: { ssh: bastion, cwd: ~/incidents }
tabs:
  - name: triage
    split: columns
    panes:
      - { name: agent, agent: "{agent}", prompt: "{prompt}", target: bastion, size: 50%, focus: true }
      - split: rows
        panes:
          - { name: logs, run: "stern -n {namespace} {service} --since 15m" }
          - { name: timeline, run: "touch incident.md && tail -F incident.md", target: bastion }
```

**Agents.** An orchestrator with a board and `git worktree list` next to it, and an empty `workers` tab. The
orchestrator's prompt tells it how to start workers, and each one shows up as a pane in that tab. The next section is
about how that works.

```text
┌────────────────────┬───────────┐
│                    │ board     │
│ orchestrator  60%  ├───────────┤
│                    │ worktrees │
└────────────────────┴───────────┘   + workers: one pane per spawned agent
```

**Review.** A reviewing agent told not to edit anything, with `git diff --stat` against the base branch refreshing
beside it and `gh pr checks --watch` below. It's a good layout to hand to a teammate's agent, because everything it
needs to judge the change is in view.

**Migration.** Three columns: the old tree running its golden tests, the agent in the middle porting one module at a
time, the new tree on the right. A second tab diffs the two trees' output every thirty seconds, and the agent's prompt
says to keep going only when that diff is empty.

**Night shift.** Three headless workers on the build box, each told to claim a task from the queue (`bd ready`, in
my case), do it in its own worktree and close it with a summary. A board tab shows the queue and the last line of each
worker. You start it before bed and attach in the morning. Because the workers run on the remote, closing the laptop
doesn't stop them.

Other shapes I've thought about but haven't needed yet: a **bisect** layout (`git bisect run` with an agent writing
the test script), a **pairing** layout where two people attach to one agent, and a **docs** layout with the agent, a
docs dev server and a link checker.

## Agents that start agents

The agents layout is where the multiplexer stops being a viewer and becomes the runtime. The orchestrator is told:

> Split the task into independent pieces, and start each one with
> `layouts spawn --session {session} --name <slug> [--target <name>] -- claude "<task>"`.
> Watch them with `layouts ps --session {session}`.

`spawn` adds a pane to the session's `workers` tab and runs the command in it. Locally, in tmux, that's a
`split-window -d` followed by `select-layout tiled`. In zellij it's `zellij run -n <slug>`. In cmux it's a split of the
last worker pane plus a `pane run`. In graith it's `gr new --background`, and the new session becomes a child of the
orchestrator. In tmux and cmux the new pane opens without taking focus. `zellij run` lands in the active tab, so
`spawn` switches the session to `workers` first, and anyone watching is moved there too.

With `--target`, the pane runs somewhere else. A target is defined in the layout:

```yaml
targets:
  buildbox:  { ssh: buildbox, cwd: ~/src/{repo} }
  dev:       { devcontainer: "{root}" }
  sprite:    { exec: "sprite exec -s {repo} --tty --" }           # (verify)
  codespace: { exec: "gh codespace ssh -c {repo}-cs -- -t" }       # (verify)
```

Whatever the target, the command runs inside `tmux new -As <session>-<name>` on the far side, and the local pane
shows that remote tmux. This is the important part. The local pane is only a view, so if the laptop sleeps, the SSH
connection drops or the orchestrator's session dies, the worker keeps going. Anyone can then reach it directly with
`ssh -t buildbox tmux attach -t api-fix-auth`, without going through your session at all.

What each kind of destination needs:

- **SSH hosts** need tmux and the agent CLI installed and logged in. That's the most boring option, and the one I trust most.
- **Devcontainers** go through `devcontainer exec --workspace-folder .`, which needs tmux in the image. The upside is
  that the agent can do anything inside the container and nothing outside it.
- **Cloud sandboxes** vary. Daytona and Codespaces give you SSH, so they're just `ssh:` targets. Fly's Sprites have
  `sprite exec --tty` and a console you can detach from. E2B gives you a PTY through `e2b sandbox connect` and its SDK,
  but no SSH. A Sprite may pause when nothing is connected, which the local view pane happens to prevent and a
  disconnected night shift wouldn't (verify). The `exec` target takes any prefix that runs a command on the other side,
  so a new provider is one line.

graith does remote differently: you pair with a daemon on the other machine (`gr remote pair host`) and attach to
its sessions as `host/session`. That's tidier than SSH-in-tmux if you run graith everywhere, and doesn't help if you
don't.

## Anyone can look

The point of putting all of this in a multiplexer, rather than in background jobs with log files, is that you can
look at it. There are three kinds of looking, and each tool has a command for each:

| | A human, read-only | A process reads the screen | A stream of events |
|---|---|---|---|
| tmux | `tmux attach -r -t api` | `tmux capture-pane -p -t api:code.0` | `tmux -C attach -t api` (`%output` lines), `pipe-pane` |
| zellij | `zellij watch api`, or the web client with a read-only token | `zellij -s api action dump-screen -p terminal_0` | `zellij -s api subscribe -p terminal_0 -f json` |
| cmux | `cmux attach --session api` (shared, not read-only) | `cmux --session api terminal <id> screen read` | `cmux --session api --jsonl session current events` |
| graith | `gr attach api-auth --read-only` | `gr logs api-auth -n 50` | `gr events --json` |

The read-only attach is for people: a teammate who wants to see how the migration is going, or you on your phone over
SSH. The screen read is for agents and scripts, and it's what `layouts ps` uses. For tmux it prints one line per pane,
with the tab and pane name, what's running, and the last line on its screen:

```text
control/orchestrator   claude     ● Spawned 3 workers, waiting on fix-auth
control/board          watch      Every 5.0s: layouts ps --session api
workers/fix-auth       ssh        ✓ auth tests pass, opening PR
workers/docs           exit 0     Pane is dead (status 0, Fri Oct 30 09:00:40 2026)
workers/flaky-ci       claude     ◆ Allow Bash(rm -rf target)?
```

<!-- Q: replace with a real capture from a run. -->

That last line is the whole case for this setup. An agent on another machine is waiting for permission. You can see
it from the board without attaching, and so can the orchestrator, which reads the same output. The event stream is
for anything that has to react, like a notifier, a dashboard or a supervisor agent. tmux's control mode is the oldest
and least friendly. zellij's `subscribe` and cmux's `events` are JSON, and graith's events carry agent status, not
just screen text.

## The worktree is the workspace

Layouts get more useful once you stop starting them by hand. With worktrunk, creating a worktree can start its
workspace, and removing the worktree can tear it down. The layout is picked from the branch name:

```toml
# .config/wt.toml
[post-start]
workspace = """
case {{ branch }} in
  ui/*)  layout=frontend ;;
  ops/*) layout=sre ;;
  *)     layout=backend ;;
esac
layouts up "$layout" --root {{ worktree_path }} --session {{ branch | sanitize }}
"""

[pre-remove]
workspace = "tmux kill-session -t {{ branch | sanitize }} 2>/dev/null || true"
```

`wt switch --create ui/checkout` now makes the worktree and a frontend workspace with the agent, the dev server and
the preview already running. When you open the session, the work has started. worktrunk shell-escapes the template
variables itself, so they don't need quotes, and `post-start` runs in the background, so the switch doesn't wait for
the layout. A repo that wants something more specific puts its own `.layouts/frontend.yaml` in the tree, and the
lookup path picks it up without touching the hook. For zellij, cmux or graith, swap the teardown for
`zellij kill-session`, `cmux server stop --session` or `gr stop`.

## Side by side

| | tmux + plugins | zellij | cmux TUI | graith |
|---|---|---|---|---|
| Outlives the terminal | ● server; resurrect after reboot | ● server; resurrection | ● headless server | ● daemon, survives its own upgrade |
| Programmatic | ● CLI, control mode | ◐ `zellij action`, `run` | ● socket, `--json` everywhere | ● `gr`, `--json` |
| Layout | ● by script | ● declarative KDL | ● by calls; `layout apply` coming | ○ by design; scenarios |
| Agent comms | ○ | ○ | ◐ through the socket | ● messages, topics, parent/child |
| Agent status | ◐ hooks you write | ◐ hooks you write | ● hooks shimmed in | ● self-reported and from hooks |
| Read-only observers | ● `attach -r` | ● `watch`, web tokens | ○ shared attach only | ● `attach --read-only` |
| Remote | ● wherever SSH goes | ◐ SSH, web client | ◐ `remote ssh`, cloud | ◐ paired daemons over Tailscale |

## Where I landed

<!-- Q: what you actually use day to day. A guess at the shape:
graith for swarms, cmux for frontend worktrees, tmux over SSH for anything remote, and the layout file as the thing
that doesn't change between them. -->

No tool does all of it yet. tmux is everywhere and knows nothing about agents. zellij has the best layout format and
the easiest way to let someone watch. cmux has the best API and the only browser pane. graith is the only one where
agents really work together. What I want from all of them is three things that don't exist yet: a shared way for an
agent to say "I need you" that every multiplexer reads, layouts that move between tools without a script like mine,
and search across conversations no matter which tool started them.

The shape they're converging on is clear, though. A daemon owns the work, and any number of front ends attach to it:
a TUI, a GUI, a browser tab, another agent. tmux had that shape first. The new tools add an API on top, so the
next client to attach can be another agent.
