"""
Splitting lecture material into chunks for RAG.

Why chunk? An embedding represents one passage. Small, focused passages (~900 characters)
match questions much more precisely than a whole 40-minute transcript would.
Chunks overlap by a sentence or two so an idea that straddles a boundary isn't lost.

Transcripts may contain timestamps like "[12:34]" or "[1:02:03]". Each chunk records the
latest timestamp at or before its first sentence, so citations can jump to that point in the video.
Without timestamps we estimate the position from how far through the text the chunk starts.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

TS_RE = re.compile(r"\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]")
SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")


@dataclass
class Chunk:
    text: str
    index: int
    timestamp_seconds: int | None


def _ts_seconds(m: re.Match) -> int:
    h, mnt, s = m.group(1), m.group(2), m.group(3)
    return (int(h) if h else 0) * 3600 + int(mnt) * 60 + int(s)


def split_sentences(text: str) -> list[str]:
    out: list[str] = []
    for line in re.split(r"\n+", text or ""):
        line = re.sub(r"[ \t]+", " ", line).strip()
        if line:
            out.extend(s.strip() for s in SENTENCE_RE.split(line) if s.strip())
    return out


def chunk_text(text: str, size: int = 900, overlap: int = 150, duration_seconds: int | None = None) -> list[Chunk]:
    # 1. Sentences, each tagged with (clean text, timestamp, character offset)
    items: list[tuple[str, int | None, int]] = []
    offset = 0
    last_ts: int | None = None
    for s in split_sentences(text):
        marks = list(TS_RE.finditer(s))
        ts = _ts_seconds(marks[0]) if marks else last_ts
        if marks:
            last_ts = _ts_seconds(marks[-1])
        clean = re.sub(r"\s{2,}", " ", TS_RE.sub("", s)).strip()
        if clean:
            items.append((clean, ts, offset))
            offset += len(clean) + 1
    if not items:
        return []
    total = offset or 1

    # 2. Greedily pack sentences into chunks of ~size chars, stepping back for overlap.
    chunks: list[Chunk] = []
    i = 0
    while i < len(items):
        j, length = i, 0
        while j < len(items) and (j == i or length + len(items[j][0]) <= size):
            length += len(items[j][0]) + 1
            j += 1
        group = items[i:j]
        ts = group[0][1]
        if ts is None and duration_seconds:
            ts = int(duration_seconds * group[0][2] / total)
        chunks.append(Chunk(text=" ".join(g[0] for g in group), index=len(chunks), timestamp_seconds=ts))
        if j >= len(items):
            break
        k, back = j, 0
        while k - 1 > i and back + len(items[k - 1][0]) <= overlap:
            k -= 1
            back += len(items[k][0])
        i = k
    return chunks
