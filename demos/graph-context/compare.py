"""Compare what four retrieval strategies put in context for each question."""
import json
from pathlib import Path

from context import SEARCH_BUDGET, Graph, build_context, tokens

OUT = Path(__file__).parent.parent.parent / "src" / "data" / "graph-context" / "comparison.json"
K = 5


def chunks_result(graph: Graph, nodes: list[str], answers: list[str]) -> dict:
    return {
        "nodes": nodes,
        "tokens": sum(graph.nodes[n]["tokens"] for n in nodes),
        "found": [a for a in answers if a in nodes],
    }


def whole_files(graph: Graph, seeds: list[str], answers: list[str]) -> dict:
    files = {graph.nodes[n]["file"] for n in seeds}
    text = {n["file"]: n["text"] for n in graph.nodes.values() if n["kind"] in ("module", "doc")}
    return {
        "files": sorted(files),
        "tokens": sum(tokens(text[f]) for f in files),
        "found": [a for a in answers if graph.nodes[a]["file"] in files],
    }


def graph_result(graph: Graph, query: str, answers: list[str]) -> dict:
    picked, stubs = build_context(query, graph, SEARCH_BUDGET)
    return {
        "nodes": [{"id": n, "detail": v.detail} for n, v in picked.items()],
        "stubs": [n for n, _ in stubs],
        "tokens": sum(v.tokens for v in picked.values()),
        "found": [a for a in answers if a in picked],
        "found_full": [a for a in answers if a in picked and picked[a].detail == "full"],
        "found_as_stub": [a for a in answers if a in dict(stubs)],
    }


def run() -> dict:
    graph = Graph.load()
    questions = json.loads((Path(__file__).parent / "questions.json").read_text())
    try:
        from rag_baseline import top_k
        embedded = top_k(graph, [q["question"] for q in questions], K)
    except Exception as exc:
        print(f"embedding column skipped: {exc!r}")
        embedded = [None] * len(questions)
    result = []
    for q, emb in zip(questions, embedded):
        answers = q["answer_nodes"]
        bm25 = [h.node for h in graph.search(q["question"], k=K)]
        result.append({
            "id": q["id"], "question": q["question"], "answer_nodes": answers,
            "embedding_top_k": chunks_result(graph, emb, answers) if emb else None,
            "bm25_top_k": chunks_result(graph, bm25, answers),
            "graph": graph_result(graph, q["question"], answers),
            "whole_files": whole_files(graph, bm25, answers),
        })
    return {"k": K, "budget": SEARCH_BUDGET, "embedding_model": "BAAI/bge-small-en-v1.5", "questions": result}


if __name__ == "__main__":
    data = run()
    OUT.write_text(json.dumps(data, indent=1) + "\n")
    print(f"{'question':18}{'method':16}{'tokens':>7}  found")
    for q in data["questions"]:
        n = len(q["answer_nodes"])
        for name in ("embedding_top_k", "bm25_top_k", "graph", "whole_files"):
            r = q[name]
            if r is None:
                print(f"{q['id']:18}{name:16}{'-':>7}  skipped")
                continue
            extra = f", {len(r['found_full'])} in full" if name == "graph" else ""
            print(f"{q['id']:18}{name:16}{r['tokens']:>7}  {len(r['found'])}/{n}{extra}")
