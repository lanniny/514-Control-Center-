"""mirror-gate SOUL 送达硬契约回归基线（策 mirror-gate-hard-contract 规格 §3）。

终结 R1-R5 五轮补丁循环的**机械资产**：15 用例覆盖 INV1-9 + partial-write 夹具 + 横切断言。
未来任何人改 mirror-gate.py，必须先跑绿这套基线（且过 §3.4 buggy 必变红元验收）。

运行：python test_mirror_gate_contract.py
横切不变量：每个用例隐含 assert exit0（INV1）+ count_json_segments<=1（INV4/INV5）。
"""
import importlib.util
import unittest.mock as mock
import io, json, os, sys
from pathlib import Path

MG_PATH = str(Path(__file__).resolve().parent.parent / "mirror-gate.py")
spec = importlib.util.spec_from_file_location("mg", MG_PATH)
mg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mg)

AISHARED_514 = "I:/514claude/514cc"  # 真实 514 工作区（有 .ai-shared，供 build_card 真实读）
R = []


def count_json_segments(text):
    """INV4/INV5 断言：stdout 中 additionalContext JSON 段数（'"hookSpecificOutput"' 出现次数）应 ≤ 1。"""
    return text.count('"hookSpecificOutput"')


def json_valid(text):
    """INV4 字面谓词（烛 R6 建议1）：stdout 为空 或 **可 json.loads 解析**。半个 JSON→False（count≤1 掩盖不了）。"""
    if text == "":
        return True
    try:
        json.loads(text)
        return True
    except Exception:
        return False


class HalfWriteStdout(io.StringIO):
    """INV5 核心夹具：write 只吐一半就抛，flush 也崩。模拟 partial-write（带异常）。"""
    def __init__(self):
        super().__init__()
        self._cap = []
    def write(self, s):
        self._cap.append(s[: max(1, len(s) // 2)])   # 只"写"一半
        raise IOError("simulated partial write")
    def flush(self):
        raise IOError("simulated broken pipe")
    def getvalue(self):
        return "".join(self._cap)
    def reconfigure(self, **kw):
        pass


class ShortWriteStdout(io.StringIO):
    """INV5：write 短返回（不抛，返回写入字节数 < len）。"""
    def __init__(self):
        super().__init__()
        self._cap = []
    def write(self, s):
        half = s[: max(1, len(s) // 2)]
        self._cap.append(half)
        return len(half)
    def getvalue(self):
        return "".join(self._cap)
    def reconfigure(self, **kw):
        pass


class FlushBoomStdout(io.StringIO):
    """INV6：write 正常、flush 抛（体检卡写成功但 flush 崩 → 不留痕、不回退）。"""
    def flush(self):
        raise IOError("flush崩")
    def reconfigure(self, **kw):
        pass


def run_main(stdin_str, stdout_obj=None, soul_ret=None, soul_side=None, **patches):
    """白盒跑 main：注入 stdin/stdout + 可选 mock check_soul_drift / build_card / find_aishared。
    返回 (stdout内容, raised)。raised: None=正常return；('exit',code)=SystemExit；('RAISED',类型)=fail-closed 冒泡。"""
    ctx = []
    if soul_ret is not None:
        ctx.append(mock.patch.object(mg, "check_soul_drift", return_value=soul_ret))
    if soul_side is not None:
        ctx.append(mock.patch.object(mg, "check_soul_drift", side_effect=soul_side))
    for name, side in patches.items():
        ctx.append(mock.patch.object(mg, name, side_effect=side))
    for c in ctx:
        c.start()
    si, so = sys.stdin, sys.stdout
    cap = stdout_obj if stdout_obj is not None else io.StringIO()
    sys.stdin = io.StringIO(stdin_str)
    sys.stdout = cap
    raised = None
    try:
        mg.main()
    except SystemExit as e:
        raised = ("exit", e.code)
    except BaseException as e:
        raised = ("RAISED", type(e).__name__)
    finally:
        sys.stdin, sys.stdout = si, so
        for c in ctx:
            c.stop()
    return cap.getvalue(), raised


def chk(name, cond, extra=""):
    R.append((name, bool(cond), extra))


# ---- T1 体检卡 partial-write（INV5 核心；soul=drift 才能暴露旧代码双段）----
cap = HalfWriteStdout()
out, raised = run_main(json.dumps({"cwd": AISHARED_514}), stdout_obj=cap, soul_ret=("drift", "漂移了"))
chk("T1 体检卡partial-write→单段+不崩(INV5)", count_json_segments(out) <= 1 and raised is None, f"seg={count_json_segments(out)} raised={raised}")

# ---- T2 write 短返回（INV5）----
cap = ShortWriteStdout()
out, raised = run_main(json.dumps({"cwd": AISHARED_514}), stdout_obj=cap, soul_ret=("drift", "漂移了"))
chk("T2 write短返回→无第二段(INV5)", count_json_segments(out) <= 1 and raised is None, f"seg={count_json_segments(out)}")

# ---- T3 flush 崩（INV6/INV1）：体检卡 write 成功、flush 崩 → 单段、exit0、无第二 write----
cap = FlushBoomStdout()
out, raised = run_main(json.dumps({"cwd": AISHARED_514}), stdout_obj=cap, soul_ret=("drift", "漂移了"))
chk("T3 flush崩→单段+exit0(INV6/1)", count_json_segments(out) == 1 and raised is None, f"seg={count_json_segments(out)}")

# ---- T4 build_card 崩 + 514 + drift → 单段 SOUL 告警（INV3）----
out, raised = run_main(json.dumps({"cwd": AISHARED_514}), soul_ret=("drift", "漂移了"), build_card=RuntimeError("build崩"))
chk("T4 build_card崩→单段SOUL降级(INV3)", count_json_segments(out) == 1 and "SOUL 全局哨兵" in out and raised is None, f"out={out[:36]}")

# ---- T5 check_soul_drift 崩（INV2）：不假绿，保持默认 unverifiable 送告警----
out, raised = run_main(json.dumps({"cwd": AISHARED_514}), soul_side=RuntimeError("soul崩"))
chk("T5 soul崩→默认unverif送告警不假绿(INV2)", "SOUL 状态计算未完成" in out and raised is None, f"out={out[:36]}")

# ---- T6 畸形 stdin + drift（INV3）----
out, raised = run_main("not json{{{", soul_ret=("drift", "漂移了"))
chk("T6 畸形stdin+drift→SOUL告警(INV3)", count_json_segments(out) == 1 and "漂移了" in out and raised is None, f"out={out[:30]}")

# ---- T7 非字符串 cwd（INV7/INV1）----
out, raised = run_main(json.dumps({"cwd": 123}), soul_ret=("drift", "漂移了"))
chk("T7 非字符串cwd→规范化+SOUL告警(INV7/1)", count_json_segments(out) == 1 and "漂移了" in out and raised is None, "")

# ---- T8 backup 子串路径 + consistent（INV7）：不误判、不写对方 log、静默----
out, raised = run_main(json.dumps({"cwd": "C:/x/514claude-backup/p"}), soul_ret=("consistent", ""))
chk("T8 backup子串+consistent→静默(INV7)", out.strip() == "" and raised is None, f"out='{out.strip()[:24]}'")

# ---- T9 截断 JSON stdin + drift → SOUL 降级（INV3）----
out, raised = run_main("{truncated", soul_ret=("drift", "漂移了"))
chk("T9 截断JSON+drift→SOUL降级(INV3)", count_json_segments(out) == 1 and "漂移了" in out and raised is None, "")

# ---- T10 find_aishared 崩（INV3/INV9）----
out, raised = run_main(json.dumps({"cwd": AISHARED_514}), soul_ret=("drift", "漂移了"), find_aishared=OSError("fs崩"))
chk("T10 find_aishared崩→降级无半段(INV3/9)", count_json_segments(out) <= 1 and raised is None, f"seg={count_json_segments(out)}")

# ---- T11 json.dumps 崩（INV4/INV5）：安全降级、绝不产半段、绝不第二 write----
stdin_t11 = json.dumps({"cwd": AISHARED_514})
with mock.patch.object(mg.json, "dumps", side_effect=ValueError("dumps崩")):
    out, raised = run_main(stdin_t11, soul_ret=("drift", "漂移了"))
chk("T11 json.dumps崩→静默无半段(INV4/5)", count_json_segments(out) == 0 and raised is None, f"out='{out[:20]}'")

# ---- T12 consistent + 非514 → 静默（INV3 反向）----
out, raised = run_main(json.dumps({"cwd": "C:/other/proj"}), soul_ret=("consistent", ""))
chk("T12 consistent+非514→静默(INV3反)", out.strip() == "" and raised is None, f"out='{out.strip()[:20]}'")

# ---- T13 drift + 非514 → 恰一段 SOUL（INV3/INV4）----
out, raised = run_main(json.dumps({"cwd": "C:/other/proj"}), soul_ret=("drift", "漂移了"))
chk("T13 drift+非514→恰一段SOUL(INV3/4)", count_json_segments(out) == 1 and "漂移了" in out and raised is None, "")

# ---- T14 正路完整体检卡（INV4/INV6）：真实 build_card，含"一致 ✓"SOUL 行（留痕 append 无害副作用）----
out, raised = run_main(json.dumps({"cwd": AISHARED_514}), soul_ret=("consistent", ""))
chk("T14 正路→单段体检卡含SOUL一致行(INV4)", count_json_segments(out) == 1 and "自省体检卡" in out and "SOUL 哨兵(全局)：一致 ✓" in out and raised is None, f"seg={count_json_segments(out)}")

# ---- T15 非 ASCII soul_msg（INV8）：不 UnicodeEncodeError、单段可解析----
out, raised = run_main(json.dumps({"cwd": "C:/other/proj"}), soul_ret=("drift", "漂移测试中文字符"))
chk("T15 非ASCII soul_msg→单段不崩(INV8)", count_json_segments(out) == 1 and "漂移测试中文字符" in out and raised is None, "")

# ---- 烛 R6 建议1：INV4 字面守卫（json_valid，不再用 count<=1 近似掩盖半段）----
out, _ = run_main(json.dumps({"cwd": AISHARED_514}), soul_ret=("consistent", ""))
chk("INV4a 正路体检卡→json可解析", json_valid(out), f"valid={json_valid(out)}")
out, _ = run_main(json.dumps({"cwd": "C:/other/proj"}), soul_ret=("drift", "漂移了"))
chk("INV4b 降级SOUL告警→json可解析", json_valid(out), f"valid={json_valid(out)}")
out, _ = run_main("", soul_ret=("consistent", ""))
chk("INV4c 静默→空字符串(INV4)", out == "", f"out='{out[:20]}'")
# partial-write：半段 json_valid=FALSE 是策 §2.4 trade-off 的已知结果——显式暴露，不用 count<=1 掩盖
capp = HalfWriteStdout()
outp, _ = run_main(json.dumps({"cwd": AISHARED_514}), stdout_obj=capp, soul_ret=("drift", "漂移了"))
chk("INV4d partial-write=半段无双段(trade-off显式暴露)", count_json_segments(outp) <= 1, f"json_valid={json_valid(outp)}(半段预期False) seg={count_json_segments(outp)}")

# ---- 烛 R6 建议3：build_payload 返回非3元组 → main fail-open（:359 解包纳入 try，INV1 自足）----
with mock.patch.object(mg, "build_payload", return_value=("card", "x")):
    out, raised = run_main(json.dumps({"cwd": AISHARED_514}))
chk("T16 build_payload返2元组→fail-open(INV1)", raised is None and count_json_segments(out) <= 1, f"raised={raised}")
with mock.patch.object(mg, "build_payload", return_value=7):
    out, raised = run_main(json.dumps({"cwd": AISHARED_514}))
chk("T17 build_payload返int→fail-open(INV1)", raised is None, f"raised={raised}")

# ---- 横切复核：全用例 exit0（INV1）+ 单段（INV4/5）----
for n, ok, dd in R:
    print(f"[{'PASS' if ok else 'FAIL'}] {n}  {dd}")
print(f"\n{'ALL PASS' if all(r[1] for r in R) else 'SOME FAILED'}  ({sum(r[1] for r in R)}/{len(R)})")
sys.exit(0 if all(r[1] for r in R) else 1)   # 烛 R6 建议2：失败反映 exit code（机械可判定资产，可接 CI）
