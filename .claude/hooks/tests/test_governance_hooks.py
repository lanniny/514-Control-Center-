from __future__ import annotations

import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


HOOKS = Path(__file__).resolve().parents[1]
REPO = Path(__file__).resolve().parents[3]
CODEX_HOOKS = REPO / ".codex" / "hooks"


def load_hook(module_name: str, filename: str, hook_dir: Path = HOOKS):
    spec = importlib.util.spec_from_file_location(module_name, hook_dir / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


STOP = load_hook("stop_gate_under_test", "stop-gate.py")
ROUTE = load_hook("route_gate_under_test", "route-gate.py")
CODEX_STOP = load_hook("codex_stop_gate_under_test", "stop-gate-codex.py", CODEX_HOOKS)
CODEX_ROUTE = load_hook("codex_route_gate_under_test", "route-gate-codex.py", CODEX_HOOKS)
STOP_MODULES = (("claude", STOP), ("codex", CODEX_STOP))
TEMPLATE_PATHS = (
    REPO / "AGENTS.md",
    REPO / ".agents" / "skills" / "co-review" / "SKILL.md",
    REPO / "skills" / "review" / "codex-reviewer" / "SKILL.md",
    REPO / "skills" / "research" / "grok-researcher" / "SKILL.md",
)
TEMPLATE_AGENTS = {
    REPO / "AGENTS.md": "烛(Codex)",
    REPO / ".agents" / "skills" / "co-review" / "SKILL.md": "烛(Codex)",
    REPO / "skills" / "review" / "codex-reviewer" / "SKILL.md": "烛(Codex)",
    REPO / "skills" / "research" / "grok-researcher" / "SKILL.md": "织(Grok)",
}


def invoke_main(module, payload: object) -> tuple[int, str, str]:
    old_stdin, old_stdout, old_stderr = sys.stdin, sys.stdout, sys.stderr
    stdin = io.StringIO(json.dumps(payload, ensure_ascii=False))
    stdout = io.StringIO()
    stderr = io.StringIO()
    sys.stdin, sys.stdout, sys.stderr = stdin, stdout, stderr
    try:
        try:
            result = module.main()
        except SystemExit as exc:
            code = int(exc.code or 0)
        else:
            code = int(result or 0)
    finally:
        sys.stdin, sys.stdout, sys.stderr = old_stdin, old_stdout, old_stderr
    return code, stdout.getvalue(), stderr.getvalue()


class DeltaGrammarTests(unittest.TestCase):
    def test_only_numeric_score_and_nonempty_evidence_are_valid(self):
        valid = [
            "__DELTA__: 烛(Codex) | 0 | evidence(file.py:12)",
            "__DELTA__: 主驾(Kimi) | 1 | 证据：补强判断",
            "__DELTA__: 织 | 2 | old | new",
        ]
        invalid = [
            "__DELTA__: 烛 | 1补强 | evidence(file.py:12)",
            "__DELTA__: 烛 | 2推翻 | evidence(file.py:12)",
            "__DELTA__: 烛 | 3 | evidence(file.py:12)",
            "__DELTA__: 烛 | 1 |   ",
            "__DELTA__: || 0 | evidence(file.py:12)",
            "__DELTA__: 烛 || 1 | evidence(file.py:12)",
            "__DELTA__:  | 1 | evidence(file.py:12)",
            " __DELTA__: 烛 | 1 | evidence(file.py:12)",
        ]
        for runtime, module in STOP_MODULES:
            for line in valid:
                with self.subTest(runtime=runtime, line=line):
                    self.assertEqual(module.delta_status(line), "valid")
            for line in invalid:
                with self.subTest(runtime=runtime, line=line):
                    expected = "missing" if line.startswith(" ") else "invalid"
                    self.assertEqual(module.delta_status(line), expected)

    def test_one_valid_line_cannot_hide_an_invalid_delta_line(self):
        mixed = (
            "__DELTA__: 烛(Codex) | 1 | evidence(file.py:12)\n"
            "__DELTA__: 主驾(Kimi) | 2推翻 | invalid evidence\n"
        )
        for runtime, module in STOP_MODULES:
            with self.subTest(runtime=runtime):
                self.assertEqual(module.delta_status(mixed), "invalid")

    def test_registry_is_structured_and_covers_kimi(self):
        for runtime, module in STOP_MODULES:
            with self.subTest(runtime=runtime):
                sources = module.load_handoff_sources()
                self.assertEqual(module.handoff_source("kimi-to-all__work.md", sources), "kimi-driver")
                self.assertEqual(
                    module.handoff_source("codex-to-claude__review.md", sources),
                    "codex-reviewer",
                )
                self.assertEqual(module.handoff_source("plain-note.md", sources), None)


class TemplateContractTests(unittest.TestCase):
    def test_templates_require_marker_and_only_show_strict_delta_examples(self):
        for path in TEMPLATE_PATHS:
            with self.subTest(path=path):
                content = path.read_text(encoding="utf-8")
                self.assertIn(
                    "<!-- 514cc-session-id: {session_id_from_route_gate} -->",
                    content,
                )
                self.assertIn("frontmatter", content.lower())
                examples = []
                for line in content.splitlines():
                    candidate = line.strip().strip("`")
                    if candidate.startswith("__DELTA__:"):
                        examples.append(candidate)
                self.assertTrue(examples, "模板必须给出至少一条可复制的 DELTA 示例")
                for example in examples:
                    self.assertEqual(STOP.delta_status(example), "valid")
                    self.assertTrue(
                        example.startswith(f"__DELTA__: {TEMPLATE_AGENTS[path]} |"),
                        f"模板 DELTA agent 与角色不匹配: {path}",
                    )


class HookInputFixtureTests(unittest.TestCase):
    def fixture(self):
        return tempfile.TemporaryDirectory(prefix="514claude-hook-fixture-")

    def write_transcript(self, root: Path) -> Path:
        transcript = root / "session.jsonl"
        started = datetime.now(timezone.utc) - timedelta(seconds=5)
        transcript.write_text(
            json.dumps({"timestamp": started.isoformat(), "type": "user"}) + "\n",
            encoding="utf-8",
        )
        return transcript

    def test_stop_gate_rejects_labeled_score_then_accepts_strict_line(self):
        for runtime, module in STOP_MODULES:
            with self.subTest(runtime=runtime), self.fixture() as raw_root:
                root = Path(raw_root)
                handoff = root / ".ai-shared" / "handoff"
                handoff.mkdir(parents=True)
                transcript = self.write_transcript(root)
                artifact = handoff / "kimi-to-all__fixture.md"
                artifact.write_text(
                    "<!-- 514cc-session-id: session-fixture -->\n"
                    "# fixture\n__DELTA__: 主驾(Kimi) | 1补强 | evidence(file.py:12)\n",
                    encoding="utf-8",
                )
                payload = {
                    "cwd": str(root),
                    "session_id": "session-fixture",
                    "transcript_path": str(transcript),
                }

                code, _, stderr = invoke_main(module, payload)
                self.assertEqual(code, 2)
                self.assertIn("kimi-driver", stderr)
                if runtime == "claude":
                    first_audit = json.loads(
                        (root / ".ai-shared" / "stop-gate.log")
                        .read_text(encoding="utf-8")
                        .splitlines()[-1]
                    )
                    self.assertEqual(first_audit["sessionBinding"], "exact_session_marker")

                code, _, _ = invoke_main(module, payload)
                self.assertEqual(code, 0, "同一会话中同一未修改违规内容只能阻断一次")

                artifact.write_text(
                    "<!-- 514cc-session-id: session-fixture -->\n"
                    "# fixture\n__DELTA__: 主驾(Kimi) | 2推翻 | changed evidence(file.py:13)\n",
                    encoding="utf-8",
                )
                code, _, _ = invoke_main(module, payload)
                self.assertEqual(code, 2, "违规内容改变后必须重新评估并阻断")

                artifact.write_text(
                    "<!-- 514cc-session-id: session-fixture -->\n"
                    "# fixture\n__DELTA__: 主驾(Kimi) | 1 | evidence(file.py:12)\n",
                    encoding="utf-8",
                )
                code, _, stderr = invoke_main(module, payload)
                self.assertEqual(code, 0)
                self.assertEqual(stderr, "")

    def test_exact_marker_blocks_even_without_transcript(self):
        for runtime, module in STOP_MODULES:
            with self.subTest(runtime=runtime), self.fixture() as raw_root:
                root = Path(raw_root)
                handoff = root / ".ai-shared" / "handoff"
                handoff.mkdir(parents=True)
                (handoff / "codex-to-claude__exact.md").write_text(
                    "<!-- 514cc-session-id: exact-session -->\n"
                    "__DELTA__: 烛(Codex) | 1补强 | evidence(file.py:12)\n",
                    encoding="utf-8",
                )
                code, _, _ = invoke_main(
                    module,
                    {"cwd": str(root), "session_id": "exact-session"},
                )
                self.assertEqual(code, 2)

    def test_real_hook_entrypoints_enforce_exact_marker_matrix(self):
        runtime_paths = (
            ("claude", HOOKS / "stop-gate.py"),
            ("codex", CODEX_HOOKS / "stop-gate-codex.py"),
        )
        scenarios = (
            (
                "malformed",
                "<!-- 514cc-session-id: current-session -->\n"
                "__DELTA__: 烛(Codex) | 1补强 | evidence(file.py:12)\n",
                2,
            ),
            (
                "foreign",
                "<!-- 514cc-session-id: foreign-session -->\n"
                "__DELTA__: 烛(Codex) | 1补强 | evidence(file.py:12)\n",
                0,
            ),
            (
                "conflicting",
                "<!-- 514cc-session-id: current-session -->\n"
                "<!-- 514cc-session-id: foreign-session -->\n"
                "__DELTA__: 烛(Codex) | 1补强 | evidence(file.py:12)\n",
                0,
            ),
            (
                "valid",
                "<!-- 514cc-session-id: current-session -->\n"
                "__DELTA__: 烛(Codex) | 1 | evidence(file.py:12)\n",
                0,
            ),
            (
                "mixed",
                "<!-- 514cc-session-id: current-session -->\n"
                "__DELTA__: 烛(Codex) | 1 | evidence(file.py:12)\n"
                "__DELTA__: 烛(Codex) | 2推翻 | evidence(file.py:13)\n",
                2,
            ),
        )
        for runtime, script in runtime_paths:
            for name, content, expected in scenarios:
                with self.subTest(runtime=runtime, scenario=name), self.fixture() as raw_root:
                    root = Path(raw_root)
                    handoff = root / ".ai-shared" / "handoff"
                    handoff.mkdir(parents=True)
                    (handoff / "codex-to-claude__fixture.md").write_text(content, encoding="utf-8")
                    payload = json.dumps(
                        {"cwd": str(root), "session_id": "current-session"},
                        ensure_ascii=False,
                    )
                    result = subprocess.run(
                        [sys.executable, "-B", str(script)],
                        input=payload,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        encoding="utf-8",
                        timeout=10,
                        check=False,
                    )
                    self.assertEqual(result.returncode, expected, result.stderr)

    def test_unmarked_time_window_violation_is_audited_but_cannot_block(self):
        with self.fixture() as raw_root:
            root = Path(raw_root)
            handoff = root / ".ai-shared" / "handoff"
            handoff.mkdir(parents=True)
            transcript = self.write_transcript(root)
            (handoff / "kimi-to-all__other-session.md").write_text(
                "# no exact owner\n__DELTA__: 主驾(Kimi) | 1补强 | evidence(file.py:12)\n",
                encoding="utf-8",
            )
            code, _, _ = invoke_main(
                STOP,
                {
                    "cwd": str(root),
                    "session_id": "session-a",
                    "transcript_path": str(transcript),
                },
            )
            self.assertEqual(code, 0)
            record = json.loads(
                (root / ".ai-shared" / "stop-gate.log").read_text(encoding="utf-8").splitlines()[-1]
            )
            self.assertEqual(record["action"], "allow")
            self.assertEqual(record["sessionBinding"], "session_time_window")
            self.assertEqual(record["reason"], "unverified_time_window_only")
            self.assertEqual(record["unverifiedViolations"][0]["file"], "kimi-to-all__other-session.md")

    def test_concurrent_sessions_merge_state_atomically(self):
        runtime_paths = (
            ("claude", HOOKS / "stop-gate.py", ".stop-gate-state.json"),
            ("codex", CODEX_HOOKS / "stop-gate-codex.py", ".stop-gate-codex-state.json"),
        )
        for runtime, script, state_name in runtime_paths:
            with self.subTest(runtime=runtime), self.fixture() as raw_root:
                root = Path(raw_root)
                handoff = root / ".ai-shared" / "handoff"
                handoff.mkdir(parents=True)
                transcript = self.write_transcript(root)
                for session in ("session-a", "session-b"):
                    (handoff / f"kimi-to-all__{session}.md").write_text(
                        f"<!-- 514cc-session-id: {session} -->\n"
                        f"__DELTA__: 主驾(Kimi) | 1补强 | {session}\n",
                        encoding="utf-8",
                    )

                def start(session: str):
                    payload = json.dumps(
                        {
                            "cwd": str(root),
                            "session_id": session,
                            "transcript_path": str(transcript),
                        },
                        ensure_ascii=False,
                    )
                    process = subprocess.Popen(
                        [sys.executable, "-B", str(script)],
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        encoding="utf-8",
                    )
                    return process, payload

                first = [start(session) for session in ("session-a", "session-b")]
                first_results = [process.communicate(payload, timeout=10) for process, payload in first]
                self.assertEqual([process.returncode for process, _ in first], [2, 2], first_results)
                state = json.loads(
                    (root / ".ai-shared" / state_name).read_text(encoding="utf-8")
                )
                self.assertEqual(len(state["seen"]), 2, "并发写必须锁内合并，不能后写覆盖前写")

                second = [start(session) for session in ("session-a", "session-b")]
                second_results = [process.communicate(payload, timeout=10) for process, payload in second]
                self.assertEqual([process.returncode for process, _ in second], [0, 0], second_results)

    def test_unexpected_internal_error_still_fails_open(self):
        for runtime, module in STOP_MODULES:
            with self.subTest(runtime=runtime):
                original = module.find_aishared
                module.find_aishared = lambda _cwd: (_ for _ in ()).throw(RuntimeError("fixture"))
                try:
                    code, _, _ = invoke_main(
                        module,
                        {"cwd": str(REPO), "session_id": "session-fixture"},
                    )
                finally:
                    module.find_aishared = original
                self.assertEqual(code, 0)

    def test_missing_session_id_is_unknown_and_fail_open_with_audit(self):
        with self.fixture() as raw_root:
            root = Path(raw_root)
            (root / ".ai-shared" / "handoff").mkdir(parents=True)
            code, _, _ = invoke_main(STOP, {"cwd": str(root)})
            self.assertEqual(code, 0)
            records = [
                json.loads(line)
                for line in (root / ".ai-shared" / "stop-gate.log").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(records[-1]["action"], "allow")
            self.assertEqual(records[-1]["sessionBinding"], "unknown")
            self.assertEqual(records[-1]["reason"], "missing_session_id")

    def test_foreign_exact_marker_is_not_claimed_by_this_session(self):
        content = "<!-- 514cc-session-id: other-session -->\nbody"
        binding = STOP.artifact_binding(content, "this-session", 200.0, 100.0)
        self.assertEqual(binding, "foreign_session_marker")

    def test_conflicting_markers_are_never_exact_regardless_of_order(self):
        for content in (
            "<!-- 514cc-session-id: other -->\n<!-- 514cc-session-id: current -->",
            "<!-- 514cc-session-id: current -->\n<!-- 514cc-session-id: other -->",
            "<!-- 514cc-session-id: current -->\n<!-- 514cc-session-id: current -->",
        ):
            with self.subTest(content=content):
                self.assertEqual(
                    STOP.artifact_binding(content, "current", 200.0, 100.0),
                    "conflicting_session_markers",
                )

    def test_route_gate_writes_explicit_unknown_summoned_state(self):
        route_modules = (
            ("claude", ROUTE, "route-gate.log"),
            ("codex", CODEX_ROUTE, "route-gate.codex.log"),
        )
        for runtime, module, log_name in route_modules:
            with self.subTest(runtime=runtime), self.fixture() as raw_root:
                root = Path(raw_root)
                (root / ".ai-shared" / "handoff").mkdir(parents=True)
                code, stdout, _ = invoke_main(
                    module,
                    {"cwd": str(root), "session_id": "route-fixture", "prompt": "继续"},
                )
                self.assertEqual(code, 0)
                self.assertIn("<!-- 514cc-session-id: route-fixture -->", stdout)
                self.assertIn(
                    "__DELTA__: 烛(Codex) | 1 | 证据：file:line 说明新增发现",
                    stdout,
                )
                row = (root / ".ai-shared" / log_name).read_text(encoding="utf-8").strip()
                columns = row.split("\t")
                self.assertGreaterEqual(len(columns), 5)
                self.assertEqual(columns[3], "unknown")

    def test_route_gate_field_drift_and_internal_errors_fail_open(self):
        for runtime, module in (("claude", ROUTE), ("codex", CODEX_ROUTE)):
            for payload in (
                {"cwd": 7, "prompt": "安全评审"},
                {"cwd": str(REPO), "prompt": {"bad": "shape"}},
            ):
                with self.subTest(runtime=runtime, payload=payload):
                    code, _, _ = invoke_main(module, payload)
                    self.assertEqual(code, 0)

            original = module.strip_noise
            module.strip_noise = lambda _text: (_ for _ in ()).throw(RuntimeError("fixture"))
            try:
                code, _, _ = invoke_main(module, {"cwd": str(REPO), "prompt": "安全评审"})
            finally:
                module.strip_noise = original
            self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
