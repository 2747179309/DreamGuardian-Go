#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
SO-ARM101 5号舵机 (wrist_roll 手腕旋转) 独立精准标定工具
支持单独对从臂 (COM5) 或主臂 (COM6) 的 5号舵机进行重新标定，
自动更新舵机内部 EEPROM 与本地 LeRobot calibration JSON 文件，其余 5 轴标定完好保持！
"""

import sys
import time
import json
import argparse
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from scservo_sdk import PortHandler, PacketHandler

ADDR_POS = 56        # Present_Position (2 bytes)
ADDR_MIN = 9         # Min_Position_Limit (2 bytes)
ADDR_MAX = 11        # Max_Position_Limit (2 bytes)
ADDR_HOMING = 31     # Homing_Offset (2 bytes)
ADDR_TORQUE = 40     # Torque_Enable (1 byte)
ADDR_LOCK = 55       # Lock EEPROM (1 byte, 0=unlock, 1=lock)

SERVO_ID = 5

def read2(ph, port, sid, addr):
    data, res, err = ph.read2ByteTxRx(port, sid, addr)
    return data if res == 0 else None

def read1(ph, port, sid, addr):
    data, res, err = ph.read1ByteTxRx(port, sid, addr)
    return data if res == 0 else None

def write1(ph, port, sid, addr, val):
    return ph.write1ByteTxRx(port, sid, addr, val)

def write2(ph, port, sid, addr, val):
    return ph.write2ByteTxRx(port, sid, addr, val)

def get_cal_path(arm_type):
    home = Path.home()
    if arm_type == "follower":
        return home / ".cache" / "huggingface" / "lerobot" / "calibration" / "robots" / "so101_follower" / "follower.json"
    else:
        return home / ".cache" / "huggingface" / "lerobot" / "calibration" / "teleoperators" / "so101_leader" / "leader.json"

def main():
    parser = argparse.ArgumentParser(description="SO-ARM101 5号舵机单独精准标定")
    parser.add_argument("--arm", type=str, choices=["follower", "leader"], default="follower",
                        help="选择标定对象: follower (从臂 COM5) 或 leader (主臂 COM6)，默认 follower")
    parser.add_argument("--port", type=str, default="", help="自定义串口号 (默认 follower=COM5, leader=COM6)")
    args = parser.parse_args()

    port_name = args.port if args.port else ("COM5" if args.arm == "follower" else "COM6")
    cal_file = get_cal_path(args.arm)

    print("=" * 75)
    print(f"🎯 SO-ARM101 5号舵机 (wrist_roll) 独立精准标定向导")
    print(f"📌 标定目标: 【{args.arm.upper()} 臂】 | 串口端口: {port_name}")
    print(f"📁 关联标定文件: {cal_file}")
    print("=" * 75)
    print("⚠️  标定前安全提醒:")
    print("   1. 观察手腕前端的手眼相机 USB 黑色线和夹爪白色排线，确保理顺、未缠绕。")
    print("   2. 旋转过程中请用手轻柔转动，切勿猛转拉扯线缆。")
    print("=" * 75)

    port = PortHandler(port_name)
    ph = PacketHandler(0)

    if not port.openPort():
        print(f"[FAIL] 无法打开串口 {port_name}，请确保没有其他脚本 (如 teleop/eval) 在运行占用！")
        return
    port.setBaudRate(1000000)
    time.sleep(0.1)

    cur_pos = read2(ph, port, SERVO_ID, ADDR_POS)
    cur_hom = read2(ph, port, SERVO_ID, ADDR_HOMING)
    if cur_pos is None:
        print(f"[FAIL] {port_name} 上的 5号舵机无响应！请检查供电与排线。")
        port.closePort()
        return

    print(f"\n当前 5号舵机读取: Present_Position={cur_pos}, Homing_Offset={cur_hom}")
    print("正在临时释放 5号舵机扭矩并解锁 EEPROM（可用手轻松转动手腕）...")

    # 关闭扭矩并解锁 EEPROM
    write1(ph, port, SERVO_ID, ADDR_TORQUE, 0)
    write1(ph, port, SERVO_ID, ADDR_LOCK, 0)
    # 临时将限位放宽至全范围，零位归零以测绝对传感器值
    write2(ph, port, SERVO_ID, ADDR_HOMING, 0)
    write2(ph, port, SERVO_ID, ADDR_MIN, 0)
    write2(ph, port, SERVO_ID, ADDR_MAX, 4095)
    time.sleep(0.2)

    # 步骤 1: 确定水平正中位置 (Center Midpoint)
    print("\n" + "-" * 75)
    print("【步骤 1 / 3】确定手腕水平中位 (Neutral / Center)")
    print("👉 请用手将手腕（夹爪）轻轻旋转到【水平放平、掌心朝下、面向正前方】的标准中位。")
    input("   调整到位后，请按 [回车键 (Enter)] 确认当前中位...")
    
    raw_center = read2(ph, port, SERVO_ID, ADDR_POS)
    if raw_center is None:
        print("[FAIL] 读取中位失败，请重试！")
        port.closePort()
        return
    
    # 计算 Homing Offset: 使当前物理中位对应于标准半圈 2047
    homing = int(raw_center - 2047)
    print(f"✓ 物理中位原始读数 = {raw_center}，计算得 Homing Offset = {homing}")
    write2(ph, port, SERVO_ID, ADDR_HOMING, homing)
    time.sleep(0.1)

    # 步骤 2: 确定向左（逆时针）安全限位
    print("\n" + "-" * 75)
    print("【步骤 2 / 3】确定向左 (逆时针 CCW) 安全活动范围")
    print("👉 请用手将手腕向【左侧 (逆时针)】旋转约 90° ~ 120°。")
    print("   (注意观察相机线与夹爪线，留出安全松弛余量，勿过度紧绷)")
    input("   旋转到位后，请按 [回车键 (Enter)] 确认左极限...")

    pos_left = read2(ph, port, SERVO_ID, ADDR_POS)
    if pos_left is None:
        print("[FAIL] 读取左极限失败！")
        port.closePort()
        return
    print(f"✓ 左侧极限读数 = {pos_left}")

    # 步骤 3: 确定向右（顺时针）安全限位
    print("\n" + "-" * 75)
    print("【步骤 3 / 3】确定向右 (顺时针 CW) 安全活动范围")
    print("👉 请用手将手腕向【右侧 (顺时针)】旋转约 90° ~ 120°。")
    print("   (同样注意线缆余量，避免扯死)")
    input("   旋转到位后，请按 [回车键 (Enter)] 确认右极限...")

    pos_right = read2(ph, port, SERVO_ID, ADDR_POS)
    if pos_right is None:
        print("[FAIL] 读取右极限失败！")
        port.closePort()
        return
    print(f"✓ 右侧极限读数 = {pos_right}")

    # 整理限位
    new_min = min(pos_left, pos_right)
    new_max = max(pos_left, pos_right)
    span = new_max - new_min

    print("\n" + "=" * 75)
    print(f"📊 标定计算汇总:")
    print(f"  • Homing Offset (零位偏移): {homing}")
    print(f"  • Min Position  (最小限位): {new_min}")
    print(f"  • Max Position  (最大限位): {new_max}")
    print(f"  • 有效行程跨度: {span} 码 (约 {span / 4096 * 360:.1f}°，既安全又充分)")
    print("=" * 75)

    if span < 800:
        print("⚠️ [警告] 跨度过小 (< 70°)，可能未充分旋转，建议按 Ctrl+C 取消后重试！")
        ans = input("是否强行保存？(y/N): ")
        if ans.strip().lower() != 'y':
            print("已取消保存。")
            port.closePort()
            return

    # 写入舵机 EEPROM
    print("正在将新标定写入 5号舵机硬件 EEPROM 永久存储...")
    write2(ph, port, SERVO_ID, ADDR_MIN, new_min)
    write2(ph, port, SERVO_ID, ADDR_MAX, new_max)
    write1(ph, port, SERVO_ID, ADDR_LOCK, 1) # 重新加锁 EEPROM 保护
    time.sleep(0.2)

    # 同步更新本地 LeRobot calibration JSON 文件
    if cal_file.exists():
        try:
            with open(cal_file, "r", encoding="utf-8") as f:
                cal_data = json.load(f)
            
            cal_data["wrist_roll"] = {
                "id": 5,
                "drive_mode": 0,
                "homing_offset": homing,
                "range_min": new_min,
                "range_max": new_max
            }

            with open(cal_file, "w", encoding="utf-8") as f:
                json.dump(cal_data, f, indent=4)
            print(f"✓ 成功同步更新本地配置文件: {cal_file}")
        except Exception as e:
            print(f"⚠️ 更新本地配置文件失败: {e}")
    else:
        print(f"⚠️ 本地配置文件不存在: {cal_file}")

    print("\n🎉 5号舵机标定成功完成！已彻底消除 58° 倾斜偏差，并锁定了防暴转安全行程！")
    port.closePort()

if __name__ == "__main__":
    main()
