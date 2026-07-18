"""§3.4 元验收：基线必须能捕获 R1-R5 的历史 bug（防假基线）。

把 mirror-gate 回退到各轮 buggy 送达逻辑，对应 INV 用例**必须变红**。
若某 buggy 下对应用例仍绿 → 该用例是假的、没真守边界，必须重写。
这是终结五轮循环的解药——"测试测试本身"，防第六轮基线又是一套自我安慰的绿灯。

运行：python test_meta_baseline.py
"""
import importlib.util
import unittest.mock as mock
import io, json, sys
from pathlib import Path

MG_PATH = str(Path(__file__).resolve().parent.parent / "mirror-gate.py")
spec = importlib.util.spec_from_file_location("mg", MG_PATH)
mg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mg)

AISHARED_514 = "I:/514claude/514cc"
R = []


def count_seg(t):
    return t.count('"hookSpecificOutput"')


class HalfWrite(io.StringIO):
    """partial-write：write 吐一半就抛，flush 也崩。"""
    def __init__(s):
        super().__init__(); s._c = []
    def write(s, x):
        s._c.append(x[: max(1, len(x) // 2)]); raise IOError("partial")
    def flush(s):
        raise IOError("pipe")
    def getvalue(s):
        return "".join(s._c)
    def reconfigure(s, **k):
        pass


def drive(buggy_main, stdin_str, stdout_obj=None, soul_ret=None, soul_side=None, **patches):
    """用 buggy_main 替换 mg.main，注入 stdin/stdout + 可选 mock，跑一次。返回 (out, raised)。"""
    ctx = [mock.patch.object(mg, "main", buggy_main)]
    if soul_ret is not None:
        ctx.append(mock.patch.object(mg, "check_soul_drift", return_value=soul_ret))
    if soul_side is not None:
        ctx.append(mock.patch.object(mg, "check_soul_drift", side_effect=soul_side))
    for n, s in patches.items():
        ctx.append(mock.patch.object(mg, n, side_effect=s))
    for c in ctx:
        c.start()
    si, so = sys.stdin, sys.stdout
    cap = stdout_obj if stdout_obj is not None else io.StringIO()
    sys.stdin = io.StringIO(stdin_str); sys.stdout = cap
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


def expect_red(name, baseline_pass_cond, extra=""):
    """baseline_pass_cond = 基线用例的通过条件。buggy 下**应为 False（红）**。记录 not cond。"""
    R.append((name, not baseline_pass_cond, extra))


# ===== R5 buggy：两输出点 + write 崩回退 emit（双写）→ T1 应红 =====
def buggy_r5_main():
    soul_state, soul_msg = "unverifiable", "默认"
    try:
        soul_state, soul_msg = mg.check_soul_drift()
    except Exception:
        pass

    def emit():  # 第二输出点（病根）
        if soul_state == "consistent":
            return
        try:
            sys.stdout.write(json.dumps(mg._wrap_soul(soul_msg), ensure_ascii=False)); sys.stdout.flush()
        except Exception:
            pass
    try:
        raw = sys.stdin.read(); data = json.loads(raw) if raw else None
    except Exception:
        data = None
    cwd = mg._parse_cwd(data)
    if mg._anchor_match(cwd):
        aishared = mg.find_aishared(cwd)
        if aishared is not None:
            cw = False
            try:
                card = mg.build_card(aishared, soul_state, soul_msg)
                sys.stdout.write(json.dumps(mg._wrap_card(card), ensure_ascii=False))  # 第一输出点
                cw = True; sys.stdout.flush(); return
            except Exception:
                if cw:
                    return
                pass  # R5 bug：write 崩且 cw 尚 False（partial-write）→ 落 emit 双写
    emit()


cap = HalfWrite()
out, _ = drive(buggy_r5_main, json.dumps({"cwd": AISHARED_514}), stdout_obj=cap, soul_ret=("drift", "漂移了"))
expect_red("R5双写buggy → T1(count<=1)应红", count_seg(out) <= 1, f"seg={count_seg(out)}（应>=2）")


# ===== R3 buggy：build_card 崩不降级 SOUL（构造链耦合）→ T4 应红 =====
def buggy_r3_main():
    try:
        soul_state, soul_msg = mg.check_soul_drift()
    except Exception:
        soul_state, soul_msg = "unverifiable", "默认"
    try:
        raw = sys.stdin.read(); data = json.loads(raw) if raw else None
    except Exception:
        data = None
    cwd = mg._parse_cwd(data)
    if mg._anchor_match(cwd):
        aishared = mg.find_aishared(cwd)
        if aishared is not None:
            card = mg.build_card(aishared, soul_state, soul_msg)  # R3 bug：崩则冒泡，无 safe 降级
            sys.stdout.write(json.dumps(mg._wrap_card(card), ensure_ascii=False)); return
    if soul_state != "consistent":
        sys.stdout.write(json.dumps(mg._wrap_soul(soul_msg), ensure_ascii=False))


out, raised = drive(buggy_r3_main, json.dumps({"cwd": AISHARED_514}), soul_ret=("drift", "漂移了"), build_card=RuntimeError("build崩"))
expect_red("R3耦合buggy → T4(单段SOUL降级)应红", count_seg(out) == 1 and "SOUL 全局哨兵" in out, f"seg={count_seg(out)} raised={raised}")


# ===== R2 buggy：非514 不送 SOUL（cwd 门控吞告警）→ T13 应红 =====
def buggy_r2_main():
    try:
        soul_state, soul_msg = mg.check_soul_drift()
    except Exception:
        soul_state, soul_msg = "unverifiable", "默认"
    try:
        raw = sys.stdin.read(); data = json.loads(raw) if raw else None
    except Exception:
        data = None
    cwd = mg._parse_cwd(data)
    if mg._anchor_match(cwd):  # R2 bug：SOUL 告警困在 514 门控内，非514 静默丢失
        aishared = mg.find_aishared(cwd)
        if aishared is not None:
            card = mg.build_card(aishared, soul_state, soul_msg)
            sys.stdout.write(json.dumps(mg._wrap_card(card), ensure_ascii=False))
    # 非514 → 什么都不送


out, _ = drive(buggy_r2_main, json.dumps({"cwd": "C:/other/proj"}), soul_ret=("drift", "漂移了"))
expect_red("R2门控buggy → T13(非514送SOUL)应红", count_seg(out) == 1 and "漂移了" in out, f"seg={count_seg(out)}（应0）")


# ===== R1 buggy：check 崩当 consistent（假绿灯）→ T5 应红 =====
def buggy_r1_main():
    try:
        soul_state, soul_msg = mg.check_soul_drift()
    except Exception:
        soul_state, soul_msg = "consistent", ""  # R1 bug：核验失败冒充一致
    try:
        raw = sys.stdin.read(); data = json.loads(raw) if raw else None
    except Exception:
        data = None
    cwd = mg._parse_cwd(data)
    if mg._anchor_match(cwd):
        aishared = mg.find_aishared(cwd)
        if aishared is not None:
            card = mg.build_card(aishared, soul_state, soul_msg)
            sys.stdout.write(json.dumps(mg._wrap_card(card), ensure_ascii=False)); return
    if soul_state != "consistent":
        sys.stdout.write(json.dumps(mg._wrap_soul(soul_msg), ensure_ascii=False))


out, _ = drive(buggy_r1_main, json.dumps({"cwd": AISHARED_514}), soul_side=RuntimeError("soul崩"))
expect_red("R1假绿buggy → T5(送无法核验)应红", "SOUL 状态计算未完成" in out, f"out={out[:40]}（应无'计算未完成'）")


for n, ok, dd in R:
    print(f"[{'RED-OK' if ok else 'FALSE-GREEN!'}] {n}  {dd}")
print(f"\n{'元验收通过：基线真守边界' if all(r[1] for r in R) else '❌ 有假基线用例，必须重写'}  ({sum(r[1] for r in R)}/{len(R)})")
sys.exit(0 if all(r[1] for r in R) else 1)   # 烛 R6 建议2：机械可判定（buggy 未变红即 exit 1）
