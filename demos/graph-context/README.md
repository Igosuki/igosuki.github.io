# Graph context demo

Offline pipeline behind the post on progressive context disclosure. The corpus is a made-up shop; outputs go to
`src/data/graph-context/`.

```sh
uv sync
uv run python build_graph.py            # corpus -> graph.json
uv run python compare.py                # embedding vs BM25 vs graph vs whole files -> comparison.json
uv run python record.py eu-checkout     # headless Claude Code run -> traces/eu-checkout.json
```

`record.py` runs `claude -p` (uses your Claude Code login) with only `uv run graphctx search|expand` allowed. `--dry-run --out <dir>` uses a scripted policy instead, to test the trace format. It refuses to
write under `src/data`. `uv run python context.py <query>` prints what `build_context` selects.

The embedding column of `compare.py` downloads `BAAI/bge-small-en-v1.5` on first run.
