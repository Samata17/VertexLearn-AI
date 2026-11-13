"""Unit tests that need no database, network or API key: `pytest -q`."""
from fastapi.testclient import TestClient

from app import demo
from app.main import app
from app.rag.chunking import chunk_text, split_sentences

TRANSCRIPT = (
    "[00:00] Welcome to sorting algorithms. Today we study quicksort. "
    "[01:30] Quicksort picks a pivot element and partitions the array around it. "
    "Elements smaller than the pivot go left and larger elements go right. "
    "[03:10] On already sorted input, choosing the first element as pivot gives unbalanced partitions. "
    "That is why quicksort degrades to quadratic time on sorted input. "
    "[05:00] Randomized pivot selection avoids this worst case in expectation. "
) * 3


def test_split_sentences():
    s = split_sentences("One sentence. Two sentence! Three?")
    assert s == ["One sentence.", "Two sentence!", "Three?"]


def test_chunking_sizes_and_timestamps():
    chunks = chunk_text(TRANSCRIPT, size=300, overlap=80)
    assert len(chunks) > 2
    assert all(len(c.text) <= 300 + 200 for c in chunks)  # a single long sentence may exceed the size
    assert chunks[0].timestamp_seconds == 0
    assert all("[" not in c.text for c in chunks), "timestamp markers are stripped from chunk text"
    assert any(c.timestamp_seconds and c.timestamp_seconds >= 90 for c in chunks)
    assert [c.index for c in chunks] == list(range(len(chunks)))


def test_chunking_proportional_timestamps_without_markers():
    text = "This is a plain sentence about graphs. " * 60
    chunks = chunk_text(text, size=300, overlap=0, duration_seconds=600)
    assert chunks[0].timestamp_seconds == 0
    assert chunks[-1].timestamp_seconds > 300


def test_empty_text():
    assert chunk_text("") == []


def test_demo_outputs_are_labelled():
    quiz = demo.quiz(TRANSCRIPT, 4)
    assert quiz and all(q["question_text"].startswith("[Demo]") for q in quiz)
    for q in quiz:
        correct = [o for o in q["options"] if o["is_correct"]]
        assert len(correct) == 1
    summary = demo.summarize(TRANSCRIPT, "Quicksort")
    assert "Demo mode" in summary["summary"]
    reply = demo.chat("why quadratic?", [], "beginner")
    assert "Demo mode" in reply


def test_internal_key_required():
    client = TestClient(app)
    r = client.post("/chat", json={"course_id": "x", "question": "hi"})
    assert r.status_code == 401
