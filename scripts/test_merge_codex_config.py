#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("merge_codex_config.py")
SPEC = importlib.util.spec_from_file_location("merge_codex_config", MODULE_PATH)
merge = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = merge
SPEC.loader.exec_module(merge)


def source_config(newline="\n"):
    chunks = ['model_verbosity = "medium"']
    for name in merge.MCP_NAMES:
        fields = [f"[mcp_servers.{name}]", 'command = "cmd"', 'args = ["/c", "tool"]']
        if name == "grok-search-rs":
            fields.append(
                'env_vars = ["GROK_SEARCH_RS_COMPAT_API_URL", "GROK_SEARCH_RS_COMPAT_API_KEY", "GROK_SEARCH_RS_COMPAT_MODEL"]'
            )
        fields.extend(["startup_timeout_sec = 30", "tool_timeout_sec = 120"])
        chunks.append(newline.join(fields))
    return (newline + newline).join(chunks) + newline


class MergeCodexConfigTests(unittest.TestCase):
    def test_first_migration_preserves_unmanaged_secret_region(self):
        secret_region = (
            "[mcp_servers.ace-tool]\n"
            'command = "cmd"\n'
            'args = ["--token", "do-not-print"]\n\n'
        )
        current = (
            'model = "gpt"\n\n'
            + secret_region
            + "[projects.'i:\\514claude\\514cc']\ntrust_level = \"trusted\"\n\n"
            + "[projects.'I:\\514claude\\514cc']\ntrust_level = \"trusted\"\n\n"
            + "[mcp_servers.grok-search-rs]\n"
            + 'command = "cmd"\nargs = ["/c", "grok-search-rs"]\n'
            + 'env_vars = ["GROK_SEARCH_API_KEY"]\n'
            + "startup_timeout_sec = 30\ntool_timeout_sec = 120\n"
        )
        candidate = merge.build_candidate(current, source_config())
        parsed = tomllib.loads(candidate)
        self.assertIn(secret_region, candidate)
        matching_projects = [
            key
            for key in parsed["projects"]
            if key.casefold() == merge.PROJECT_PATH.casefold()
        ]
        self.assertEqual(matching_projects, [merge.PROJECT_PATH])
        self.assertEqual(
            parsed["mcp_servers"]["grok-search-rs"]["env_vars"],
            [
                "GROK_SEARCH_RS_COMPAT_API_URL",
                "GROK_SEARCH_RS_COMPAT_API_KEY",
                "GROK_SEARCH_RS_COMPAT_MODEL",
            ],
        )
        self.assertEqual(merge.build_candidate(candidate, source_config()), candidate)

    def test_marker_and_header_text_inside_multiline_string_is_ignored(self):
        current = (
            'message = """\n'
            + merge.START_MARKER
            + "\n[mcp_servers.grok-search-rs]\n"
            + merge.END_MARKER
            + '\n"""\n'
        )
        candidate = merge.build_candidate(current, source_config())
        self.assertEqual(candidate.count(merge.START_MARKER), 2)
        self.assertEqual(merge.build_candidate(candidate, source_config()), candidate)

    def test_malformed_markers_are_rejected(self):
        with self.assertRaisesRegex(merge.MergeError, "Malformed"):
            merge.build_candidate(merge.START_MARKER + "\n", source_config())
        with self.assertRaisesRegex(merge.MergeError, "precedes"):
            merge.build_candidate(
                merge.END_MARKER + "\n" + merge.START_MARKER + "\n", source_config()
            )

    def test_unexpected_direct_key_is_rejected(self):
        current = (
            "[mcp_servers.grok-search-rs]\n"
            'command = "cmd"\nargs = ["/c", "tool"]\n'
            'literal_secret = "preserve-me"\n'
        )
        with self.assertRaisesRegex(merge.MergeError, "unexpected key"):
            merge.build_candidate(current, source_config())

    def test_nested_managed_table_is_rejected(self):
        current = (
            "[mcp_servers.grok-search-rs]\n"
            'command = "cmd"\nargs = ["/c", "tool"]\n\n'
            "[mcp_servers.grok-search-rs.env]\n"
            'TOKEN = "preserve-me"\n'
        )
        with self.assertRaisesRegex(merge.MergeError, "nested child"):
            merge.build_candidate(current, source_config())

    def test_unknown_table_inside_existing_block_is_rejected(self):
        candidate = merge.build_candidate('model = "gpt"\n', source_config())
        poisoned = candidate.replace(
            merge.END_MARKER, "[mcp_servers.unexpected]\ncommand = \"x\"\n\n" + merge.END_MARKER
        )
        with self.assertRaisesRegex(merge.MergeError, "Unexpected table"):
            merge.build_candidate(poisoned, source_config())

    def test_root_key_inside_existing_block_is_rejected(self):
        candidate = merge.build_candidate('model = "gpt"\n', source_config())
        poisoned = candidate.replace(
            "# Generated from", 'root_sentinel = "must-not-disappear"\n# Generated from', 1
        )
        with self.assertRaisesRegex(merge.MergeError, "Unexpected root key"):
            merge.build_candidate(poisoned, source_config())

    def test_dotted_project_key_inside_existing_block_is_rejected(self):
        candidate = merge.build_candidate('model = "gpt"\n', source_config())
        poisoned = candidate.replace(
            "# Generated from", 'projects.unexpected = "must-not-disappear"\n# Generated from', 1
        )
        with self.assertRaisesRegex(merge.MergeError, "Unexpected project key"):
            merge.build_candidate(poisoned, source_config())

    def test_dotted_mcp_key_inside_existing_block_is_rejected(self):
        candidate = merge.build_candidate('model = "gpt"\n', source_config())
        poisoned = candidate.replace(
            "# Generated from", 'mcp_servers.unexpected = "must-not-disappear"\n# Generated from', 1
        )
        with self.assertRaisesRegex(merge.MergeError, "Unexpected MCP key"):
            merge.build_candidate(poisoned, source_config())

    def test_crlf_and_bom_remain_stable(self):
        current = 'model = "gpt"\r\n'
        candidate = merge.build_candidate(current, source_config("\r\n"))
        self.assertNotIn("\n", candidate.replace("\r\n", ""))
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "config.toml"
            merge.atomic_write(path, candidate, True)
            loaded, has_bom = merge.read_utf8(path)
            self.assertTrue(has_bom)
            self.assertEqual(loaded, candidate)

    def test_missing_source_table_is_rejected(self):
        broken_source = source_config().replace(
            "[mcp_servers.fetch]\n", "[mcp_servers.fetch-missing]\n", 1
        )
        with self.assertRaisesRegex(merge.MergeError, "exactly one"):
            merge.build_candidate("", broken_source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
