// Run with: node src/components/graph-context/parity.ts
// Compares the TS and Python implementations on the three questions and a few budgets.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildContext, expand, Graph, type GraphData } from './context.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const graph = new Graph(JSON.parse(readFileSync(`${root}src/data/graph-context/graph.json`, 'utf8')) as GraphData);
const questions: { question: string }[] = JSON.parse(readFileSync(`${root}demos/graph-context/questions.json`, 'utf8'));

const queries = [...questions.map((q) => q.question), 'vat rate lookup by country code', 'logger audit trail'];
const budgets = [150, 400, 1000, 3000];
const expandNodes = ['shop.tax.vat_rate', 'shop.log', 'docs/vat.md'];

const py = `
import json, sys
sys.path.insert(0, '.')
from context import *
g = Graph.load()
out = {}
for q in json.loads(sys.argv[1]):
    for b in json.loads(sys.argv[2]):
        p, s = build_context(q, g, b)
        out[f"{q}|{b}"] = {"picked": [[n, v.detail, v.tokens, round(v.score, 9)] for n, v in p.items()], "stubs": [n for n, _ in s]}
for n in json.loads(sys.argv[3]):
    if n in g.nodes:
        p, s = expand(g, n)
        out[f"expand|{n}"] = {"picked": [[k, v.detail, v.tokens, 1.0] for k, v in p.items()], "stubs": [k for k, _ in s]}
print(json.dumps(out))
`;
const expected = JSON.parse(
  execFileSync('uv', ['run', 'python', '-c', py, JSON.stringify(queries), JSON.stringify(budgets), JSON.stringify(expandNodes)], {
    cwd: `${root}demos/graph-context`,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  }),
);

const shape = (b: ReturnType<typeof buildContext>) => ({
  picked: [...b.picked].map(([n, v]) => [n, v.detail, v.tokens, Math.round(v.score * 1e9) / 1e9]),
  stubs: b.stubs.map(([n]) => n),
});

let failures = 0;
const check = (key: string, got: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(expected[key]);
  if (!ok) {
    failures++;
    console.error(`MISMATCH ${key}\n  ts: ${JSON.stringify(got)}\n  py: ${JSON.stringify(expected[key])}`);
  }
};
for (const q of queries) for (const b of budgets) check(`${q}|${b}`, shape(buildContext(q, graph, b)));
for (const n of expandNodes) if (graph.nodes.has(n)) check(`expand|${n}`, shape(expand(graph, n)));

const total = Object.keys(expected).length;
console.log(failures ? `${failures} of ${total} cases differ` : `all ${total} cases identical`);
process.exit(failures ? 1 : 0);
