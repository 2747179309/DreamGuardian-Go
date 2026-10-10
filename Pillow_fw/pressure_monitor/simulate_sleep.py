#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DreamGuardian 压力模块 —— 睡眠不佳 / 梦魇 判定规则模拟
输入：每 500ms 一帧 pressure_change (0~1)、pressure_contact (0~1)
"""

import random

FRAME_S = 0.5  # 每帧 0.5 秒

# ============ 可调阈值（故意放宽，方便模拟触发） ============
ACT_THRESH = 0.30        # 明显动作：change >= 0.30
VIOLENT_THRESH = 0.50    # 剧烈动作：change >= 0.50

POOR_WIN_S = 60.0        # 睡眠不佳观察窗口 60s
POOR_MIN_ACTS = 15       # 窗口内明显动作帧数 >= 15
POOR_AVG = 0.15          # 或窗口内平均 change >= 0.15

NIGHT_WIN_S = 10.0       # 梦魇观察窗口 10s
NIGHT_MIN_VIOLENT = 4    # 窗口内剧烈动作帧数 >= 4
NIGHT_PEAK = 0.50        # 窗口峰值 >= 0.50


def classify(change_series, contact_series=None):
    """
    滑窗判定整段序列。
    返回 (poor_flags, nightmare_times_s)
    poor_flags[i] : 第 i 帧时是否处于"睡眠不佳"
    nightmare_times_s : 梦魇事件爆发时间点列表（秒）
    """
    win_poor = int(POOR_WIN_S / FRAME_S)
    win_night = int(NIGHT_WIN_S / FRAME_S)
    n = len(change_series)

    poor_flags = []
    night_events = []
    prev_night = False

    for i in range(n):
        # ---- 睡眠不佳（60s 窗）----
        lo = max(0, i - win_poor + 1)
        seg = change_series[lo:i + 1]
        acts = sum(1 for c in seg if c >= ACT_THRESH)
        avg = sum(seg) / len(seg)
        poor_flags.append((acts >= POOR_MIN_ACTS) or (avg >= POOR_AVG))

        # ---- 梦魇（10s 窗，上升沿触发）----
        is_night = False
        if i + 1 >= win_night:
            lo2 = i - win_night + 1
            seg2 = change_series[lo2:i + 1]
            violent = sum(1 for c in seg2 if c >= VIOLENT_THRESH)
            peak = max(seg2)

            struggle = False
            if contact_series:
                cs = contact_series[lo2:i + 1]
                if cs[0] >= 0.5 and min(cs) <= 0.2:
                    struggle = True

            is_night = (peak >= NIGHT_PEAK and violent >= NIGHT_MIN_VIOLENT) or struggle

        # 上升沿触发 + 15s 冷却，避免同一次爆发被重复计数
        if is_night and not prev_night:
            if not night_events or i - night_events[-1] >= int(15 / FRAME_S):
                night_events.append(i)
        prev_night = is_night

    nightmare_times = [idx * FRAME_S for idx in night_events]

    return poor_flags, nightmare_times


# ============ 模拟数据生成 ============
def sim_normal(seconds):
    """正常睡眠：基本不动，偶尔小幅翻身"""
    n = int(seconds / FRAME_S)
    ch = [0.03 + 0.05 * random.random() for _ in range(n)]
    for _ in range(seconds // 30):  # 偶尔翻个身
        i = random.randint(0, n - 1)
        ch[i] = 0.25
    return ch


def sim_poor(seconds):
    """睡眠不佳：频繁翻身扭动，change 0.2~0.5 反复出现"""
    n = int(seconds / FRAME_S)
    ch = []
    for i in range(n):
        # 每 3~5 秒来一波翻身
        if i % random.randint(6, 10) < 3:
            ch.append(0.25 + 0.25 * random.random())
        else:
            ch.append(0.05 + 0.08 * random.random())
    return ch


def sim_nightmare(seconds):
    """梦魇：前 40s 平静，40~50s 剧烈爆发挣扎，之后恢复平静"""
    n = int(seconds / FRAME_S)
    ch = [0.03 + 0.05 * random.random() for _ in range(n)]
    for i in range(int(40 / FRAME_S), int(50 / FRAME_S)):
        ch[i] = 0.55 + 0.35 * random.random()  # 爆发 0.55~0.9
    return ch


def report(name, ch, contact=None):
    poor, nights = classify(ch, contact)
    poor_cnt = sum(1 for p in poor if p)
    poor_pct = 100.0 * poor_cnt / len(poor)
    print(f"【{name}】 时长 {len(ch)*FRAME_S:.0f}s")
    print(f"  平均change={sum(ch)/len(ch):.2f}  峰值={max(ch):.2f}")
    if nights:
        verdict = "💀 梦魇发作"
    elif poor_cnt > len(ch) * 0.3:
        verdict = "⚠️ 睡眠不佳"
    else:
        verdict = "✅ 正常"
    print(f"  判定: {verdict}    (睡眠不佳占比 {poor_pct:.0f}%)")
    if nights:
        print(f"  梦魇事件 {len(nights)} 次 @ {[f'{t:.0f}s' for t in nights]}")
    print()


if __name__ == "__main__":
    random.seed(42)
    report("正常睡眠", sim_normal(120))
    report("睡眠不佳", sim_poor(120))
    report("梦魇发作", sim_nightmare(90))
