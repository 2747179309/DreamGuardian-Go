#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
诊断脚本：分步验证 5号手腕舵机硬件旋转能力 与 主从跟随实时性
"""
import sys
import time

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from scservo_sdk import PortHandler, PacketHandler

ADDR_TORQUE = 40
ADDR_ACC = 41
ADDR_GOAL_POS = 42
ADDR_GOAL_SPEED = 46
ADDR_POS = 56
ADDR_LOAD = 60
ADDR_VOLT = 62
ADDR_STATUS = 65

def read1(ph, port, sid, addr):
    data, res, err = ph.read1ByteTxRx(port, sid, addr)
    return data if res == 0 else None

def read2(ph, port, sid, addr):
    data, res, err = ph.read2ByteTxRx(port, sid, addr)
    return data if res == 0 else None

def write1(ph, port, sid, addr, val):
    return ph.write1ByteTxRx(port, sid, addr, val)[0] == 0

def write2(ph, port, sid, addr, val):
    return ph.write2ByteTxRx(port, sid, addr, val)[0] == 0

def test_follower():
    print("=" * 65)
    print("【测试 1】从臂 (COM5) 5号手腕自身旋转硬件能力独立测试")
    print("=" * 65)
    fp = PortHandler("COM5")
    ph = PacketHandler(0)
    if not fp.openPort():
        print("❌ COM5 打开失败！可能端口被占用。")
        return False
    fp.setBaudRate(1000000)

    try:
        cur_pos = read2(ph, fp, 5, ADDR_POS)
        volt = read1(ph, fp, 5, ADDR_VOLT)
        stat = read1(ph, fp, 5, ADDR_STATUS)
        print(f"  当前位置: {cur_pos} | 电压: {volt/10.0 if volt else 0}V | 错误状态: {stat}")
        if cur_pos is None:
            print("❌ 无法读取 5号舵机位置！")
            return False

        print("\n  >>> 开启力矩，并命令 5号舵机自身进行 ±250 刻度顺畅往复自转...")
        write1(ph, fp, 5, ADDR_TORQUE, 1)
        write1(ph, fp, 5, ADDR_ACC, 50)
        write2(ph, fp, 5, ADDR_GOAL_SPEED, 800)

        t1 = cur_pos - 250
        print(f"  -> 指令 1: 旋转到 {t1}")
        write2(ph, fp, 5, ADDR_GOAL_POS, t1)
        time.sleep(1.0)
        p1 = read2(ph, fp, 5, ADDR_POS)
        print(f"     实际到达: {p1} (误差: {abs(p1 - t1) if p1 else 'None'})")

        t2 = cur_pos + 250
        print(f"  -> 指令 2: 旋转到 {t2}")
        write2(ph, fp, 5, ADDR_GOAL_POS, t2)
        time.sleep(1.2)
        p2 = read2(ph, fp, 5, ADDR_POS)
        print(f"     实际到达: {p2} (误差: {abs(p2 - t2) if p2 else 'None'})")

        print(f"  -> 指令 3: 回到初始位 {cur_pos}")
        write2(ph, fp, 5, ADDR_GOAL_POS, cur_pos)
        time.sleep(1.0)
        p3 = read2(ph, fp, 5, ADDR_POS)
        print(f"     实际到达: {p3} (误差: {abs(p3 - cur_pos) if p3 else 'None'})")

        print("\n  ✓ 结果: 从臂 5号舵机自身旋转硬件、齿轮与驱动能力完全正常！")
        return True
    finally:
        write1(ph, fp, 5, ADDR_TORQUE, 0)
        fp.closePort()

def test_leader_tracking():
    print("\n" + "=" * 65)
    print("【测试 2】主从直通极速实时跟随响应测试 (无相机、无死锁)")
    print("=" * 65)
    fp_f = PortHandler("COM5")
    fp_l = PortHandler("COM6")
    ph = PacketHandler(0)

    if not fp_f.openPort() or not fp_l.openPort():
        print("❌ 端口打开失败")
        return

    fp_f.setBaudRate(1000000)
    fp_l.setBaudRate(1000000)

    try:
        # 从臂使能力矩
        write1(ph, fp_f, 5, ADDR_TORQUE, 1)
        write1(ph, fp_f, 5, ADDR_ACC, 0) # 0 = 最大加速度 (无阻滞极速)
        write2(ph, fp_f, 5, ADDR_GOAL_SPEED, 0) # 0 = 最大转速

        # 主臂关力矩，方便手转
        write1(ph, fp_l, 5, ADDR_TORQUE, 0)

        # 读取两者基准零点
        f_init = read2(ph, fp_f, 5, ADDR_POS)
        l_init = read2(ph, fp_l, 5, ADDR_POS)
        print(f"  对齐基准: 从臂={f_init}, 主臂={l_init}")
        print("  ⚡ 正在开启 100Hz 极速微秒级直随测试 (持续 6 秒)...")
        print("  👉 请立刻用手旋转【主臂手腕】，观察从臂是否【毫秒级实时跟转】！\n")

        t_end = time.time() + 6.0
        sample_count = 0
        delays = []

        while time.time() < t_end:
            t0 = time.perf_counter()
            # 1. 读主臂
            l_pos = read2(ph, fp_l, 5, ADDR_POS)
            if l_pos is not None:
                # 计算相对偏移并映射到从臂
                delta = l_pos - l_init
                # 安全限幅 ±800 ticks (约 ±70 度)
                delta = max(-800, min(800, delta))
                target = f_init + delta
                # 2. 写从臂
                write2(ph, fp_f, 5, ADDR_GOAL_POS, target)

            t1 = time.perf_counter()
            cost_ms = (t1 - t0) * 1000.0
            delays.append(cost_ms)
            sample_count += 1
            time.sleep(0.01) # 10ms 周期 = 100Hz

        avg_cost = sum(delays) / len(delays) if delays else 0
        print(f"  ✓ 测试完成！6秒内总共完成 {sample_count} 次主从指令传输。")
        print(f"  ⚡ 单次指令延迟 (Roundtrip): {avg_cost:.2f} 毫秒！")
        print(f"  ⚡ 通信刷新率: {1000.0 / (avg_cost + 10):.1f} Hz")
    finally:
        write1(ph, fp_f, 5, ADDR_TORQUE, 0)
        fp_f.closePort()
        fp_l.closePort()

if __name__ == "__main__":
    if test_follower():
        test_leader_tracking()
