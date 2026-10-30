import { SEARCH_BUDGET, buildContext, expand, render, tokens, type Detail, type Graph } from './context';

export interface TraceNode {
  id: string;
  detail: Detail;
  score: number | null;
  via: string | null;
}

export interface TraceStep {
  tool: 'search' | 'expand';
  input: { query?: string; node?: string };
  note: string;
  nodes: TraceNode[];
  context_tokens: number;
}

export interface Trace {
  id: string;
  question: string;
  model: string;
  recorded: string;
  answer: string;
  steps: TraceStep[];
  totals: { tool_calls: number; context_tokens: number };
}

export const MODEL = 'claude-sonnet-5-5';
export const MAX_CALLS = 10;
const SYSTEM =
  'You answer questions about a codebase and its docs using two tools. search(query) returns the most relevant ' +
  'nodes, some opened in full and some as one-line summaries, plus a list of unopened neighbours. expand(node) ' +
  'opens one node in full and lists its neighbours. Open only what you need, then answer concisely and name the ' +
  'files and symbols your answer rests on.';
const TOOLS = [
  {
    name: 'search',
    description: 'Find nodes relevant to a query and the context around them.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'expand',
    description: 'Open one node by id and list its neighbours.',
    input_schema: { type: 'object', properties: { node: { type: 'string' } }, required: ['node'] },
  },
];

export class AgentError extends Error {}

export function callTool(
  graph: Graph,
  tool: string,
  input: { query?: string; node?: string },
  contextTokens: number,
  note: string,
): { output: string; step: TraceStep | null } {
  let built;
  if (tool === 'search') {
    built = buildContext(String(input.query ?? ''), graph, SEARCH_BUDGET);
  } else if (tool === 'expand' && input.node && graph.nodes.has(input.node)) {
    built = expand(graph, input.node);
  } else {
    return { output: `No node with id '${input.node}'. Use ids returned by search.`, step: null };
  }
  const nodes: TraceNode[] = [...built.picked.values()].map((v) => ({
    id: v.node,
    detail: v.detail,
    score: tool === 'search' ? Math.round(v.score * 1000) / 1000 : 1,
    via: v.via?.label ?? null,
  }));
  for (const [id, via] of built.stubs) nodes.push({ id, detail: 'stub', score: null, via: via?.label ?? null });
  const output = render(built.picked, built.stubs);
  return {
    output,
    step: { tool: tool as 'search' | 'expand', input, note, nodes, context_tokens: contextTokens + tokens(output) },
  };
}

async function post(apiKey: string, body: unknown, signal: AbortSignal) {
  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new AgentError(
      "The browser couldn't reach api.anthropic.com. Check your connection, or an extension or network policy that blocks cross-origin requests.",
    );
  }
  if (res.ok) return res.json();
  let detail = '';
  try {
    detail = (await res.json()).error?.message ?? '';
  } catch {}
  if (res.status === 401) throw new AgentError('Anthropic rejected that key. Check that it is complete and active.');
  if (res.status === 403) throw new AgentError(`Anthropic refused the request (403)${detail ? `: ${detail}` : ''}. Check the key's permissions.`);
  if (res.status === 429) throw new AgentError('Rate limit reached. Wait a minute and try again.');
  if (res.status === 529) throw new AgentError('Anthropic is overloaded right now. Try again shortly.');
  throw new AgentError(`Anthropic returned ${res.status}${detail ? `: ${detail}` : ''}`);
}

export async function runAgent(opts: {
  apiKey: string;
  question: string;
  graph: Graph;
  signal: AbortSignal;
  onStep: (step: TraceStep) => void;
}): Promise<string> {
  const messages: unknown[] = [{ role: 'user', content: opts.question }];
  let calls = 0;
  let contextTokens = 0;
  for (;;) {
    const exhausted = calls >= MAX_CALLS;
    const reply = await post(
      opts.apiKey,
      {
        model: MODEL,
        max_tokens: 2000,
        system: SYSTEM,
        tools: TOOLS,
        messages,
        tool_choice: { type: exhausted ? 'none' : 'auto' },
      },
      opts.signal,
    );
    const content: any[] = reply.content ?? [];
    const text = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const uses = content.filter((b) => b.type === 'tool_use');
    if (reply.stop_reason === 'max_tokens' && content.at(-1)?.type === 'tool_use') {
      throw new AgentError('The model ran out of output tokens mid-call.');
    }
    if (!uses.length) return text;
    messages.push({ role: 'assistant', content });
    const results = uses.map((use, i) => {
      calls++;
      const { output, step } = callTool(opts.graph, use.name, use.input ?? {}, contextTokens, i === 0 ? text : '');
      if (step) {
        contextTokens = step.context_tokens;
        opts.onStep(step);
      }
      return { type: 'tool_result', tool_use_id: use.id, content: output };
    });
    messages.push({ role: 'user', content: results });
  }
}
