#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6"]
# ///
"""Render a layout file into tmux, zellij, cmux or graith, and spawn agents into a running session."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml

BANK = Path(__file__).resolve().parent / "bank"
MUXES = ("tmux", "zellij", "cmux", "graith")
q = shlex.quote


def search_path() -> list[Path]:
    xdg = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return [Path.cwd() / ".layouts", xdg / "agent-layouts", BANK]


def find_layout(name: str) -> Path:
    if Path(name).suffix in (".yaml", ".yml") and Path(name).exists():
        return Path(name)
    for d in search_path():
        for ext in (".yaml", ".yml"):
            if (p := d / f"{name}{ext}").exists():
                return p
    sys.exit(f"no layout {name!r} in {', '.join(map(str, search_path()))}")


@dataclass
class Pane:
    name: str
    run: str | None = None
    agent: str | None = None
    prompt: str | None = None
    url: str | None = None
    cwd: str | None = None
    target: str | None = None
    size: str | None = None
    focus: bool = False


@dataclass
class Split:
    split: str  # "columns": children side by side; "rows": stacked
    children: list[Pane | Split]
    size: str | None = None


@dataclass
class Tab:
    name: str
    root: Pane | Split


@dataclass
class Layout:
    name: str
    root: Path
    session: str
    targets: dict[str, dict[str, str]]
    tabs: list[Tab]


def substitute(text: str, vars: dict[str, str]) -> str:
    # Repeated so vars can refer to vars. Unknown {names} and shell ${VARS} are left alone.
    for _ in range(5):
        new = re.sub(r"(?<!\$)\{(\w+)\}", lambda m: vars.get(m[1], m[0]), text)
        if new == text:
            break
        text = new
    return text


def parse_node(raw: dict, vars: dict[str, str], count: list[int]) -> Pane | Split:
    if "panes" in raw:
        children = [parse_node(c, vars, count) for c in raw["panes"]]
        if len(children) == 1:
            children[0].size = children[0].size or raw.get("size")
            return children[0]
        return Split(raw.get("split", "rows"), children, raw.get("size"))
    count[0] += 1
    s = {k: substitute(v, vars) if isinstance(v, str) else v for k, v in raw.items()}
    if not any(k in s for k in ("run", "agent", "url")):
        s["run"] = os.environ.get("SHELL", "sh")
    return Pane(name=s.get("name", f"pane-{count[0]}"), run=s.get("run"), agent=s.get("agent"),
                prompt=s.get("prompt"), url=s.get("url"), cwd=s.get("cwd"), target=s.get("target"),
                size=s.get("size"), focus=bool(s.get("focus")))


def session_name(name: str) -> str:
    # tmux turns . and : into _ in session names; do it first so every later -t matches.
    return re.sub(r"[.:]", "_", name)


def load(name: str, root: Path, session: str | None, overrides: dict[str, str]) -> Layout:
    raw = yaml.safe_load(find_layout(name).read_text())
    root = root.resolve()
    session = session_name(session or f"{root.name}-{raw['name']}")
    vars = {"repo": root.name, "root": str(root), "session": session, "layout": raw["name"]}
    vars |= {k: str(v) for k, v in (raw.get("vars") or {}).items()} | overrides
    targets = {k: {kk: substitute(str(vv), vars) for kk, vv in v.items()}
               for k, v in (raw.get("targets") or {}).items()}
    tabs = [Tab(t["name"], parse_node(t, vars, [0])) for t in raw["tabs"]]
    return Layout(raw["name"], root, session, targets, tabs)


def leaves(node: Pane | Split):
    if isinstance(node, Pane):
        yield node
    else:
        for c in node.children:
            yield from leaves(c)


def new_pane_shares(children: list[Pane | Split]) -> list[float]:
    """For child k >= 1, the fraction of child k-1's pane that the split creating child k hands over."""
    given = [float(str(c.size)[:-1]) / 100 if str(c.size).endswith("%") else None for c in children]
    free = 1 - sum(g for g in given if g is not None)
    unsized = sum(g is None for g in given) or 1
    shares = [g if g is not None else max(free / unsized, 1 / len(children)) for g in given]
    return [max(0.05, min(0.95, sum(shares[k:]) / sum(shares[k - 1:]))) for k in range(1, len(shares))]


def pane_command(p: Pane) -> str:
    if p.agent:
        return f"{p.agent} {q(p.prompt)}" if p.prompt else p.agent
    if p.url:
        probe = f"curl -s -o /dev/null -w '%{{http_code}}' {q(p.url)}"
        return f'while :; do echo "$(date +%T)  $({probe})  {p.url}"; sleep 5; done'
    return p.run or "sh"


def wrap(cmd: str, target: dict[str, str] | None, session: str, pane: str) -> str:
    """Remote work runs inside a tmux on the far side, so it outlives the local pane that shows it."""
    if not target:
        return cmd
    inner = f"cd {target.get('cwd', '.')} && {cmd}"
    persist = f"tmux new -As {q(f'{session}-{pane}')} {q(inner)}"
    if "ssh" in target:
        return f"ssh -t {target['ssh']} {q(persist)}"
    if "devcontainer" in target:
        return f"devcontainer exec --workspace-folder {q(target['devcontainer'])} {persist}"
    if "exec" in target:  # any "run this there" prefix, e.g. `sprite exec --tty --`
        return f"{target['exec']} sh -c {q(persist)}"
    sys.exit(f"a target needs ssh, devcontainer or exec: {target}")


def resolved(lay: Layout, p: Pane) -> tuple[str, str]:
    cwd = str((lay.root / p.cwd).resolve()) if p.cwd else str(lay.root)
    if p.target and p.target not in lay.targets:
        sys.exit(f"pane {p.name}: unknown target {p.target!r}")
    return wrap(pane_command(p), lay.targets.get(p.target or ""), lay.session, p.name), cwd


class Script:
    def __init__(self) -> None:
        self.lines = ["#!/bin/sh", "set -e"]
        self.n = 0

    def var(self) -> str:
        self.n += 1
        return f"P{self.n}"

    def add(self, line: str) -> None:
        self.lines.append(line)

    def __iadd__(self, line: str) -> Script:
        self.add(line)
        return self

    def text(self) -> str:
        return "\n".join(self.lines) + "\n"


# tmux: one window per tab, split-window per pane, pane names in the border

def render_tmux(lay: Layout) -> str:
    s, sh = Script(), q(lay.session)
    s += f"tmux has-session -t ={sh} 2>/dev/null && {{ echo 'session {lay.session} exists'; exit 0; }}"
    focus = None
    for i, tab in enumerate(lay.tabs):
        win, v = q(f"{lay.session}:{tab.name}"), s.var()
        first = next(leaves(tab.root))
        cmd, cwd = resolved(lay, first)
        # Start on a shell, set remain-on-exit, then respawn: a command that fails at once stays readable.
        if i == 0:
            s += f"{v}=$(tmux new-session -d -P -F '#{{pane_id}}' -s {sh} -n {q(tab.name)} -c {q(cwd)} -x 220 -y 60)"
        else:
            s += f"{v}=$(tmux new-window -d -P -F '#{{pane_id}}' -t {sh}: -n {q(tab.name)} -c {q(cwd)})"
        s += f"tmux set -w -t {win} remain-on-exit on"
        s += f"tmux set -w -t {win} pane-border-status top"
        s += f"tmux set -w -t {win} pane-border-format ' #{{@name}} '"
        s += f"tmux respawn-pane -k -t \"${v}\" {q(cmd)}"
        s += f"tmux set -p -t \"${v}\" @name {q(first.name)}"
        focus = tmux_fill(s, lay, tab.root, v, win) or focus
        if first.focus:
            focus = (win, v)
    if focus:
        s += f"tmux select-window -t {focus[0]}"
        s += f"tmux select-pane -t \"${focus[1]}\""
    return s.text()


def tmux_fill(s: Script, lay: Layout, node: Pane | Split, anchor: str, win: str):
    """`anchor` runs the node's first leaf; split it into the rest. Returns (win, var) of a focused pane."""
    if isinstance(node, Pane):
        return None
    focus, flag, vars = None, "-h" if node.split == "columns" else "-v", [anchor]
    for child, share in zip(node.children[1:], new_pane_shares(node.children)):
        v, first = s.var(), next(leaves(child))
        cmd, cwd = resolved(lay, first)
        s += (f"{v}=$(tmux split-window {flag} -d -P -F '#{{pane_id}}' -t \"${vars[-1]}\" "
              f"-l {round(share * 100)}% -c {q(cwd)} {q(cmd)})")
        s += f"tmux set -p -t \"${v}\" @name {q(first.name)}"
        if first.focus:
            focus = (win, v)
        vars.append(v)
    for child, v in zip(node.children, vars):
        focus = tmux_fill(s, lay, child, v, win) or focus
    return focus


# zellij: a KDL layout, started with `zellij --layout f attach --create-background`

def render_zellij(lay: Layout) -> str:
    def kdl(v) -> str:
        return str(v) if isinstance(v, int) else json.dumps(v, ensure_ascii=False)

    def node(n: Pane | Split, depth: int) -> list[str]:
        pad, size = "    " * depth, f" size={kdl(n.size)}" if n.size else ""
        if isinstance(n, Split):
            d = "vertical" if n.split == "columns" else "horizontal"
            return ([f"{pad}pane split_direction={kdl(d)}{size} {{"]
                    + [ln for c in n.children for ln in node(c, depth + 1)] + [f"{pad}}}"])
        cmd, cwd = resolved(lay, n)
        focus = " focus=true" if n.focus else ""
        return [f"{pad}pane name={kdl(n.name)}{size}{focus} command=\"sh\" close_on_exit=false {{",
                f"{pad}    args \"-c\" {kdl(cmd)}",
                f"{pad}    cwd {kdl(cwd)}",
                f"{pad}}}"]

    out = ["layout {",
           "    default_tab_template {",
           "        pane size=1 borderless=true { plugin location=\"zellij:tab-bar\"; }",
           "        children",
           "        pane size=2 borderless=true { plugin location=\"zellij:status-bar\"; }",
           "    }"]
    focus_tab = next((t.name for t in lay.tabs if any(p.focus for p in leaves(t.root))), None)
    for t in lay.tabs:
        out.append(f"    tab name={kdl(t.name)}{' focus=true' if t.name == focus_tab else ''} {{")
        out += node(t.root, 2)
        out.append("    }")
    return "\n".join(out + ["}"]) + "\n"


# cmux TUI: workspace per session, screen per tab; every create returns the new ids as JSON

def render_cmux(lay: Layout) -> str:
    s, c = Script(), f"cmux --session {q(lay.session)} --json"
    s += f"cmux server ensure --session {q(lay.session)} >/dev/null"
    s += "id() { python3 -c 'import json,sys; print(json.load(sys.stdin)[\"value\"][sys.argv[1]])' \"$1\"; }"

    def fill(node: Pane | Split, pane: str, shell_tab: str) -> None:
        # `pane` holds one shell tab; add the real content as a new tab, then close the shell.
        if isinstance(node, Pane):
            cmd, cwd = resolved(lay, node)
            if node.url:
                s.add(f"{c} tab create browser --url {q(node.url)} --pane \"${pane}\" >/dev/null")
            else:
                s.add(f"{c} pane \"${pane}\" run --on-exit keep shell {q(f'cd {q(cwd)} && {cmd}')} >/dev/null")
            s.add(f"{c} tab \"${shell_tab}\" close >/dev/null")
            s.add(f"{c} pane \"${pane}\" rename --name {q(node.name)} >/dev/null")
            return
        flag, slots = "--right" if node.split == "columns" else "--down", [(pane, shell_tab)]
        for share in new_pane_shares(node.children):
            pv, tv = s.var(), s.var()
            s.add(f"R=$({c} pane \"${slots[-1][0]}\" split {flag} --ratio {share:.2f})")
            s.add(f"{pv}=$(printf '%s\\n' \"$R\" | id pane_id); {tv}=$(printf '%s\\n' \"$R\" | id tab_id)")
            slots.append((pv, tv))
        for child, (pv, tv) in zip(node.children, slots):
            fill(child, pv, tv)

    for i, tab in enumerate(lay.tabs):
        pv, tv, sv = s.var(), s.var(), s.var()
        if i == 0:
            s += f"R=$({c} workspace create --name {q(lay.session)})"
            s += "W=$(printf '%s\\n' \"$R\" | id workspace_id)"
        else:
            s += f"R=$({c} workspace \"$W\" screen create)"
        s += f"{pv}=$(printf '%s\\n' \"$R\" | id pane_id); {tv}=$(printf '%s\\n' \"$R\" | id tab_id); {sv}=$(printf '%s\\n' \"$R\" | id screen_id)"
        s += f"{c} screen \"${sv}\" rename --name {q(tab.name)} >/dev/null"
        fill(tab.root, pv, tv)
    return s.text()


# graith: one agent per session, no panes. Agent panes become background sessions; the rest is dropped.

def render_graith(lay: Layout) -> str:
    s = Script()
    for tab in lay.tabs:
        for p in leaves(tab.root):
            if not p.agent:
                s += f"# {tab.name}/{p.name} is not an agent; graith has no place for it"
                continue
            agent, *flags = shlex.split(p.agent)
            if flags:
                s += f"# {p.name}: put '{' '.join(flags)}' in [agents.{agent}] in graith's config"
            if p.target:
                s += f"# {p.name}: target {p.target!r} ignored; pair that host with `gr remote pair` instead"
            cmd = f"gr new {q(f'{lay.session}-{p.name}')} --agent {q(agent)} --background -C {q(str(lay.root))}"
            s += cmd + (f" -p {q(p.prompt)}" if p.prompt else "")
    return s.text()


RENDER = {"tmux": render_tmux, "zellij": render_zellij, "cmux": render_cmux, "graith": render_graith}
WATCH = {
    "tmux": "tmux attach -r -t {s}",
    "zellij": "zellij watch {s}",
    "cmux": "cmux attach --session {s}",
    "graith": "gr attach --read-only {s}-<pane>",
}


def up(lay: Layout, mux: str) -> None:
    text = RENDER[mux](lay)
    if mux == "zellij":
        path = Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp")) / f"layout-{lay.session}.kdl"
        path.write_text(text)
        subprocess.run(["zellij", "--layout", str(path), "attach", "--create-background", lay.session], check=True)
    else:
        subprocess.run(["sh", "-c", text], check=True)
    print(f"{lay.session} is up in {mux}. Watch it with: {WATCH[mux].format(s=lay.session)}")


def run_json(args: list[str]):
    return json.loads(subprocess.run(args, check=True, capture_output=True, text=True).stdout)


def spawn(mux: str, session: str, name: str, cmd: str, target: dict[str, str] | None, root: Path) -> None:
    full = wrap(cmd, target, session, name)
    if mux == "tmux":
        win = f"{session}:workers"
        pid = subprocess.run(["tmux", "split-window", "-d", "-P", "-F", "#{pane_id}", "-t", win, "-c", str(root), full],
                             check=True, capture_output=True, text=True).stdout.strip()
        subprocess.run(["tmux", "set", "-p", "-t", pid, "@name", name], check=True)
        subprocess.run(["tmux", "select-layout", "-t", win, "tiled"], check=True)
    elif mux == "zellij":
        z = ["zellij", "--session", session]
        subprocess.run(z + ["action", "go-to-tab-name", "workers"], check=True)
        subprocess.run(z + ["run", "-n", name, "--cwd", str(root), "--", "sh", "-c", full], check=True)
    elif mux == "cmux":
        c = ["cmux", "--session", session, "--json"]
        screen = next(x["id"] for x in run_json(c + ["screen", "list"]) if x.get("name") == "workers")
        pane = [p["id"] for p in run_json(c + ["pane", "list"]) if p["screen_id"] == screen][-1]
        new = run_json(c + ["pane", pane, "split", "--right"])["value"]
        subprocess.run(c + ["pane", new["pane_id"], "run", "--on-exit", "keep", "shell", f"cd {q(str(root))} && {full}"],
                       check=True, capture_output=True)
        subprocess.run(c + ["tab", new["tab_id"], "close"], check=True, capture_output=True)
        subprocess.run(c + ["pane", new["pane_id"], "rename", "--name", name], check=True, capture_output=True)
    else:
        agent, *rest = shlex.split(cmd)
        args = ["gr", "new", f"{session}-{name}", "--agent", agent, "--background", "-C", str(root)]
        subprocess.run(args + (["-p", rest[-1]] if rest else []), check=True)
    print(f"spawned {name} in {session} ({mux})")


def ps(mux: str, session: str) -> None:
    if mux == "tmux":
        fmt = "#{window_name}/#{@name}\t#{?pane_dead,exit #{pane_dead_status},#{pane_current_command}}\t#{pane_id}"
        out = subprocess.run(["tmux", "list-panes", "-s", "-t", session, "-F", fmt],
                             check=True, capture_output=True, text=True).stdout
        for row in out.splitlines():
            where, state, pid = row.split("\t")
            screen = subprocess.run(["tmux", "capture-pane", "-p", "-t", pid], capture_output=True, text=True).stdout
            last = next((ln.strip() for ln in reversed(screen.splitlines()) if ln.strip()), "")
            print(f"{where:<22} {state:<10} {last[:90]}")
    elif mux == "zellij":
        subprocess.run(["zellij", "--session", session, "action", "list-panes"], check=True)
    elif mux == "cmux":
        subprocess.run(["cmux", "--session", session, "agent", "list"], check=True)
    else:
        subprocess.run(["gr", "list"], check=True)


def detect_mux() -> str:
    for env, mux in (("TMUX", "tmux"), ("ZELLIJ_SESSION_NAME", "zellij"), ("CMUX_TUI_SOCKET", "cmux"),
                     ("GRAITH_SESSION_ID", "graith")):
        if os.environ.get(env):
            return mux
    return os.environ.get("LAYOUTS_MUX", "tmux")


def main() -> None:
    ap = argparse.ArgumentParser(prog="layouts")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="layouts in .layouts/, ~/.config/agent-layouts/ and the bank, first match wins")
    for name, help in (("show", "print what each pane will run"), ("render", "print the native config"),
                       ("up", "start the session detached")):
        p = sub.add_parser(name, help=help)
        p.add_argument("layout")
        p.add_argument("--mux", choices=MUXES)
        p.add_argument("--session")
        p.add_argument("--root", type=Path, default=Path.cwd())
        p.add_argument("--set", action="append", default=[], metavar="KEY=VALUE")
    p = sub.add_parser("new", help="write .layouts/NAME.yaml, blank or copied from a template")
    p.add_argument("name")
    p.add_argument("--from", dest="template")
    p = sub.add_parser("spawn", help="start a command in the session's workers tab")
    p.add_argument("--mux", choices=MUXES)
    p.add_argument("--session", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--target", help="a target defined in --layout")
    p.add_argument("--layout", default="agents", help="the layout that defines --target")
    p.add_argument("--root", type=Path, default=Path.cwd())
    p.add_argument("command", nargs=argparse.REMAINDER)
    p = sub.add_parser("ps", help="one line per pane: where, what's running, last line on screen")
    p.add_argument("--mux", choices=MUXES)
    p.add_argument("--session", required=True)
    a = ap.parse_args()
    mux = getattr(a, "mux", None) or detect_mux()

    if a.cmd == "list":
        seen = set()
        for d in search_path():
            for f in sorted(d.glob("*.y*ml")) if d.is_dir() else []:
                if f.stem not in seen:
                    seen.add(f.stem)
                    desc = (yaml.safe_load(f.read_text()) or {}).get("description", "")
                    print(f"{f.stem:<12} {desc}  ({d})")
    elif a.cmd == "new":
        dest = Path.cwd() / ".layouts" / f"{a.name}.yaml"
        if dest.exists():
            sys.exit(f"{dest} exists")
        dest.parent.mkdir(exist_ok=True)
        if a.template:
            text = re.sub(r"^name: .*$", f"name: {a.name}", find_layout(a.template).read_text(), count=1, flags=re.M)
        else:
            text = (f"name: {a.name}\ndescription:\nvars:\n  agent: claude\ntabs:\n  - name: main\n"
                    f"    split: columns\n    panes:\n      - {{ name: agent, agent: \"{{agent}}\", focus: true }}\n"
                    f"      - {{ name: shell }}\n")
        dest.write_text(text)
        print(dest)
    elif a.cmd in ("show", "render", "up"):
        lay = load(a.layout, a.root, a.session, dict(kv.split("=", 1) for kv in a.set))
        if a.cmd == "show":
            for t in lay.tabs:
                for p in leaves(t.root):
                    print(f"{t.name + '/' + p.name:<20} {resolved(lay, p)[0]}")
        elif a.cmd == "render":
            sys.stdout.write(RENDER[mux](lay))
        else:
            if not shutil.which("gr" if mux == "graith" else mux):
                sys.exit(f"{mux} is not installed")
            up(lay, mux)
    elif a.cmd == "spawn":
        argv = a.command[1:] if a.command[:1] == ["--"] else a.command
        cmd = argv[0] if len(argv) == 1 else shlex.join(argv)
        a.session = session_name(a.session)
        if not cmd:
            sys.exit("nothing to spawn: pass the command after --")
        target = None
        if a.target:
            targets = load(a.layout, a.root, a.session, {}).targets
            if a.target not in targets:
                sys.exit(f"unknown target {a.target!r}; layout {a.layout} defines {', '.join(targets) or 'none'} "
                         f"(pass --layout for another)")
            target = targets[a.target]
        spawn(mux, a.session, a.name, cmd, target, a.root.resolve())
    else:
        ps(mux, session_name(a.session))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        # Most often: the session isn't running, or has no `workers` tab to spawn into.
        sys.exit(f"{shlex.join(map(str, e.cmd))[:200]} failed with exit {e.returncode}")
