export const DECAY = 0.8;
export const FULL_AT = 0.5;
export const SEEDS = 5;
export const SEARCH_BUDGET = 1000;
export const MAX_STUBS = 20;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const STOPWORDS = new Set(
  'a an and are as at be by do does for from how if in is it of on or that the this to was what when who why with'.split(' '),
);
const REVERSE: Record<string, string> = {
  calls: 'called_by',
  imports: 'imported_by',
  defines: 'defined_in',
  mentions: 'mentioned_by',
  links: 'linked_from',
};

export type Detail = 'full' | 'summary' | 'stub';

export interface GraphNode {
  id: string;
  kind: 'module' | 'function' | 'class' | 'doc';
  label: string;
  file: string;
  signature: string;
  summary: string;
  text: string;
  tokens: number;
  x: number;
  y: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: { source: string; target: string; type: string; weight: number }[];
}

export interface Edge {
  target: string;
  type: string;
  weight: number;
  label: string;
}

export interface View {
  node: string;
  detail: 'full' | 'summary';
  text: string;
  tokens: number;
  score: number;
  via: Edge | null;
}

export interface Hit {
  node: string;
  score: number;
}

export interface Pop {
  node: string;
  score: number;
  via: Edge | null;
  outcome: Detail;
  tokens: number;
  spent: number;
}

export interface Built {
  picked: Map<string, View>;
  stubs: [string, Edge | null][];
  pops: Pop[];
}

export const tokens = (text: string): number => Math.ceil([...text].length / 4);

export function tokenize(text: string): string[] {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

class Heap {
  private items: [number, number, string, Edge | null][] = [];

  get size() {
    return this.items.length;
  }

  private less(a: number, b: number) {
    const x = this.items[a];
    const y = this.items[b];
    return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  }

  push(item: [number, number, string, Edge | null]) {
    const h = this.items;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }

  pop(): [number, number, string, Edge | null] {
    const h = this.items;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(l, m)) m = l;
        if (r < h.length && this.less(r, m)) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

export class Graph {
  nodes = new Map<string, GraphNode>();
  adjacent = new Map<string, Edge[]>();
  private docs = new Map<string, Map<string, number>>();
  private lengths = new Map<string, number>();
  private avgLength: number;
  private idf = new Map<string, number>();

  constructor(data: GraphData) {
    for (const n of data.nodes) {
      this.nodes.set(n.id, n);
      this.adjacent.set(n.id, []);
    }
    for (const e of data.edges) {
      this.adjacent.get(e.source)!.push({ target: e.target, type: e.type, weight: e.weight, label: e.type });
      this.adjacent.get(e.target)!.push({ target: e.source, type: e.type, weight: e.weight, label: REVERSE[e.type] });
    }
    const df = new Map<string, number>();
    let total = 0;
    for (const [id, n] of this.nodes) {
      const counts = new Map<string, number>();
      const toks = tokenize(`${id} ${n.signature} ${n.summary} ${n.text}`);
      for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
      this.docs.set(id, counts);
      this.lengths.set(id, toks.length);
      total += toks.length;
      for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    }
    this.avgLength = total / this.nodes.size;
    const n = this.nodes.size;
    for (const [t, f] of df) this.idf.set(t, Math.log(1 + (n - f + 0.5) / (f + 0.5)));
  }

  edges(node: string): Edge[] {
    return this.adjacent.get(node)!;
  }

  search(query: string, k = SEEDS): Hit[] {
    const terms = [...new Set(tokenize(query))].filter((t) => this.idf.has(t));
    const scores: [string, number][] = [];
    for (const [node, counts] of this.docs) {
      const norm = BM25_K1 * (1 - BM25_B + (BM25_B * this.lengths.get(node)!) / this.avgLength);
      let score = 0;
      for (const t of terms) {
        const c = counts.get(t) ?? 0;
        if (c) score += (this.idf.get(t)! * c * (BM25_K1 + 1)) / (c + norm);
      }
      if (score > 0) scores.push([node, score]);
    }
    scores.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const ranked = scores.slice(0, k);
    const best = ranked.length ? ranked[0][1] : 1;
    return ranked.map(([node, score]) => ({ node, score: score / best }));
  }

  renderWithin(node: string, detail: 'full' | 'summary', room: number): View | null {
    const info = this.nodes.get(node)!;
    const levels: ['full' | 'summary', string][] = [
      ['full', info.text],
      ['summary', [info.signature, info.summary].filter(Boolean).join('\n')],
    ];
    for (const [level, text] of levels.slice(detail === 'full' ? 0 : 1)) {
      const t = tokens(text);
      if (t <= room) return { node, detail: level, text, tokens: t, score: 0, via: null };
    }
    return null;
  }
}

export const detailFor = (score: number): 'full' | 'summary' => (score >= FULL_AT ? 'full' : 'summary');

export function buildContext(query: string, graph: Graph, budget: number, maxStubs = MAX_STUBS): Built {
  let tie = 0;
  const frontier = new Heap();
  for (const hit of graph.search(query, SEEDS)) frontier.push([-hit.score, tie++, hit.node, null]);
  const picked = new Map<string, View>();
  const stubs = new Map<string, Edge | null>();
  const pops: Pop[] = [];
  let spent = 0;
  while (frontier.size) {
    const [negScore, , node, via] = frontier.pop();
    const score = -negScore;
    if (picked.has(node)) continue;
    const view = graph.renderWithin(node, detailFor(score), budget - spent);
    if (!view) {
      if (!stubs.has(node)) stubs.set(node, via);
      pops.push({ node, score, via, outcome: 'stub', tokens: 0, spent });
      continue;
    }
    view.score = score;
    view.via = via;
    picked.set(node, view);
    spent += view.tokens;
    pops.push({ node, score, via, outcome: view.detail, tokens: view.tokens, spent });
    const edges = graph.edges(node);
    for (const edge of edges) frontier.push([-((score * edge.weight * DECAY) / edges.length), tie++, edge.target, edge]);
  }
  return {
    picked,
    stubs: [...stubs].filter(([n]) => !picked.has(n)).slice(0, maxStubs),
    pops,
  };
}

export function expand(graph: Graph, node: string, maxStubs = MAX_STUBS): Built {
  const view = graph.renderWithin(node, 'full', Infinity)!;
  view.score = 1;
  const degree = (id: string) => graph.edges(id).length;
  const edges = [...graph.edges(node)].sort(
    (a, b) =>
      b.weight - a.weight || degree(a.target) - degree(b.target) || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0),
  );
  const seen = new Set<string>();
  const stubs: [string, Edge | null][] = [];
  for (const edge of edges) {
    if (!seen.has(edge.target)) {
      seen.add(edge.target);
      stubs.push([edge.target, edge]);
    }
  }
  return { picked: new Map([[node, view]]), stubs: stubs.slice(0, maxStubs), pops: [] };
}

export function render(picked: Map<string, View>, stubs: [string, Edge | null][]): string {
  const parts = [...picked.values()]
    .sort((a, b) => b.score - a.score)
    .map((v) => `## ${v.node} (${v.detail})\n${v.text}`);
  if (stubs.length) {
    parts.push(
      'Not opened (call expand to read):\n' + stubs.map(([n, via]) => `- ${n}` + (via ? ` (${via.label})` : '')).join('\n'),
    );
  }
  return parts.join('\n\n');
}
