"""Record a headless Claude Code run answering a question with the graphctx commands."""
import argparse
import json
import os
import shlex
import subprocess
import tempfile
from datetime import date
from pathlib import Path

from context import Graph
from graphctx import run_tool

HERE = Path(__file__).parent
TRACES = HERE.parent.parent / "src" / "data" / "graph-context" / "traces"
PROMPT = (
    "Answer this question about the shop codebase: {question}\n\n"
    "Use only these two shell commands, run from the current directory, and nothing else:\n"
    "  uv run graphctx search <query words>\n"
    "  uv run graphctx expand <node id>\n"
    "Start with search. The output lists nodes opened in full or as summaries, and unopened neighbours; expand "
    "opens one of them by id. Open only what you need. Finish with a short answer that names the files and "
    "symbols it rests on."
)


def parse_command(command: str) -> tuple[str, str] | None:
    try:
        parts = shlex.split(command)
    except ValueError:
        return None
    if parts[:3] != ["uv", "run", "graphctx"] or len(parts) < 5 or parts[3] not in ("search", "expand"):
        return None
    return parts[3], " ".join(parts[4:])


def read_stream(lines: list[str]) -> dict:
    """Model id, final result, and each tool call with the text written before it."""
    out = {"model": "", "answer": "", "calls": [], "error": False}
    pending = ""
    for raw in lines:
        if not raw.strip():
            continue
        event = json.loads(raw)
        if event["type"] == "system" and event.get("subtype") == "init":
            out["model"] = event.get("model", "")
        elif event["type"] == "assistant":
            for block in event["message"]["content"]:
                if block["type"] == "text":
                    pending += block["text"]
                elif block["type"] == "tool_use":
                    out["calls"].append({"name": block["name"], "input": block["input"], "note": pending.strip()})
                    pending = ""
        elif event["type"] == "result":
            out["answer"] = event.get("result", "")
            out["error"] = bool(event.get("is_error"))
    return out


def build_trace(slug: str, question: str, stream: dict, lines: list[dict]) -> tuple[dict, int]:
    """Pair graphctx tool calls with trace lines in order; return the trace and the unmatched call count."""
    steps, skipped, cursor, total = [], 0, 0, 0
    for call in stream["calls"]:
        parsed = parse_command(call["input"].get("command", "")) if call["name"] == "Bash" else None
        key = "query" if parsed and parsed[0] == "search" else "node"
        found = next((i for i in range(cursor, len(lines)) if parsed and lines[i]["tool"] == parsed[0]
                      and lines[i]["input"].get(key) == parsed[1]), None)
        if found is None:
            skipped += 1
            continue
        line, cursor = lines[found], found + 1
        total += line["tokens"]
        steps.append({"tool": line["tool"], "input": line["input"], "note": call["note"],
                      "nodes": line["nodes"], "context_tokens": total})
    trace = {
        "id": slug, "question": question, "model": stream["model"], "recorded": date.today().isoformat(),
        "answer": stream["answer"], "steps": steps,
        "totals": {"tool_calls": len(steps), "context_tokens": total},
    }
    return trace, skipped


def dry_run(slug: str, question: str) -> dict:
    graph, steps, total, opened = Graph.load(), [], 0, set()
    for i in range(3):
        if i == 0:
            tool, arg = "search", question
        else:
            tool = "expand"
            arg = next(n["id"] for n in steps[-1]["nodes"] if n["detail"] == "stub" and n["id"] not in opened)
            opened.add(arg)
        _, nodes, count = run_tool(graph, tool, arg)
        total += count
        steps.append({"tool": tool, "input": {"query" if tool == "search" else "node": arg}, "note": "",
                      "nodes": nodes, "context_tokens": total})
    return {"id": slug, "question": question, "model": "dry-run", "recorded": date.today().isoformat(),
            "answer": "dry run", "steps": steps, "totals": {"tool_calls": 3, "context_tokens": total}}


def live_run(slug: str, question: str, model: str | None) -> tuple[dict, int]:
    with tempfile.TemporaryDirectory() as tmp:
        trace_file = Path(tmp) / "trace.jsonl"
        cmd = ["claude", "-p", PROMPT.format(question=question), "--output-format", "stream-json", "--verbose",
               "--tools", "Bash", "--allowedTools", "Bash(uv run graphctx:*)",
               "--strict-mcp-config", "--setting-sources", "project", "--max-turns", "16"]
        if model:
            cmd += ["--model", model]
        proc = subprocess.run(cmd, cwd=HERE, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              env={**os.environ, "GRAPHCTX_TRACE": str(trace_file)})
        if proc.returncode != 0:
            raise SystemExit(f"claude exited {proc.returncode}\n{proc.stderr}\n{proc.stdout[-2000:]}")
        stream = read_stream(proc.stdout.splitlines())
        if stream["error"]:
            raise SystemExit(f"claude reported an error: {stream['answer']}")
        lines = [json.loads(l) for l in trace_file.read_text().splitlines()] if trace_file.exists() else []
    return build_trace(slug, question, stream, lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slug")
    parser.add_argument("question", nargs="?", help="default: the question in questions.json for this slug")
    parser.add_argument("--model", help="passed to claude --model; default is Claude Code's")
    parser.add_argument("--dry-run", action="store_true", help="scripted policy, no claude invocation")
    parser.add_argument("--out", type=Path, help="output directory; required with --dry-run")
    args = parser.parse_args()

    question = args.question or next(q["question"] for q in json.loads((HERE / "questions.json").read_text())
                                     if q["id"] == args.slug)
    if args.dry_run:
        if not args.out:
            parser.error("--dry-run needs --out")
        if TRACES.parent.parent.resolve() in (args.out.resolve(), *args.out.resolve().parents):
            parser.error("dry-run traces must not be written under src/data")
    out = args.out or TRACES
    out.mkdir(parents=True, exist_ok=True)

    skipped = 0
    if args.dry_run:
        trace = dry_run(args.slug, question)
    else:
        trace, skipped = live_run(args.slug, question, args.model)
    path = out / f"{args.slug}.json"
    path.write_text(json.dumps(trace, indent=1) + "\n")
    print(f"{path}: {trace['totals']} model={trace['model']} unmatched_calls={skipped}")


if __name__ == "__main__":
    main()
