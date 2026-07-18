#!/usr/bin/env python3
"""Merge the 514cc-managed TOML tables without reserializing user config."""

from __future__ import annotations

import argparse
import os
import re
import sys
import tempfile
import tomllib
from dataclasses import dataclass
from pathlib import Path


START_MARKER = "# >>> 514cc managed block"
END_MARKER = "# <<< 514cc managed block"
PROJECT_PATH = r"I:\514claude\514cc"
MCP_NAMES = (
    "fetch",
    "sequential-thinking",
    "mcp-deepwiki",
    "open-websearch",
    "exa",
    "scrapling",
    "grok-search-rs",
    "serena",
    "playwright",
)
MANAGED_PATHS = (("projects", PROJECT_PATH),) + tuple(
    ("mcp_servers", name) for name in MCP_NAMES
)
UTF8_BOM = b"\xef\xbb\xbf"


class MergeError(RuntimeError):
    pass


@dataclass(frozen=True)
class Header:
    start: int
    line_end: int
    path: tuple[str, ...]
    is_array: bool


@dataclass(frozen=True)
class ScanResult:
    headers: tuple[Header, ...]
    starts: tuple[tuple[int, int], ...]
    ends: tuple[tuple[int, int], ...]


def _find_probe(node: object, path: tuple[str, ...] = (), in_array: bool = False):
    if isinstance(node, dict):
        if node.get("__probe__") is True:
            return path, in_array
        for key, value in node.items():
            found = _find_probe(value, path + (key,), in_array)
            if found is not None:
                return found
    elif isinstance(node, list):
        for value in node:
            found = _find_probe(value, path, True)
            if found is not None:
                return found
    return None


def _parse_header(line: str):
    candidate = line.rstrip("\r\n")
    if not candidate.lstrip().startswith("["):
        return None
    try:
        parsed = tomllib.loads(candidate + "\n__probe__ = true\n")
    except tomllib.TOMLDecodeError:
        return None
    return _find_probe(parsed)


def _advance_multiline_state(line: str, state: str | None) -> str | None:
    i = 0
    while i < len(line):
        if state == "basic":
            if line.startswith('"""', i):
                backslashes = 0
                j = i - 1
                while j >= 0 and line[j] == "\\":
                    backslashes += 1
                    j -= 1
                if backslashes % 2 == 0:
                    state = None
                    i += 3
                    continue
            i += 1
            continue
        if state == "literal":
            if line.startswith("'''", i):
                state = None
                i += 3
                continue
            i += 1
            continue

        char = line[i]
        if char == "#":
            break
        if line.startswith('"""', i):
            state = "basic"
            i += 3
            continue
        if line.startswith("'''", i):
            state = "literal"
            i += 3
            continue
        if char == '"':
            i += 1
            while i < len(line):
                if line[i] == "\\":
                    i += 2
                    continue
                if line[i] == '"':
                    i += 1
                    break
                i += 1
            continue
        if char == "'":
            end = line.find("'", i + 1)
            i = len(line) if end < 0 else end + 1
            continue
        i += 1
    return state


def scan_toml(text: str) -> ScanResult:
    headers: list[Header] = []
    starts: list[tuple[int, int]] = []
    ends: list[tuple[int, int]] = []
    state: str | None = None
    offset = 0
    for line in text.splitlines(keepends=True):
        line_end = offset + len(line)
        if state is None:
            stripped = line.rstrip("\r\n").strip()
            if stripped == START_MARKER:
                starts.append((offset, line_end))
            elif stripped == END_MARKER:
                ends.append((offset, line_end))
            parsed_header = _parse_header(line)
            if parsed_header is not None:
                path, is_array = parsed_header
                headers.append(Header(offset, line_end, path, is_array))
        state = _advance_multiline_state(line, state)
        offset = line_end

    if offset < len(text):
        line = text[offset:]
        if state is None:
            stripped = line.strip()
            if stripped == START_MARKER:
                starts.append((offset, len(text)))
            elif stripped == END_MARKER:
                ends.append((offset, len(text)))
            parsed_header = _parse_header(line)
            if parsed_header is not None:
                path, is_array = parsed_header
                headers.append(Header(offset, len(text), path, is_array))
    return ScanResult(tuple(headers), tuple(starts), tuple(ends))


def _canonical_managed_path(path: tuple[str, ...]):
    if len(path) >= 2 and path[0] == "projects":
        if path[1].casefold() == PROJECT_PATH.casefold():
            return ("projects", PROJECT_PATH), len(path) == 2
    if len(path) >= 2 and path[0] == "mcp_servers" and path[1] in MCP_NAMES:
        return ("mcp_servers", path[1]), len(path) == 2
    return None


def _table_spans(text: str, headers: tuple[Header, ...]):
    spans: list[tuple[Header, int]] = []
    for index, header in enumerate(headers):
        end = headers[index + 1].start if index + 1 < len(headers) else len(text)
        spans.append((header, end))
    return spans


def _get_table(document: dict, path: tuple[str, ...]):
    current: object = document
    for segment in path:
        if not isinstance(current, dict) or segment not in current:
            raise MergeError("TOML table path could not be resolved: " + ".".join(path))
        current = current[segment]
    if not isinstance(current, dict):
        raise MergeError("Managed path is not a TOML table: " + ".".join(path))
    return current


def _parse_document(text: str, label: str):
    try:
        return tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise MergeError(f"{label} is not valid TOML: {exc}") from None


def _extract_table_keys(table_text: str, raw_path: tuple[str, ...]):
    document = _parse_document(table_text, "Managed table")
    return set(_get_table(document, raw_path))


def _normalize_newlines(text: str, newline: str):
    return re.sub(r"\r\n|\r|\n", newline, text)


def build_canonical_block(source_text: str, newline: str):
    source_document = _parse_document(source_text, "Repository Codex config")
    scanned = scan_toml(source_text)
    spans = _table_spans(source_text, scanned.headers)
    table_texts: dict[tuple[str, ...], str] = {}
    key_sets: dict[tuple[str, ...], set[str]] = {
        ("projects", PROJECT_PATH): {"trust_level"}
    }

    for name in MCP_NAMES:
        path = ("mcp_servers", name)
        matches = [
            (header, end)
            for header, end in spans
            if not header.is_array and header.path == path
        ]
        if len(matches) != 1:
            raise MergeError(
                f"Repository source must contain exactly one [{'.'.join(path)}] table; found {len(matches)}."
            )
        for header in scanned.headers:
            if len(header.path) > 2 and header.path[:2] == path:
                raise MergeError(f"Repository managed table has nested child: {'.'.join(header.path)}")
        header, end = matches[0]
        raw = source_text[header.start:end].rstrip()
        table_texts[path] = _normalize_newlines(raw, newline)
        key_sets[path] = set(_get_table(source_document, path))

    parts = [
        START_MARKER,
        r"# Generated from I:\514claude\514cc\.codex\config.toml by scripts\sync-codex-runtime.ps1.",
        "# User-specific providers, marketplaces, hook trust, and literal secrets stay outside this block.",
        "[projects.'I:\\514claude\\514cc']" + newline + 'trust_level = "trusted"',
    ]
    parts.extend(table_texts[("mcp_servers", name)] for name in MCP_NAMES)
    parts.append(END_MARKER)
    return (newline + newline).join(parts) + newline, key_sets


def _validate_markers(scanned: ScanResult):
    if len(scanned.starts) != len(scanned.ends) or len(scanned.starts) > 1:
        raise MergeError(
            f"Malformed 514cc managed markers: start={len(scanned.starts)} end={len(scanned.ends)}."
        )
    if not scanned.starts:
        return None
    start = scanned.starts[0]
    end = scanned.ends[0]
    if start[0] >= end[0]:
        raise MergeError("Malformed 514cc managed markers: end marker precedes start marker.")
    return start[0], end[1]


def _append_block(base: str, block: str, newline: str):
    if not base:
        return block
    if base.endswith(newline + newline):
        separator = ""
    elif base.endswith(newline):
        separator = newline
    else:
        separator = newline + newline
    return base + separator + block


def build_candidate(current_text: str, source_text: str):
    _parse_document(current_text, "Runtime Codex config")
    newline = "\r\n" if "\r\n" in current_text else "\n"
    block, canonical_keys = build_canonical_block(source_text, newline)
    scanned = scan_toml(current_text)
    block_span = _validate_markers(scanned)
    spans = _table_spans(current_text, scanned.headers)
    managed_spans: list[tuple[Header, int, tuple[str, ...]]] = []

    for header, end in spans:
        managed = _canonical_managed_path(header.path)
        if managed is None:
            continue
        canonical_path, is_base = managed
        if header.is_array:
            raise MergeError("Managed path cannot be an array-of-tables: " + ".".join(header.path))
        if not is_base:
            raise MergeError("Managed table has nested child: " + ".".join(header.path))
        keys = _extract_table_keys(current_text[header.start:end], header.path)
        unexpected = sorted(keys - canonical_keys[canonical_path])
        if unexpected:
            raise MergeError(
                "Refusing to replace "
                + ".".join(header.path)
                + " with unexpected key(s): "
                + ", ".join(unexpected)
            )
        managed_spans.append((header, end, canonical_path))

    if block_span is not None:
        block_start, block_end = block_span
        block_document = _parse_document(
            current_text[block_start:block_end], "Existing 514cc managed block"
        )
        unexpected_root_keys = sorted(
            set(block_document) - {"projects", "mcp_servers"}
        )
        if unexpected_root_keys:
            raise MergeError(
                "Unexpected root key inside managed block: "
                + ", ".join(unexpected_root_keys)
            )
        inside = [item for item in managed_spans if block_start < item[0].start < block_end]
        outside = [item for item in managed_spans if item not in inside]
        if outside:
            names = sorted(".".join(item[0].path) for item in outside)
            raise MergeError("Managed table exists outside marker block: " + ", ".join(names))
        headers_inside = [
            header for header in scanned.headers if block_start < header.start < block_end
        ]
        unknown = [
            header for header in headers_inside if _canonical_managed_path(header.path) is None
        ]
        if unknown:
            raise MergeError(
                "Unexpected table inside managed block: "
                + ", ".join(sorted(".".join(header.path) for header in unknown))
            )
        project_entries = block_document.get("projects", {})
        unexpected_project_keys = sorted(
            str(key)
            for key in project_entries
            if str(key).casefold() != PROJECT_PATH.casefold()
        )
        if unexpected_project_keys:
            raise MergeError(
                "Unexpected project key inside managed block: "
                + ", ".join(unexpected_project_keys)
            )
        mcp_entries = block_document.get("mcp_servers", {})
        unexpected_mcp_keys = sorted(set(mcp_entries) - set(MCP_NAMES))
        if unexpected_mcp_keys:
            raise MergeError(
                "Unexpected MCP key inside managed block: "
                + ", ".join(unexpected_mcp_keys)
            )
        counts = {path: 0 for path in MANAGED_PATHS}
        for _header, _end, canonical_path in inside:
            counts[canonical_path] += 1
        bad = [".".join(path) for path, count in counts.items() if count != 1]
        if bad:
            raise MergeError("Managed block must contain each managed table exactly once: " + ", ".join(bad))
        candidate = current_text[:block_start] + block + current_text[block_end:]
    else:
        base = current_text
        for header, end, _canonical_path in sorted(
            managed_spans, key=lambda item: item[0].start, reverse=True
        ):
            base = base[: header.start] + base[end:]
        candidate = _append_block(base, block, newline)

    _parse_document(candidate, "Merged Codex config")
    return candidate


def read_utf8(path: Path):
    if not path.exists():
        return "", False
    data = path.read_bytes()
    has_bom = data.startswith(UTF8_BOM)
    try:
        return data.decode("utf-8-sig"), has_bom
    except UnicodeDecodeError as exc:
        raise MergeError(f"{path} is not UTF-8: {exc}") from None


def atomic_write(path: Path, text: str, with_bom: bool):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (UTF8_BOM if with_bom else b"") + text.encode("utf-8")
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".tmp-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def run(argv: list[str] | None = None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)

    try:
        source, _ = read_utf8(args.source)
        current, has_bom = read_utf8(args.target)
        candidate = build_candidate(current, source)
        second = build_candidate(candidate, source)
        if second != candidate:
            raise MergeError("Codex config merge is not byte-idempotent.")
        if candidate == current:
            print("config-managed-block = consistent")
            return 0
        if args.check:
            print("config-managed-block != drift")
            return 1
        atomic_write(args.target, candidate, has_bom)
        written, _ = read_utf8(args.target)
        _parse_document(written, "Written Codex config")
        if build_candidate(written, source) != written:
            raise MergeError("Post-write idempotence check failed.")
        print("config-managed-block ok merged")
        return 0
    except MergeError as exc:
        print(f"config-managed-block x {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(run())
