"""
Minimal JSON-Schema checker for the AI's structured outputs.

Vertex AI is asked to follow each feature's JSON schema, and we still verify the result here before using
it (quizzes are saved to the database, so a malformed answer must never get through). Only the keywords our
schemas use are supported: type, properties, required, additionalProperties, items, enum. Unknown keywords
such as "description" are ignored. No extra dependency needed.
"""
from __future__ import annotations

from typing import Any

_TYPES: dict[str, Any] = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
}


def _type_ok(value: Any, expected: str) -> bool:
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "null":
        return value is None
    py = _TYPES.get(expected)
    return py is not None and isinstance(value, py)


def errors(value: Any, schema: dict, path: str = "$") -> list[str]:
    """Returns a list of problems (empty = valid)."""
    out: list[str] = []
    expected = schema.get("type")
    if expected is not None:
        options = expected if isinstance(expected, list) else [expected]
        if not any(_type_ok(value, t) for t in options):
            return [f"{path}: expected {expected}, got {type(value).__name__}"]
    if "enum" in schema and value not in schema["enum"]:
        out.append(f"{path}: {value!r} is not one of {schema['enum']}")
    if isinstance(value, dict):
        props: dict = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                out.append(f"{path}: missing required field '{key}'")
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in props:
                    out.append(f"{path}: unexpected field '{key}'")
        for key, sub in props.items():
            if key in value:
                out.extend(errors(value[key], sub, f"{path}.{key}"))
    if isinstance(value, list) and isinstance(schema.get("items"), dict):
        for i, item in enumerate(value):
            out.extend(errors(item, schema["items"], f"{path}[{i}]"))
    return out


def is_valid(value: Any, schema: dict) -> bool:
    return not errors(value, schema)
