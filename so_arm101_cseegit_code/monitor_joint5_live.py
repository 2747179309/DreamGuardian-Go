#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
SO-ARM101 5号舵机 (wrist_roll) 实时掉电与保护状态探针
一边转动机械臂，一边实时监测 5号舵机的供电电压、力矩开关、负载电流和过载报警。
"""

import sys
import time

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from scservo_sdk import PortHandler, PacketHandler

ADDR_POS = 56
ADDR_TORQUE = 40
ADDR_VOLT = 62
ADDR_LOAD = 60
ADDR_TEMP = 63
ADDR_STATUS = 65

def read1(ph, port, sid, addr):
    data, res, err = ph.read1ByteTxRx(port, sid, addr)
    return data if res == 0 else None

def read2(ph, port, sid, addr):
    data, res, err = ph.read2ByteTxRx(port, sid, addr)
    return data if res == 0 else None

def main():
    print("=" * 75)
    print("🔍 5号舵机 (wrist_roll) 实时供电与保护状态探针 (COM5 Follower)")
    print("=" * 75)
    print("👉 请运行此脚本，同时用手或示教臂旋转手腕，当感觉'卡住/掉电'时看本终端变化！")
    print("   按 [Ctrl+C] 退出监测。")
    print("-" * 75)

    fp = PortHandler("COM5")
    ph = PacketHandler(0)

    if not fp.openPort():
        print("[ERROR] 无法打开 COM5，请先关闭正在运行的遥操作脚本！")
        return
    fp.setBaudRate(1000000)

    try:
        while True:
            pos = read2(ph, fp, 5, ADDR_POS)
            volt = read1(ph, fp, 5, ADDR_VOLT)
            tq = read1(ph, fp, 5, ADDR_TORQUE)
            load = read2(ph, fp, 5, ADDR_LOAD)
            temp = read1(ph, fp, 5, ADDR_TEMP)
            stat = read1(ph, fp, 5, ADDR_STATUS)

            if pos is None or volt is None:
                state_str = "❌ 彻底断联/掉电！(排线被扯脱接触不良)"
                volt_str = "0.0V"
                tq_str = "OFF"
                load_str = "N/A"
            else:
                volt_str = f"{volt/10.0:.1f}V"
                tq_str = "ON(锁死)" if tq == 1 else "OFF(掉力矩)"
                load_str = f"{load}"
                
                alarms = []
                if stat:
                    if stat & 0x01: alarms.append("电压异常")
                    if stat & 0x04: alarms.append("过温")
                    if stat & 0x08: alarms.append("过流")
                    if stat & 0x20: alarms.append("过载堵转")
                
                if alarms:
                    state_str = f"⚠️ 保护跳闸: {', '.join(alarms)}"
                elif tq == 0:
                    state_str = "⚠️ 力矩关闭 (软掉)"
                elif pos >= 3980 or pos <= 110:
                    state_str = "⚠️ 撞到了物理限位死区！"
                else:
                    state_str = "✓ 状态正常"

            print(f"位置: {str(pos):>4} | 电压: {volt_str:>5} | 力矩: {tq_str:>7} | 负载: {load_str:>4} | {state_str}", end="\r")
            time.sleep(0.08)

    except KeyboardInterrupt:
        print("\n\n[停止] 监测结束。")
    finally:
        fp.closePort()

if __name__ == "__main__":
    main()
