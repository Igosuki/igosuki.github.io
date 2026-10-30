"""Parse the corpus into graph.json: nodes, typed edges and a precomputed 2D layout."""
import ast
import json
import math
import re
from pathlib import Path

import networkx as nx

ROOT = Path(__file__).parent
CORPUS = ROOT / "corpus"
OUT = ROOT.parent.parent / "src" / "data" / "graph-context" / "graph.json"

WEIGHTS = {"calls": 1.0, "imports": 0.5, "defines": 0.6, "mentions": 0.8, "links": 0.8}


def tokens(text: str) -> int:
    return math.ceil(len(text) / 4)


def first_line(doc: str | None) -> str:
    return doc.strip().splitlines()[0] if doc and doc.strip() else ""


def signature(node: ast.AST) -> str:
    if isinstance(node, ast.ClassDef):
        bases = ", ".join(ast.unparse(b) for b in node.bases)
        return f"class {node.name}({bases})" if bases else f"class {node.name}"
    prefix = "async def" if isinstance(node, ast.AsyncFunctionDef) else "def"
    returns = f" -> {ast.unparse(node.returns)}" if node.returns else ""
    return f"{prefix} {node.name}({ast.unparse(node.args)}){returns}"


def segment(lines: list[str], node: ast.AST) -> str:
    start = min([node.lineno] + [d.lineno for d in getattr(node, "decorator_list", [])])
    return "\n".join(lines[start - 1 : node.end_lineno])


class Builder:
    def __init__(self):
        self.nodes: dict[str, dict] = {}
        self.edges: dict[tuple[str, str, str], float] = {}
        self.constants: dict[str, str] = {}

    def add_node(self, id, kind, label, file, sig, summary, text):
        self.nodes[id] = {
            "id": id, "kind": kind, "label": label, "file": file, "signature": sig,
            "summary": summary, "text": text, "tokens": tokens(text),
        }

    def add_edge(self, source, target, type):
        if source != target and target in self.nodes:
            self.edges.setdefault((source, target, type), WEIGHTS[type])

    def read_module(self, path: Path):
        rel = path.relative_to(CORPUS)
        module = ".".join(rel.with_suffix("").parts).removesuffix(".__init__")
        source = path.read_text()
        tree = ast.parse(source)
        lines = source.splitlines()
        self.add_node(module, "module", module.rsplit(".", 1)[-1], str(rel), f"module {module}",
                      first_line(ast.get_docstring(tree)), source)
        for stmt in tree.body:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.read_def(module, module, stmt, str(rel), lines)
            elif isinstance(stmt, ast.Assign):
                for target in stmt.targets:
                    if isinstance(target, ast.Name):
                        self.constants.setdefault(target.id, module)
        return module, tree

    def read_def(self, module, parent, stmt, file, lines):
        id = f"{parent}.{stmt.name}"
        kind = "class" if isinstance(stmt, ast.ClassDef) else "function"
        self.add_node(id, kind, stmt.name, file, signature(stmt),
                      first_line(ast.get_docstring(stmt)), segment(lines, stmt))
        self.add_edge(parent, id, "defines")
        if kind == "class":
            for child in stmt.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    self.read_def(module, id, child, file, lines)

    def environment(self, module, tree) -> dict[str, str]:
        """Names visible in a module that point at other corpus nodes."""
        depth = module.count(".") + 1
        env = {
            node["label"]: node_id for node_id, node in self.nodes.items()
            if node["kind"] in ("function", "class")
            and node_id.startswith(module + ".") and node_id.count(".") == depth
        }
        for stmt in ast.walk(tree):
            if isinstance(stmt, ast.ImportFrom) and (stmt.module or "").split(".")[0] == "shop":
                if stmt.module != "shop":
                    self.add_edge(module, stmt.module, "imports")
                for alias in stmt.names:
                    target = f"{stmt.module}.{alias.name}"
                    if target in self.nodes:
                        env[alias.asname or alias.name] = target
                        if self.nodes[target]["kind"] == "module":
                            self.add_edge(module, target, "imports")
            elif isinstance(stmt, ast.Import):
                for alias in stmt.names:
                    if alias.name in self.nodes:
                        env[alias.asname or alias.name] = alias.name
                        self.add_edge(module, alias.name, "imports")
        return env

    def resolve_call(self, call: ast.Call, module, owner_class, env) -> str | None:
        func = call.func
        if isinstance(func, ast.Name):
            return env.get(func.id)
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
            if func.value.id == "self" and owner_class:
                return f"{owner_class}.{func.attr}"
            base = env.get(func.value.id)
            if base:
                return f"{base}.{func.attr}"
        return None

    def read_calls(self, module, tree, env):
        def visit_body(owner_id, owner_class, body):
            for stmt in body:
                for node in ast.walk(stmt):
                    if isinstance(node, ast.Call):
                        target = self.resolve_call(node, module, owner_class, env)
                        if target:
                            self.add_edge(owner_id, target, "calls")

        for stmt in tree.body:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                visit_body(f"{module}.{stmt.name}", None, stmt.body)
            elif isinstance(stmt, ast.ClassDef):
                class_id = f"{module}.{stmt.name}"
                for child in stmt.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        visit_body(f"{class_id}.{child.name}", class_id, child.body)
            elif not isinstance(stmt, (ast.Import, ast.ImportFrom)):
                visit_body(module, None, [stmt])

    def read_doc(self, path: Path):
        rel = path.relative_to(CORPUS).as_posix()
        text = path.read_text()
        title = next((l[2:].strip() for l in text.splitlines() if l.startswith("# ")), path.stem)
        body = [p for p in re.split(r"\n\s*\n", text) if not p.lstrip().startswith("#")]
        summary = re.split(r"(?<=[.!?])\s", body[0].strip().replace("\n", " "))[0] if body else ""
        self.add_node(rel, "doc", path.name, rel, title, summary, text)

    def read_doc_edges(self, path: Path):
        rel = path.relative_to(CORPUS).as_posix()
        text = path.read_text()
        for match in re.finditer(r"\[[^\]]*\]\(([^)#]+\.md)\)", text):
            target = (path.parent / match.group(1)).resolve().relative_to(CORPUS.resolve()).as_posix()
            self.add_edge(rel, target, "links")
        for match in re.finditer(r"`([^`\n]+)`", text):
            target = self.resolve_mention(re.split(r"[(\s]", match.group(1))[0])
            if target:
                self.add_edge(rel, target, "mentions")

    def resolve_mention(self, token: str) -> str | None:
        token = token.strip(".")
        if not token:
            return None
        if token in self.nodes and self.nodes[token]["kind"] != "doc":
            return token
        if token.endswith(".py") and token.removesuffix(".py").replace("/", ".") in self.nodes:
            return token.removesuffix(".py").replace("/", ".")
        found = [i for i, n in self.nodes.items() if n["kind"] != "doc" and i.endswith("." + token)]
        if len(found) == 1:
            return found[0]
        return self.constants.get(token) if not found else None


def owner(node_id: str, nodes: dict[str, dict]) -> str:
    """The module a node belongs to; docs and modules own themselves."""
    while nodes[node_id]["kind"] not in ("module", "doc"):
        node_id = node_id.rsplit(".", 1)[0]
    return node_id


def separate(pos: dict, radius: dict, box: tuple, passes: int = 600) -> None:
    """Push discs apart until none overlaps (radius is per key, summed pairwise), staying inside box."""
    keys = sorted(pos)
    for _ in range(passes):
        moved = False
        for i, a in enumerate(keys):
            for b in keys[i + 1 :]:
                dx, dy = pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]
                dist = math.hypot(dx, dy) or 1e-6
                gap = radius[a] + radius[b]
                if dist < gap:
                    push = (gap - dist) / 2 / dist
                    pos[a] = (pos[a][0] + dx * push, pos[a][1] + dy * push)
                    pos[b] = (pos[b][0] - dx * push, pos[b][1] - dy * push)
                    moved = True
        for key in keys:
            pos[key] = (min(max(pos[key][0], box[0] + radius[key]), box[1] - radius[key]),
                        min(max(pos[key][1], box[2] + radius[key]), box[3] - radius[key]))
        if not moved:
            return


def layout(nodes: dict[str, dict], edges: dict) -> dict[str, tuple[float, float]]:
    """Modules by a weighted spring layout, members on a ring around their module, docs in a column on the right."""
    home = {n: owner(n, nodes) for n in nodes}
    modules = sorted({m for m in home.values() if nodes[m]["kind"] == "module"})
    docs = sorted(n for n in nodes if nodes[n]["kind"] == "doc")
    members = {m: sorted(n for n in nodes if home[n] == m and n != m) for m in modules}
    hub = max(modules, key=lambda m: sum(1 for (s, t, _) in edges if m in (home[s], home[t]) and home[s] != home[t]))

    mgraph = nx.Graph()
    mgraph.add_nodes_from(m for m in modules if m != hub)
    for (source, target, _), weight in edges.items():
        a, b = home[source], home[target]
        if a == b or hub in (a, b) or a in docs or b in docs:
            continue
        old = mgraph.get_edge_data(a, b, {"weight": 0})["weight"]
        mgraph.add_edge(a, b, weight=old + weight)
    mpos = nx.spring_layout(mgraph, k=1.2 / math.sqrt(len(mgraph)), iterations=500, seed=3, weight="weight")

    left, right, top, bottom = 0.1, 0.68, 0.1, 0.9
    xs = [p[0] for p in mpos.values()]
    ys = [p[1] for p in mpos.values()]
    cluster = {
        m: (left + (right - left) * (p[0] - min(xs)) / (max(xs) - min(xs)),
            top + (bottom - top) * (p[1] - min(ys)) / (max(ys) - min(ys)))
        for m, p in mpos.items()
    }
    ring = {m: max(0.04, 0.02 + 0.006 * len(members[m])) for m in modules}
    reach = {m: ring[m] + 0.022 for m in modules}
    cluster[hub] = (0.5 * (left + right), 0.5 * (top + bottom))
    ring[hub] = max(ring[hub], 0.06)
    reach[hub] = ring[hub] + 0.03
    best = max(((x / 40, y / 40) for x in range(6, 28) for y in range(5, 36)),
               key=lambda c: min(math.hypot(c[0] - p[0], c[1] - p[1]) - reach[m] for m, p in cluster.items() if m != hub))
    cluster[hub] = best
    separate(cluster, reach, (0.0, 0.74, 0.0, 1.0))

    pos = {}
    cx = sum(p[0] for p in cluster.values()) / len(cluster)
    cy = sum(p[1] for p in cluster.values()) / len(cluster)
    for m in modules:
        x, y = cluster[m]
        pos[m] = (x, y)
        outward = math.atan2(y - cy, x - cx)
        count = len(members[m])
        span = min(2 * math.pi, 0.9 * count) if count else 0
        for i, member in enumerate(members[m]):
            angle = outward - span / 2 + span * (i + 0.5) / count if count > 1 and span < 2 * math.pi else \
                outward + 2 * math.pi * i / count
            pos[member] = (x + ring[m] * math.cos(angle), y + ring[m] * math.sin(angle))

    def doc_y(doc):
        ys = [cluster[home[t]][1] for (s, t, _) in edges if s == doc and home[t] in cluster] or [0.5]
        return sum(ys) / len(ys)

    for i, doc in enumerate(sorted(docs, key=doc_y)):
        pos[doc] = (0.82 if i % 2 == 0 else 0.93, top + (bottom - top) * i / (len(docs) - 1))

    separate(pos, {n: 0.0185 for n in pos}, (0.0, 1.0, 0.0, 1.0))
    return {n: (round(x, 4), round(y, 4)) for n, (x, y) in pos.items()}


def build() -> dict:
    b = Builder()
    py_files = sorted((CORPUS / "shop").glob("*.py"))
    parsed = [b.read_module(p) for p in py_files]
    for module, tree in parsed:
        env = b.environment(module, tree)
        b.read_calls(module, tree, env)
    docs = sorted((CORPUS / "docs").rglob("*.md"))
    for path in docs:
        b.read_doc(path)
    for path in docs:
        b.read_doc_edges(path)
    pos = layout(b.nodes, b.edges)
    nodes = [{**n, "x": pos[i][0], "y": pos[i][1]} for i, n in b.nodes.items()]
    edges = [{"source": s, "target": t, "type": ty, "weight": w} for (s, t, ty), w in b.edges.items()]
    return {"nodes": nodes, "edges": edges}


if __name__ == "__main__":
    graph = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(graph, indent=1) + "\n")
    degree: dict[str, int] = {}
    for e in graph["edges"]:
        for end in (e["source"], e["target"]):
            degree[end] = degree.get(end, 0) + 1
    hub = max(degree, key=degree.get)
    print(f"{len(graph['nodes'])} nodes, {len(graph['edges'])} edges; hub {hub} degree {degree[hub]}")
