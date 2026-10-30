"""Command line access to search and expand, with optional trace logging."""
import argparse
import json
import os
import sys

from context import SEARCH_BUDGET, Graph, build_context, expand, render, tokens


def run_tool(graph: Graph, tool: str, arg: str) -> tuple[str, list[dict], int]:
    """Rendered output, the nodes it contained, and its token count."""
    if tool == "search":
        picked, stubs = build_context(arg, graph, SEARCH_BUDGET)
        nodes = [{"id": n, "detail": v.detail, "score": round(v.score, 3), "via": v.via.label if v.via else None}
                 for n, v in picked.items()]
    elif arg in graph.nodes:
        picked, stubs = expand(graph, arg)
        nodes = [{"id": n, "detail": "full", "score": 1.0, "via": None} for n in picked]
    else:
        message = f"No node with id {arg!r}. Use ids returned by search."
        return message, [], tokens(message)
    nodes += [{"id": n, "detail": "stub", "score": None, "via": via.label if via else None} for n, via in stubs]
    output = render(picked, stubs)
    return output, nodes, tokens(output)


def main() -> None:
    parser = argparse.ArgumentParser(prog="graphctx")
    parser.add_argument("tool", choices=["search", "expand"])
    parser.add_argument("arg", nargs="+", help="query words for search, a node id for expand")
    args = parser.parse_args()
    arg = " ".join(args.arg)
    output, nodes, count = run_tool(Graph.load(), args.tool, arg)
    print(output)
    path = os.environ.get("GRAPHCTX_TRACE")
    if path and nodes:
        line = {"tool": args.tool, "input": {"query" if args.tool == "search" else "node": arg},
                "nodes": nodes, "tokens": count}
        with open(path, "a") as f:
            f.write(json.dumps(line) + "\n")
    sys.exit(0 if nodes else 1)
