# Agent layouts

One YAML layout, rendered into tmux, zellij, cmux (TUI) or graith. Companion to the post on multiplexers for agents.

```sh
ln -s "$PWD/layouts.py" ~/.local/bin/layouts   # needs uv; the script declares its own deps

layouts list                                   # .layouts/, then ~/.config/agent-layouts/, then bank/
layouts show backend                           # what each pane will run
layouts render backend --mux zellij            # the native config, to read or commit
layouts up backend --mux tmux --session api    # start it detached
layouts new web --from frontend                # copy a template into ./.layouts/web.yaml
layouts spawn --session api --name fix-auth --target buildbox -- claude "fix the auth test"
layouts ps --session api                       # one line per pane: where, what runs, last line
```

`--set key=value` overrides a layout's `vars`. `--mux` defaults to the multiplexer you're inside, then `$LAYOUTS_MUX`,
then tmux.

## Format

```yaml
name: backend
description: shown by `layouts list`
vars: { agent: claude, serve: cargo run }    # {name} anywhere below; {repo} {root} {session} are built in
targets:                                     # where a pane runs if it sets `target:`
  buildbox: { ssh: buildbox, cwd: ~/src/{repo} }
  dev: { devcontainer: "{root}" }
  sbx: { exec: "sprite exec --tty --" }      # any command prefix that runs a command elsewhere
tabs:
  - name: code
    split: columns                           # children side by side; `rows` stacks them
    panes:
      - { name: agent, agent: "{agent}", prompt: "...", size: 55%, focus: true }
      - split: rows
        panes:
          - { name: server, run: "{serve}" }
          - { name: preview, url: http://localhost:5173 }   # browser tab in cmux, an HTTP probe elsewhere
```

A pane with a `target` runs inside `tmux new -As <session>-<pane>` on the far side, so the work survives the local
pane closing, and `ssh -t host tmux attach -t <session>-<pane>` reaches it directly. The remote needs tmux.

graith has no panes: `render --mux graith` turns each agent pane into `gr new --background` and drops the rest.

Tested with tmux 3.6, zellij 0.45.1, cmux TUI 0.1.0 and graith 0.73.31 (render only).
