"""BM25 seed search and budgeted graph expansion over graph.json."""
import heapq
import itertools
import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

GRAPH_PATH = Path(__file__).parent.parent.parent / "src" / "data" / "graph-context" / "graph.json"

DECAY = 0.8
FULL_AT = 0.5
SEEDS = 5
SEARCH_BUDGET = 1000
MAX_STUBS = 20
BM25_K1 = 1.2
BM25_B = 0.75
STOPWORDS = frozenset(
    "a an and are as at be by do does for from how if in is it of on or that the this to was what when who why with".split()
)
REVERSE = {
    "calls": "called_by", "imports": "imported_by", "defines": "defined_in",
    "mentions": "mentioned_by", "links": "linked_from",
}


def tokens(text: str) -> int:
    return math.ceil(len(text) / 4)


def tokenize(text: str) -> list[str]:
    spaced = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text).lower()
    return [t for t in re.split(r"[^a-z0-9]+", spaced) if len(t) > 1 and t not in STOPWORDS]


@dataclass
class Edge:
    target: str
    type: str
    weight: float
    label: str


@dataclass
class View:
    node: str
    detail: str
    text: str
    tokens: int
    score: float = 0.0
    via: Edge | None = None


@dataclass
class Hit:
    node: str
    score: float


class Graph:
    def __init__(self, data: dict):
        self.nodes = {n["id"]: n for n in data["nodes"]}
        self.adjacent: dict[str, list[Edge]] = {n: [] for n in self.nodes}
        for e in data["edges"]:
            self.adjacent[e["source"]].append(Edge(e["target"], e["type"], e["weight"], e["type"]))
            self.adjacent[e["target"]].append(Edge(e["source"], e["type"], e["weight"], REVERSE[e["type"]]))
        self.docs = {i: Counter(tokenize(f"{i} {n['signature']} {n['summary']} {n['text']}"))
                     for i, n in self.nodes.items()}
        self.lengths = {i: sum(c.values()) for i, c in self.docs.items()}
        self.avg_length = sum(self.lengths.values()) / len(self.lengths)
        df = Counter(t for c in self.docs.values() for t in c)
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    @classmethod
    def load(cls, path: Path = GRAPH_PATH) -> "Graph":
        return cls(json.loads(path.read_text()))

    def edges(self, node: str) -> list[Edge]:
        return self.adjacent[node]

    def search(self, query: str, k: int = SEEDS) -> list[Hit]:
        """Top-k BM25 hits, scores scaled so the best is 1.0."""
        terms = set(tokenize(query)) & self.idf.keys()
        scores = {}
        for node, counts in self.docs.items():
            norm = BM25_K1 * (1 - BM25_B + BM25_B * self.lengths[node] / self.avg_length)
            score = sum(self.idf[t] * counts[t] * (BM25_K1 + 1) / (counts[t] + norm)
                        for t in terms if counts[t])
            if score > 0:
                scores[node] = score
        ranked = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[:k]
        best = ranked[0][1] if ranked else 1.0
        return [Hit(node, score / best) for node, score in ranked]

    def render_within(self, node: str, detail: str, room: int) -> View | None:
        info = self.nodes[node]
        levels = {
            "full": info["text"],
            "summary": "\n".join(filter(None, [info["signature"], info["summary"]])),
        }
        for level in list(levels)[list(levels).index(detail):]:
            if tokens(levels[level]) <= room:
                return View(node, level, levels[level], tokens(levels[level]))
        return None


def detail_for(score: float) -> str:
    return "full" if score >= FULL_AT else "summary"


def build_context(query, graph, budget, max_stubs=MAX_STUBS):
    tie = itertools.count()
    frontier = [(-hit.score, next(tie), hit.node, None) for hit in graph.search(query, k=SEEDS)]
    heapq.heapify(frontier)
    picked, stubs, spent = {}, {}, 0
    while frontier:
        neg_score, _, node, via = heapq.heappop(frontier)
        score = -neg_score
        if node in picked:
            continue
        view = graph.render_within(node, detail_for(score), budget - spent)
        if view is None:
            stubs.setdefault(node, via)
            continue
        view.score, view.via = score, via
        picked[node] = view
        spent += view.tokens
        edges = graph.edges(node)
        for edge in edges:
            score_next = score * edge.weight * DECAY / len(edges)
            heapq.heappush(frontier, (-score_next, next(tie), edge.target, edge))
    return picked, [(n, v) for n, v in stubs.items() if n not in picked][:max_stubs]


def expand(graph: Graph, node: str, max_stubs: int = MAX_STUBS):
    """Full text of one node, plus a stub for each neighbour, most specific first."""
    view = graph.render_within(node, "full", math.inf)
    view.score = 1.0
    edges = sorted(graph.edges(node), key=lambda e: (-e.weight, len(graph.edges(e.target)), e.target))
    seen, stubs = set(), []
    for edge in edges:
        if edge.target not in seen:
            seen.add(edge.target)
            stubs.append((edge.target, edge))
    return {node: view}, stubs[:max_stubs]


def render(picked: dict[str, View], stubs) -> str:
    """Text handed to the model: opened nodes by score, then the stub list."""
    parts = [f"## {v.node} ({v.detail})\n{v.text}" for v in sorted(picked.values(), key=lambda v: -v.score)]
    if stubs:
        parts.append("Not opened (call expand to read):\n" + "\n".join(
            f"- {n}" + (f" ({via.label})" if via else "") for n, via in stubs))
    return "\n\n".join(parts)


if __name__ == "__main__":
    import sys

    g = Graph.load()
    got, rest = build_context(" ".join(sys.argv[1:]), g, SEARCH_BUDGET)
    for v in got.values():
        print(f"{v.score:.3f} {v.detail:7} {v.tokens:4} {v.node} via {v.via.label if v.via else '-'}")
    print("stubs:", [n for n, _ in rest])
