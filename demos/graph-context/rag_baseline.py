"""Embedding top-k over node text, the retrieval baseline."""
import numpy as np
from fastembed import TextEmbedding

from context import Graph

MODEL = "BAAI/bge-small-en-v1.5"


def top_k(graph: Graph, queries: list[str], k: int = 5) -> list[list[str]]:
    model = TextEmbedding(MODEL)
    ids = list(graph.nodes)
    chunks = np.array(list(model.embed([graph.nodes[i]["text"] for i in ids])))
    hits = []
    for vec in model.query_embed(queries):
        order = np.argsort(-(chunks @ vec))[:k]
        hits.append([ids[i] for i in order])
    return hits
