import { MAX_CALLS, MODEL, AgentError, runAgent, type Trace, type TraceNode, type TraceStep } from './agent';
import { renderMarkdown } from './markdown';
import { Graph, MAX_STUBS, SEARCH_BUDGET, SEEDS, buildContext, render, type Detail, type GraphData } from './context';

const graphFiles = import.meta.glob<GraphData>('../../data/graph-context/graph.json', { eager: true, import: 'default' });
const traceFiles = import.meta.glob<Trace>('../../data/graph-context/traces/*.json', { eager: true, import: 'default' });

const W = 700;
const H = 500;
const PAD = 24;
const SVG_NS = 'http://www.w3.org/2000/svg';
const RANK: Record<Detail, number> = { stub: 1, summary: 2, full: 3 };
const WORD: Record<Detail, string> = { full: 'in full', summary: 'as summary', stub: 'as stub' };

type Mode = 'recorded' | 'try' | 'key';

interface Step {
  tool: 'search' | 'expand' | 'pop';
  call: string;
  note: string;
  line: string;
  nodes: TraceNode[];
  tokens: number;
}

type Child = Node | string | null | false | undefined;

const kids = (xs: Child[]) => xs.filter((x): x is Node | string => Boolean(x));

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const fmt = (n: number) => n.toLocaleString('en-US');
const fmtScore = (n: number) => (n < 0.001 ? '<0.001' : n < 0.1 ? n.toPrecision(2) : n.toFixed(2));

class GraphExplorer extends HTMLElement {
  private graph!: Graph;
  private traces: Trace[] = [];
  private degree = new Map<string, number>();
  private hub = '';
  private mode: Mode = 'recorded';
  private steps: Step[] = [];
  private index = 0;
  private scale = 1;
  private budgetLabel = '';
  private answer = '';
  private status = '';
  private finalStubs: Set<string> | null = null;
  private meta = '';
  private selected = '';
  private timer = 0;
  private abort: AbortController | null = null;
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  private tabs!: HTMLElement;
  private controls!: HTMLElement;
  private bar!: HTMLElement;
  private stage!: SVGSVGElement;
  private edgeLayer!: SVGGElement;
  private nodeLayer!: SVGGElement;
  private stepBox!: HTMLElement;
  private detailBox!: HTMLElement;
  private nodeEls = new Map<string, SVGGElement>();
  private edgeEls: { a: string; b: string; line: SVGLineElement }[] = [];
  private labelOrder: string[] = [];
  private traceId = '';
  private budget = SEARCH_BUDGET;
  private question = '';
  private apiKey = '';
  private sentText = '';

  connectedCallback() {
    const data = Object.values(graphFiles)[0];
    if (!data) {
      this.replaceChildren(
        el('p', { class: 'gx-empty' }, 'The demo data has not been built yet. Run the pipeline in demos/graph-context to generate it.'),
      );
      return;
    }
    this.graph = new Graph(data);
    this.traces = Object.values(traceFiles).sort((a, b) => a.id.localeCompare(b.id));
    for (const [id, edges] of this.graph.adjacent) this.degree.set(id, edges.length);
    this.hub = [...this.degree].sort((a, b) => b[1] - a[1])[0][0];
    this.traceId = this.traces[0]?.id ?? '';
    this.question = this.traces[0]?.question ?? '';
    if (!this.traces.length) this.mode = 'try';

    this.build();
    this.setMode(this.mode);
    this.reduceMotion.addEventListener('change', () => {
      this.stop();
      this.renderBar();
    });
    new ResizeObserver(() => this.layout()).observe(this.stage);
  }

  disconnectedCallback() {
    this.stop();
    this.abort?.abort();
  }

  private build() {
    this.tabs = el('div', { class: 'gx-tabs', role: 'tablist', 'aria-label': 'Demo mode' });
    const labels: [Mode, string][] = [
      ['recorded', 'Recorded runs'],
      ['try', 'Try a question'],
      ['key', 'Use your own key'],
    ];
    for (const [mode, label] of labels) {
      const b = el('button', { type: 'button', role: 'tab', id: `gx-tab-${mode}`, 'data-mode': mode }, label);
      b.addEventListener('click', () => this.setMode(mode));
      b.addEventListener('keydown', (e) => {
        const i = labels.findIndex(([m]) => m === mode);
        const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
        if (next < 0) return;
        e.preventDefault();
        const target = labels[(next + labels.length) % labels.length][0];
        this.setMode(target);
        this.tabs.querySelector<HTMLElement>(`[data-mode="${target}"]`)!.focus();
      });
      this.tabs.append(b);
    }

    this.controls = el('div', { class: 'gx-controls', role: 'tabpanel' });
    this.bar = el('div', { class: 'gx-bar' });
    this.stage = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gx-svg', role: 'group', 'aria-label': 'Code and docs graph' });
    this.edgeLayer = svg('g');
    this.nodeLayer = svg('g');
    this.stage.append(this.edgeLayer, this.nodeLayer);
    this.stepBox = el('div', { class: 'gx-step', 'aria-live': 'polite' });
    this.detailBox = el('div', { class: 'gx-detail' });

    const legend = el('ul', { class: 'gx-legend', 'aria-label': 'Legend' });
    for (const [cls, text] of [
      ['full', 'Received in full'],
      ['summary', 'Summary'],
      ['stub', 'Stub'],
      ['seed', 'Search hit'],
    ]) {
      legend.append(el('li', {}, el('i', { class: `gx-key gx-${cls}` }), text));
    }
    legend.append(el('li', {}, `Bigger dots have more connections. The largest is ${this.graph.nodes.get(this.hub)!.label}.`));

    this.buildGraph();
    this.append(this.tabs, this.controls, this.bar, el('div', { class: 'gx-graph' }, this.stage), legend, this.stepBox, this.detailBox);
  }

  private buildGraph() {
    const pos = (id: string) => {
      const n = this.graph.nodes.get(id)!;
      return [PAD + n.x * (W - 2 * PAD), PAD + n.y * (H - 2 * PAD)] as const;
    };
    const seen = new Set<string>();
    for (const [a, list] of this.graph.adjacent) {
      for (const e of list) {
        const key = a < e.target ? `${a}|${e.target}` : `${e.target}|${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const [x1, y1] = pos(a);
        const [x2, y2] = pos(e.target);
        const line = svg('line', { x1, y1, x2, y2, class: 'gx-edge' });
        this.edgeLayer.append(line);
        this.edgeEls.push({ a, b: e.target, line });
      }
    }
    for (const n of this.graph.nodes.values()) {
      const [x, y] = pos(n.id);
      const g = svg('g', { class: 'gx-node', 'data-id': n.id, role: 'button', tabindex: -1, 'aria-label': n.id });
      g.dataset.x = String(x);
      g.dataset.y = String(y);
      g.append(
        svg('circle', { class: 'gx-ring' }),
        svg('circle', { class: 'gx-dot' }),
        svg('circle', { class: 'gx-hit' }),
        Object.assign(svg('text', { class: 'gx-label' }), { textContent: n.label }),
      );
      if (n.id === this.hub) g.classList.add('gx-hubnode');
      g.addEventListener('click', () => this.select(n.id));
      g.addEventListener('focus', () => this.select(n.id));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.select(n.id);
        }
      });
      this.nodeLayer.append(g);
      this.nodeEls.set(n.id, g);
    }
  }

  private layout() {
    const width = this.stage.getBoundingClientRect().width;
    if (!width) return;
    const u = W / width;
    for (const [id, g] of this.nodeEls) {
      const x = Number(g.dataset.x);
      const y = Number(g.dataset.y);
      const d = Math.sqrt(this.degree.get(id) ?? 1);
      const px = g.classList.contains('gx-hot') ? Math.min(11, 3 + 1.1 * d) : 1.4 + 0.6 * d;
      const r = px * u;
      const set = (cls: string, v: number) => g.querySelector(cls)!.setAttribute('r', String(v));
      for (const c of ['.gx-dot']) set(c, r);
      set('.gx-ring', r + 3.5 * u);
      set('.gx-hit', Math.max(r, 10 * u));
      for (const c of ['.gx-ring', '.gx-dot', '.gx-hit']) {
        const circle = g.querySelector(c)!;
        circle.setAttribute('cx', String(x));
        circle.setAttribute('cy', String(y));
      }
      const label = g.querySelector('text')!;
      const flip = x > W * 0.72;
      label.setAttribute('x', String(flip ? x - r - 4 * u : x + r + 4 * u));
      label.setAttribute('y', String(y + 4 * u));
      label.setAttribute('text-anchor', flip ? 'end' : 'start');
    }
    this.stage.style.setProperty('--u', String(u));
    this.placeLabels(u);
  }

  private placeLabels(u: number) {
    const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const shown = new Set<string>();
    for (const id of this.labelOrder) {
      const g = this.nodeEls.get(id)!;
      const label = g.querySelector('text')!;
      const x = Number(label.getAttribute('x'));
      const y = Number(label.getAttribute('y'));
      const w = this.graph.nodes.get(id)!.label.length * 6.6 * u;
      const box = label.getAttribute('text-anchor') === 'end' ? { x0: x - w, x1: x } : { x0: x, x1: x + w };
      const hit = { ...box, y0: y - 11 * u, y1: y + 4 * u };
      if (taken.some((t) => hit.x0 < t.x1 && hit.x1 > t.x0 && hit.y0 < t.y1 && hit.y1 > t.y0)) continue;
      taken.push(hit);
      shown.add(id);
    }
    for (const [id, g] of this.nodeEls) g.classList.toggle('gx-lab', shown.has(id));
  }

  private setMode(mode: Mode) {
    this.stop();
    this.abort?.abort();
    this.abort = null;
    this.mode = mode;
    this.steps = [];
    this.index = 0;
    this.answer = '';
    this.status = '';
    this.finalStubs = null;
    this.meta = '';
    this.selected = '';
    for (const b of this.tabs.querySelectorAll<HTMLElement>('[role=tab]')) {
      const on = b.dataset.mode === mode;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.controls.setAttribute('aria-labelledby', `gx-tab-${mode}`);
    this.controls.replaceChildren();
    if (mode === 'recorded') this.buildRecorded();
    else if (mode === 'try') this.buildTry();
    else this.buildKey();
    this.renderAll();
  }

  private buildRecorded() {
    if (!this.traces.length) {
      this.controls.append(el('p', { class: 'gx-empty' }, 'No recorded runs have been built yet.'));
      return;
    }
    const group = el('div', { class: 'gx-choices', role: 'radiogroup', 'aria-label': 'Question' });
    for (const t of this.traces) {
      const b = el('button', { type: 'button', role: 'radio', 'aria-checked': t.id === this.traceId, 'data-id': t.id }, t.question);
      b.addEventListener('click', () => {
        this.traceId = t.id;
        this.loadTrace();
      });
      group.append(b);
    }
    this.controls.append(group);
    this.loadTrace();
  }

  private loadTrace() {
    this.stop();
    const t = this.traces.find((x) => x.id === this.traceId)!;
    for (const b of this.controls.querySelectorAll('[role=radio]')) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-id') === this.traceId));
    }
    this.steps = t.steps.map((s) => ({
      tool: s.tool,
      call: s.tool === 'search' ? `search "${s.input.query}"` : `expand ${s.input.node}`,
      note: s.note,
      line: '',
      nodes: s.nodes,
      tokens: s.context_tokens,
    }));
    this.index = 0;
    this.scale = Math.max(1, t.totals.context_tokens);
    this.budgetLabel = '';
    this.answer = t.answer;
    this.status = '';
    this.meta = `${t.model}, recorded ${t.recorded}`;
    this.selected = '';
    this.renderAll();
  }

  private buildTry() {
    const input = el('input', { type: 'text', id: 'gx-q', value: this.question, autocomplete: 'off', placeholder: 'Ask about the shop code and docs' });
    input.addEventListener('input', () => (this.question = input.value));
    const slider = el('input', { type: 'range', id: 'gx-budget', min: 100, max: 4000, step: 100, value: this.budget });
    const out = el('output', { for: 'gx-budget' }, `${fmt(this.budget)} tokens`);
    slider.addEventListener('input', () => {
      this.budget = Number(slider.value);
      out.textContent = `${fmt(this.budget)} tokens`;
      if (this.steps.length) this.runTry(true);
    });
    const run = el('button', { type: 'submit', class: 'gx-primary' }, 'Build context');
    const form = el(
      'form',
      { class: 'gx-form' },
      el('label', { for: 'gx-q' }, 'Question'),
      el('div', { class: 'gx-row' }, input, run),
      el('label', { for: 'gx-budget' }, 'Context budget'),
      el('div', { class: 'gx-row' }, slider, out),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.runTry(false);
    });
    this.controls.append(form);
    if (this.traces.length) {
      const ideas = el('div', { class: 'gx-ideas' }, el('span', {}, 'Examples:'));
      for (const t of this.traces) {
        const b = el('button', { type: 'button' }, t.question);
        b.addEventListener('click', () => {
          this.question = t.question;
          input.value = t.question;
          this.runTry(false);
        });
        ideas.append(b);
      }
      this.controls.append(ideas);
    }
  }

  private runTry(jumpToEnd: boolean) {
    this.stop();
    const built = buildContext(this.question, this.graph, this.budget);
    if (!built.pops.length) {
      this.steps = [];
      this.status = 'No node matches those words. Try other terms from the code or docs.';
      this.answer = '';
      this.index = 0;
      this.renderAll();
      return;
    }
    this.status = '';
    const verb = { full: 'opened in full', summary: 'opened as a summary', stub: 'kept as a stub' };
    this.steps = built.pops.map((p) => ({
      tool: 'pop',
      call: `${p.node} ${verb[p.outcome]}`,
      note: '',
      line:
        `${p.via ? `Reached through a ${p.via.label.replace(/_/g, ' ')} edge` : 'Search hit'}, score ${fmtScore(p.score)}. ` +
        (p.outcome === 'stub' ? 'Not enough budget left to open it.' : `It costs ${fmt(p.tokens)} tokens.`),
      nodes: [{ id: p.node, detail: p.outcome, score: p.score, via: p.via?.label ?? null }],
      tokens: p.spent,
    }));
    this.finalStubs = new Set(built.stubs.map(([n]) => n));
    const spent = built.pops[built.pops.length - 1].spent;
    const sent = render(built.picked, built.stubs);
    this.answer = `Result: ${built.picked.size} nodes opened, ${built.stubs.length} left as stubs, ${fmt(spent)} of ${fmt(this.budget)} tokens used.`;
    this.scale = this.budget;
    this.budgetLabel = `of ${fmt(this.budget)}`;
    this.meta = `Same loop as the Python version, running in your browser (up to ${SEEDS} seeds, at most ${MAX_STUBS} stubs).`;
    this.sentText = sent;
    this.index = jumpToEnd ? this.steps.length : 0;
    this.renderAll();
  }

  private buildKey() {
    const key = el('input', { type: 'password', id: 'gx-key', autocomplete: 'new-password', placeholder: 'sk-ant-…', spellcheck: false });
    key.addEventListener('input', () => (this.apiKey = key.value.trim()));
    key.value = this.apiKey;
    const q = el('input', { type: 'text', id: 'gx-kq', value: this.question, autocomplete: 'off' });
    q.addEventListener('input', () => (this.question = q.value));
    const go = el('button', { type: 'submit', class: 'gx-primary' }, 'Run agent');
    const stop = el('button', { type: 'button', hidden: true }, 'Stop');
    stop.addEventListener('click', () => this.abort?.abort());
    const form = el(
      'form',
      { class: 'gx-form', autocomplete: 'off' },
      el('label', { for: 'gx-key' }, 'Anthropic API key'),
      el('div', { class: 'gx-row' }, key),
      el('p', { class: 'gx-note' }, 'Your key stays in this page’s memory and is sent only to api.anthropic.com. Nothing is stored or logged. Reload to clear it.'),
      el('label', { for: 'gx-kq' }, 'Question'),
      el('div', { class: 'gx-row' }, q, go, stop),
      el('p', { class: 'gx-note' }, `${MODEL} gets the search and expand tools and up to ${MAX_CALLS} calls. This uses your API credit.`),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.apiKey) {
        this.status = 'Paste an API key first.';
        this.renderAll();
        return;
      }
      if (!this.question.trim()) {
        this.status = 'Type a question first.';
        this.renderAll();
        return;
      }
      this.abort?.abort();
      const ctl = (this.abort = new AbortController());
      const stale = () => this.abort !== ctl || this.mode !== 'key';
      this.steps = [];
      this.index = 0;
      this.answer = '';
      this.status = 'Waiting for the model…';
      this.scale = 3000;
      this.budgetLabel = '';
      this.meta = MODEL;
      go.disabled = true;
      stop.hidden = false;
      this.renderAll();
      try {
        const answer = await runAgent({
          apiKey: this.apiKey,
          question: this.question,
          graph: this.graph,
          signal: ctl.signal,
          onStep: (s) => !stale() && this.pushLive(s),
        });
        if (stale()) return;
        this.answer = answer || 'The model returned no text.';
        this.status = '';
      } catch (err) {
        if (stale()) return;
        this.status =
          (err as Error).name === 'AbortError'
            ? 'Stopped.'
            : err instanceof AgentError
              ? err.message
              : `Something went wrong: ${(err as Error).message}`;
      } finally {
        if (!stale()) {
          go.disabled = false;
          stop.hidden = true;
          this.index = this.steps.length;
          this.renderAll();
        }
      }
    });
    this.controls.append(form);
  }

  private pushLive(s: TraceStep) {
    this.steps.push({
      tool: s.tool,
      call: s.tool === 'search' ? `search "${s.input.query}"` : `expand ${s.input.node}`,
      note: s.note,
      line: '',
      nodes: s.nodes,
      tokens: s.context_tokens,
    });
    this.scale = Math.max(3000, s.context_tokens);
    this.index = this.steps.length;
    this.status = this.steps.length >= MAX_CALLS ? 'Tool-call limit reached, waiting for the answer…' : 'Waiting for the model…';
    this.renderAll();
  }

  private go(delta: number) {
    this.index = Math.max(0, Math.min(this.steps.length, this.index + delta));
    this.renderAll();
  }

  private stop() {
    clearInterval(this.timer);
    this.timer = 0;
  }

  private toggle() {
    if (this.timer) {
      this.stop();
    } else {
      if (this.index >= this.steps.length) this.index = 0;
      this.go(1);
      this.timer = window.setInterval(() => {
        if (this.index >= this.steps.length) this.stop();
        else this.go(1);
        if (this.index >= this.steps.length) this.stop();
        this.renderBar();
      }, 1400);
    }
    this.renderBar();
  }

  private renderAll() {
    this.renderBar();
    this.renderGraph();
    this.renderStep();
    this.renderDetail();
  }

  private renderBar() {
    const n = this.steps.length;
    const back = el('button', { type: 'button', disabled: this.index === 0 }, 'Back');
    const next = el('button', { type: 'button', disabled: this.index >= n }, 'Next');
    const reset = el('button', { type: 'button', disabled: this.index === 0 }, 'Start over');
    back.addEventListener('click', () => (this.stop(), this.go(-1)));
    next.addEventListener('click', () => (this.stop(), this.go(1)));
    reset.addEventListener('click', () => (this.stop(), (this.index = 0), this.renderAll()));
    const items: Child[] = [back];
    if (!this.reduceMotion.matches && this.mode !== 'key') {
      const play = el('button', { type: 'button', disabled: n === 0 }, this.timer ? 'Pause' : 'Play');
      play.addEventListener('click', () => this.toggle());
      items.push(play);
    }
    items.push(next, reset, el('span', { class: 'gx-count' }, n ? `Step ${this.index} of ${n}` : ''));
    this.bar.replaceChildren(...kids(items));
    this.bar.hidden = n === 0;
  }

  private reached() {
    const best = new Map<string, Detail>();
    const seeds = new Set<string>();
    const current = new Set<string>();
    const visible = this.steps.slice(0, this.index);
    visible.forEach((s, i) => {
      for (const n of s.nodes) {
        if (this.finalStubs && this.index === this.steps.length && n.detail === 'stub' && !this.finalStubs.has(n.id)) continue;
        if (!best.has(n.id) || RANK[n.detail] > RANK[best.get(n.id)!]) best.set(n.id, n.detail);
        if (s.tool !== 'expand' && n.via === null && n.detail !== 'stub') seeds.add(n.id);
        if (i === visible.length - 1) current.add(n.id);
      }
    });
    return { best, seeds, current };
  }

  private renderGraph() {
    const { best, seeds, current } = this.reached();
    const ordered: SVGGElement[] = [];
    for (const [id, g] of this.nodeEls) {
      const detail = best.get(id);
      g.setAttribute('class', 'gx-node');
      if (detail) g.classList.add(`gx-${detail}`, 'gx-hot');
      if (seeds.has(id)) g.classList.add('gx-seed');
      if (current.has(id)) g.classList.add('gx-cur');
      if (id === this.hub) g.classList.add('gx-hubnode');
      if (id === this.selected) g.classList.add('gx-sel');
      g.tabIndex = detail || id === this.selected ? 0 : -1;
      ordered.push(g);
    }
    ordered.sort((a, b) => Number(a.classList.contains('gx-hot')) - Number(b.classList.contains('gx-hot')) || Number(a.classList.contains('gx-cur')) - Number(b.classList.contains('gx-cur')));
    const rank = (ids: Iterable<string>, pick: (id: string) => boolean) => [...ids].filter(pick);
    const isFS = (id: string) => best.get(id) === 'full' || best.get(id) === 'summary';
    const order = [this.selected, ...rank(current, (id) => best.get(id) === 'full'), ...rank(seeds, () => true), ...rank(current, isFS), this.hub];
    this.labelOrder = [...new Set(order)].filter((id) => this.nodeEls.has(id));
    this.nodeLayer.append(...ordered);
    for (const { a, b, line } of this.edgeEls) {
      line.classList.toggle('gx-live', best.has(a) && best.has(b));
    }
    this.layout();
  }

  private renderStep() {
    const box = this.stepBox;
    box.replaceChildren();
    if (this.status) box.append(el('p', { class: 'gx-status', role: 'status' }, this.status));
    const s = this.steps[this.index - 1];
    const parts: Child[] = [];
    if (!s) {
      if (this.steps.length) {
        parts.push(el('p', { class: 'gx-hint' }, this.mode === 'try' ? 'Press Next to take the first node off the queue.' : 'Press Next to see the first tool call.'));
      } else if (this.mode === 'key' && !this.status) {
        parts.push(el('p', { class: 'gx-hint' }, 'Each tool call the model makes will appear here.'));
      }
    } else {
      const head = el('p', { class: 'gx-call' }, el('code', {}, s.call));
      parts.push(head);
      if (s.note) parts.push(el('p', { class: 'gx-model-note' }, s.note));
      if (s.line) parts.push(el('p', { class: 'gx-line' }, s.line));
      parts.push(this.meter(s.tokens));
      if (s.tool !== 'pop') {
        const group = (detail: Detail) => {
          const list = el('ul', { class: 'gx-nodes' });
          for (const n of s.nodes.filter((x) => x.detail === detail)) {
            const b = el('button', { type: 'button', 'data-id': n.id });
            b.append(...kids([el('code', {}, n.id), n.via && el('span', { class: 'gx-via' }, n.via.replace(/_/g, ' '))]));
            b.addEventListener('click', () => this.select(n.id));
            list.append(el('li', {}, b));
          }
          return list;
        };
        const count = (d: Detail) => s.nodes.filter((x) => x.detail === d).length;
        parts.push(el('p', { class: 'gx-sub' }, `The model received ${s.nodes.length} ${s.nodes.length === 1 ? 'node' : 'nodes'}`));
        for (const [d, title] of [['full', 'In full'], ['summary', 'Summary']] as const) {
          if (count(d)) parts.push(el('h5', { class: 'gx-group' }, `${title} (${count(d)})`), group(d));
        }
        if (count('stub')) {
          parts.push(el('details', { class: 'gx-stubs' }, el('summary', {}, `Stubs (${count('stub')}), names only`), group('stub')));
        }
      } else {
        const n = s.nodes[0];
        const show = el('button', { type: 'button', class: 'gx-link' }, `Read ${n.id}`);
        show.addEventListener('click', () => this.select(n.id));
        parts.push(show);
      }
    }
    if (this.index === this.steps.length && this.answer && (this.steps.length || this.mode === 'key')) {
      const label = this.mode === 'try' ? 'Result' : 'Answer';
      const body = el('div', { class: 'gx-prose' });
      body.append(renderMarkdown(this.mode === 'try' ? this.answer.replace(/^Result: /, '') : this.answer));
      parts.push(el('div', { class: 'gx-answer' }, el('h4', {}, label), body));
      if (this.mode === 'try' && this.sentText) {
        parts.push(el('details', {}, el('summary', {}, 'Show the text the model would receive'), el('pre', {}, el('code', {}, this.sentText))));
      }
    }
    if (this.meta) parts.push(el('p', { class: 'gx-meta' }, this.meta));
    box.append(...kids(parts));
  }

  private meter(tokens: number) {
    const pct = Math.min(100, (tokens / this.scale) * 100);
    return el(
      'div',
      { class: 'gx-meter' },
      el('div', { class: 'gx-meter-bar', role: 'img', 'aria-label': `${fmt(tokens)} tokens in context` }, el('span', { style: `width:${pct}%` })),
      el('span', {}, this.mode === 'try' ? 'Spent ' : 'Context so far: ', el('b', {}, fmt(tokens)), ` ${this.budgetLabel ? `${this.budgetLabel} ` : ''}tokens`),
    );
  }

  private select(id: string) {
    if (this.selected === id) return;
    this.selected = id;
    this.nodeEls.forEach((g, k) => g.classList.toggle('gx-sel', k === id));
    this.labelOrder = [id, ...this.labelOrder.filter((x) => x !== id)];
    this.layout();
    this.renderDetail();
  }

  private renderDetail() {
    const box = this.detailBox;
    box.replaceChildren();
    const n = this.graph.nodes.get(this.selected);
    if (!n) {
      box.append(el('p', { class: 'gx-hint' }, 'Select a node in the graph to read it.'));
      return;
    }
    const { best } = this.reached();
    const got = best.get(n.id);
    box.append(
      ...kids([
      el('h4', {}, el('code', {}, n.id)),
      el(
        'p',
        { class: 'gx-meta' },
        `${n.kind}, ${n.file}, ${fmt(n.tokens)} tokens, ${this.degree.get(n.id)} connections` +
          (got ? `. Received ${WORD[got]}.` : this.steps.length ? '. Not received yet.' : ''),
      ),
      n.summary ? el('p', {}, n.summary) : null,
      n.signature && n.kind !== 'doc' ? el('pre', { class: 'gx-sig' }, el('code', {}, n.signature)) : null,
      el('details', { open: got === 'full' }, el('summary', {}, 'Full text'), el('pre', {}, el('code', {}, n.text))),
      ]),
    );
  }
}

if (!customElements.get('graph-explorer')) customElements.define('graph-explorer', GraphExplorer);
