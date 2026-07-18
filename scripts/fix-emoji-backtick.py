#!/usr/bin/env python3
"""一次性修复：把人格层颜文字里的 ASCII 反引号 (U+0060) 换成 ´ (U+00B4 acute)。

根因（2026-06-14 定位）：SOUL.md / output-style 的颜文字（如 (ノ´ヮ`)ノ）内嵌 ASCII 反引号，
当含它的内容进入 tool call 参数 / markdown code 边界时，破坏解析 → "tool call malformed"。
反引号在源码里用 chr(0x60) 构造，绝不字面出现，避免"修复脚本本身又触发 malformed"。
视觉等价：´ 与 ` 几乎不可分辨，人格语义零损失。
"""
bt = chr(0x60)   # ` ASCII 反引号
ac = chr(0xB4)   # ´ acute accent（安全替代，视觉近乎相同）
bs = chr(0x5C)   # \ ASCII 反斜杠——JSON 非法转义 \* 的来源，比反引号更可能是真 tool-call 毒
fw = chr(0xFF3C) # ＼ 全角反斜杠（安全替代）

pairs = [
    ("(ノ´ヮ" + bt + ")ノ", "(ノ´ヮ" + ac + ")ノ"),
    ("(*´꒳" + bt + "*)", "(*´꒳" + ac + "*)"),
    ("(´•̥ ω •̥" + bt + ")", "(´•̥ ω •̥" + ac + ")"),
    ("( ´ ▽ " + bt + " )ﾉ", "( ´ ▽ " + ac + " )ﾉ"),
    ("(*/ω" + bs + "*)", "(*/ω" + fw + "*)"),
]

files = [
    r"C:\Users\16643\.claude\CLAUDE.md",                                  # SOUL 单份（全局）
    r"C:\Users\16643\.claude\output-styles\aemeath-meta-butler.md",       # output-style 运行时
    r"I:\514claude\514cc\output-styles\aemeath-meta-butler.md",           # output-style 仓库源（双地落）
]

for f in files:
    s = open(f, encoding="utf-8", newline="").read()   # newline="" 保留原始换行不转换
    total = 0
    for old, new in pairs:
        c = s.count(old)
        total += c
        s = s.replace(old, new)
    open(f, "w", encoding="utf-8", newline="").write(s)
    print(f"{f}  replaced={total}")

# 残留自检：替换后整文件不应再有"颜文字内反引号"（markdown code 的成对反引号是合法的，不计）
print("--- residual check (颜文字内反引号应为 0) ---")
for f in files:
    s = open(f, encoding="utf-8", newline="").read()
    bad = sum(s.count("ヮ" + bt) + s.count("꒳" + bt) + s.count("•̥" + bt) + s.count("▽ " + bt) for _ in [0])
    print(f"{f}  residual={bad}")
