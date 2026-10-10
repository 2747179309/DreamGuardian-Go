#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""完整重定从臂 wrist_roll (ID5)：零位(homing) + 限位(min/max)。

标定对象：从臂 (COM5) 上的 5号舵机 (wrist_roll 手腕旋转舵机)
作用：重新测量 5号舵机的物理中位和两端活动范围，更新舵机硬件 EPROM 并同步本地 LeRobot 标定缓存。

用法：python calibrate_wrist_roll.py
"""
import sys
import time
import json
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from scservo_sdk import PortHandler, PacketHandler

PORT = "COM5"
SERVO_ID = 5

ADDR_POS = 56       # Present_Position
ADDR_MIN = 9        # Min_Position_Limit
ADDR_MAX = 11       # Max_Position_Limit
ADDR_HOMING = 31    # Homing_Offset
ADDR_TORQUE = 40    # Torque_Enable
ADDR_LOCK = 55      # Lock EEPROM (0=unlock, 1=lock)


def read2(ph, port, sid, addr):
    data, result, _ = ph.read2ByteTxRx(port, sid, addr)
    return data if result == 0 else None


def main():
    print("=" * 70)
    print("🎯 SO-ARM101 从臂 5号舵机 (wrist_roll) 专用标定工具")
    print(f"👉 目标端口: {PORT} | 舵机编号: ID {SERVO_ID} (手腕轴向旋转舵机)")
    print("=" * 70)

    port = PortHandler(PORT)
    ph = PacketHandler(0)  # STS3215 -> STS series -> little-endian

    if not port.openPort():
        print(f"[错误] 无法打开串口 {PORT}，请确保没有其他脚本 (如 teleop/eval) 在运行占用！")
        sys.exit(1)
    port.setBaudRate(1000000)
    time.sleep(0.2)

    pos = read2(ph, port, SERVO_ID, ADDR_POS)
    hom = read2(ph, port, SERVO_ID, ADDR_HOMING)
    if pos is None:
        print("[错误] ID 5 舵机无响应，请检查从臂供电与排线！")
        port.closePort()
        sys.exit(1)

    print(f"当前状态：位置={pos}，旧零位偏移={hom}")
    print("正在临时释放 5号舵机扭矩并解锁 EEPROM（可手转手腕）...")
    ph.write1ByteTxRx(port, SERVO_ID, ADDR_TORQUE, 0)
    ph.write1ByteTxRx(port, SERVO_ID, ADDR_LOCK, 0)
    ph.write2ByteTxRx(port, SERVO_ID, ADDR_HOMING, 0)
    ph.write2ByteTxRx(port, SERVO_ID, ADDR_MIN, 0)
    ph.write2ByteTxRx(port, SERVO_ID, ADDR_MAX, 4095)
    time.sleep(0.2)

    print("\n⚠️ 提示：转动手腕时，请观察手腕处的相机 USB 线和夹爪排线，勿过度拉扯绷紧！")
    input("\n① 把手腕往【一个方向】转到底（看线快绷紧即可），然后按回车...")
    a1 = read2(ph, port, SERVO_ID, ADDR_POS)
    input("② 把手腕往【相反方向】转到底（同样留出线缆余量），然后按回车...")
    a2 = read2(ph, port, SERVO_ID, ADDR_POS)

    if a1 is None or a2 is None:
        print("[错误] 读取位置失败，请重试！")
        port.closePort()
        sys.exit(1)

    lo, hi = sorted([a1, a2])
    span = hi - lo
    print(f"\n两端点读数 = {a1}, {a2} -> 范围 [{lo}, {hi}]，活动跨度 {span} 码")

    if span < 1000:
        print("[警告] 跨度过小，可能没转到位，建议按 Ctrl+C 重新运行。")

    middle = (lo + hi) / 2.0
    homing = int(round(middle - 2047))  # 与 lerobot 算法一致：半圈 = 2047
    print(f"物理中位 = {middle:.0f}，计算得到新零位偏移 (Homing Offset) = {homing}")

    p_lo = int(lo - homing)
    p_hi = int(hi - homing)

    # 写入舵机 EEPROM
    ph.write2ByteTxRx(port, SERVO_ID, ADDR_HOMING, homing)
    time.sleep(0.1)
    ph.write2ByteTxRx(port, SERVO_ID, ADDR_MIN, p_lo)
    ph.write2ByteTxRx(port, SERVO_ID, ADDR_MAX, p_hi)
    time.sleep(0.1)
    ph.write1ByteTxRx(port, SERVO_ID, ADDR_LOCK, 1)  # 重新加锁

    r_hom = read2(ph, port, SERVO_ID, ADDR_HOMING)
    r_mn = read2(ph, port, SERVO_ID, ADDR_MIN)
    r_mx = read2(ph, port, SERVO_ID, ADDR_MAX)
    r_pos = read2(ph, port, SERVO_ID, ADDR_POS)
    print(f"\n✓ 舵机硬件写入成功：零位偏移={r_hom}，限位=[{r_mn}, {r_mx}]，当前读数={r_pos}")

    # 自动同步到本地 LeRobot 标定缓存文件 follower.json
    cal_file = Path.home() / ".cache" / "huggingface" / "lerobot" / "calibration" / "robots" / "so101_follower" / "follower.json"
    if cal_file.exists():
        try:
            with open(cal_file, "r", encoding="utf-8") as f:
                cal_data = json.load(f)
            cal_data["wrist_roll"] = {
                "id": 5,
                "drive_mode": 0,
                "homing_offset": homing,
                "range_min": p_lo,
                "range_max": p_hi
            }
            with open(cal_file, "w", encoding="utf-8") as f:
                json.dump(cal_data, f, indent=4)
            print(f"✓ 自动同步更新本地缓存: {cal_file}")
        except Exception as e:
            print(f"⚠️ 更新本地缓存文件失败: {e}")

    print("\n🎉 5号舵机标定与同步全部完成！")
    port.closePort()


if __name__ == "__main__":
    main()
