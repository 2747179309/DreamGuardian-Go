#!/usr/bin/env python
"""SO-101 专项夹爪标定与精细映射工具 (calibrate_gripper.py)

功能：
1. 仅针对主臂 (COM6) 与从臂 (COM5) 的 6 号夹爪舵机重新标定开合行程与方向映射。
2. 绝对不改动 1~5 号关节（肩部、肘部、手腕）的现有标定。
3. 自动匹配开合方向，彻底解决夹爪行程过大、合不紧、用力捏触发 32 堵转过载的问题。
4. 提供实时手柄跟随测试，在终端即时检验捏合手感与对齐度。

用法：
    python calibrate_gripper.py
"""

import json
import os
import sys
import time
from pathlib import Path

# 添加 lerobot 路径
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "src")))

from scservo_sdk import PortHandler, PacketHandler

FOLLOWER_PORT = "COM5"
LEADER_PORT = "COM6"
SERVO_ID = 6

# STS3215 寄存器地址
ADDR_TORQUE = 40        # Torque_Enable (1 byte)
ADDR_TARGET = 42        # Goal_Position (2 byte)
ADDR_POS = 56           # Present_Position (2 byte)
ADDR_MIN = 9            # Min_Position_Limit (2 byte)
ADDR_MAX = 11           # Max_Position_Limit (2 byte)

LEADER_JSON_PATH = Path.home() / ".cache/huggingface/lerobot/calibration/teleoperators/so101_leader/leader.json"
FOLLOWER_JSON_PATH = Path.home() / ".cache/huggingface/lerobot/calibration/robots/so101_follower/follower.json"


def read2(ph, port, sid, addr):
    data, result, _ = ph.read2ByteTxRx(port, sid, addr)
    return data if result == 0 else None


def write1(ph, port, sid, addr, val):
    return ph.write1ByteTxRx(port, sid, addr, val)


def write2(ph, port, sid, addr, val):
    return ph.write2ByteTxRx(port, sid, addr, val)


def get_live_pos(ph, port, sid):
    return read2(ph, port, sid, ADDR_POS)


def main():
    print("=" * 65)
    print("       🤖 SO-101 夹爪专属快速精细映射与标定工具 🤖")
    print("=" * 65)
    print("说明：本工具只对主臂与从臂的 6 号夹爪进行标定，完全不影响 1~5 号舵机。")
    print(f"主臂串口: {LEADER_PORT} | 从臂串口: {FOLLOWER_PORT} | 夹爪舵机 ID: {SERVO_ID}\n")

    port_l = PortHandler(LEADER_PORT)
    port_f = PortHandler(FOLLOWER_PORT)
    ph = PacketHandler(0)  # STS3215 protocol (little-endian)

    if not port_l.openPort():
        print(f"[错误] 无法打开主臂串口 {LEADER_PORT}，请确认未被其他程序占用。")
        sys.exit(1)
    port_l.setBaudRate(1000000)

    if not port_f.openPort():
        print(f"[错误] 无法打开从臂串口 {FOLLOWER_PORT}，请确认未被其他程序占用。")
        port_l.closePort()
        sys.exit(1)
    port_f.setBaudRate(1000000)

    time.sleep(0.2)

    # 禁用从臂 6 号力矩，方便手动扳动
    write1(ph, port_f, SERVO_ID, ADDR_TORQUE, 0)
    # 主臂 6 号也无力矩
    write1(ph, port_l, SERVO_ID, ADDR_TORQUE, 0)

    pos_l = get_live_pos(ph, port_l, SERVO_ID)
    pos_f = get_live_pos(ph, port_f, SERVO_ID)

    if pos_l is None:
        print(f"[错误] 读取主臂 ({LEADER_PORT}) 6号舵机失败！请检查接线和供电。")
        sys.exit(1)
    if pos_f is None:
        print(f"[错误] 读取从臂 ({FOLLOWER_PORT}) 6号舵机失败！若之前过载报32，请先拔插从臂12V电源。")
        sys.exit(1)

    print(f"当前主臂夹爪读数: {pos_l} | 从臂夹爪读数: {pos_f}\n")

    while True:
        print("\n--- 步骤 1/4: 标定【主臂手柄 - 完全松开】---")
        input("👉 请将【主臂手柄】完全松开到最自然的张开状态，然后按回车...")
        l_open = get_live_pos(ph, port_l, SERVO_ID)
        print(f"✅ 主臂【完全张开】位置: {l_open}")

        print("\n--- 步骤 2/4: 标定【主臂手柄 - 正常捏紧】---")
        input("👉 请单手握紧【主臂手柄】，捏合到平时抓取纸巾的捏紧力度，保持住按回车...")
        l_close = get_live_pos(ph, port_l, SERVO_ID)
        print(f"✅ 主臂【正常捏紧】位置: {l_close}")

        if abs(l_open - l_close) < 80:
            print("⚠️ 警告：主臂张开与捏紧读数差异过小，请重新操作！")
            continue

        print("\n--- 步骤 3/4: 标定【从臂夹爪 - 完全张开】---")
        input("👉 请用手把【从臂夹爪】轻轻掰到最大的自然张开位置，然后按回车...")
        f_open = get_live_pos(ph, port_f, SERVO_ID)
        print(f"✅ 从臂【完全张开】位置: {f_open}")

        print("\n--- 步骤 4/4: 标定【从臂夹爪 - 刚好闭合】---")
        input("👉 请用手把【从臂夹爪】轻轻合拢到两爪尖刚好贴合碰触（切勿暴力挤压死），然后按回车...")
        f_close = get_live_pos(ph, port_f, SERVO_ID)
        print(f"✅ 从臂【刚好闭合】位置: {f_close}")

        if abs(f_open - f_close) < 80:
            print("⚠️ 警告：从臂张开与闭合读数差异过小，请重新操作！")
            continue

        # 计算主臂配置
        if l_open < l_close:
            l_min, l_max, l_drive = l_open, l_close, 0
        else:
            l_min, l_max, l_drive = l_close, l_open, 1

        # 计算从臂配置
        if f_open < f_close:
            f_min, f_max, f_drive = f_open, f_close, 0
        else:
            f_min, f_max, f_drive = f_close, f_open, 1

        print("\n" + "=" * 60)
        print("📊 标定计算完成：")
        print(f"  主臂 (Leader)  : 开={l_open}, 闭={l_close} -> range=[{l_min}, {l_max}], drive_mode={l_drive}")
        print(f"  从臂 (Follower): 开={f_open}, 闭={f_close} -> range=[{f_min}, {f_max}], drive_mode={f_drive}")
        print("=" * 60)

        # 写入 JSON
        if LEADER_JSON_PATH.exists():
            with open(LEADER_JSON_PATH, "r", encoding="utf-8") as f:
                l_cal = json.load(f)
            l_cal["gripper"]["range_min"] = l_min
            l_cal["gripper"]["range_max"] = l_max
            l_cal["gripper"]["drive_mode"] = l_drive
            with open(LEADER_JSON_PATH, "w", encoding="utf-8") as f:
                json.dump(l_cal, f, indent=4)
            print(f"✅ 已更新主臂配置文件: {LEADER_JSON_PATH}")

        if FOLLOWER_JSON_PATH.exists():
            with open(FOLLOWER_JSON_PATH, "r", encoding="utf-8") as f:
                f_cal = json.load(f)
            f_cal["gripper"]["range_min"] = f_min
            f_cal["gripper"]["range_max"] = f_max
            f_cal["gripper"]["drive_mode"] = f_drive
            with open(FOLLOWER_JSON_PATH, "w", encoding="utf-8") as f:
                json.dump(f_cal, f, indent=4)
            print(f"✅ 已更新从臂配置文件: {FOLLOWER_JSON_PATH}")

        # 同步更新舵机 EEPROM 限位
        write2(ph, port_l, SERVO_ID, ADDR_MIN, min(l_min, l_max))
        write2(ph, port_l, SERVO_ID, ADDR_MAX, max(l_min, l_max))
        write2(ph, port_f, SERVO_ID, ADDR_MIN, min(f_min, f_max))
        write2(ph, port_f, SERVO_ID, ADDR_MAX, max(f_min, f_max))

        print("\n🎮 进入【实时手柄开合联动测试】模式：")
        print("👉 现在已开启从臂夹爪电机。请用手握住主臂手柄，自由开合测试！")
        print("👉 终端实时显示开合比例。满意请按 Q 退出保存，不满意按 R 重新标定。")

        # 开启从臂夹爪力矩
        write1(ph, port_f, SERVO_ID, ADDR_TORQUE, 1)

        ch = "q"
        try:
            import msvcrt
            while True:
                curr_l = get_live_pos(ph, port_l, SERVO_ID)
                if curr_l is not None:
                    # 归一化百分比 (0 = 开, 100 = 闭)
                    bounded_l = min(l_max, max(l_min, curr_l))
                    norm = ((bounded_l - l_min) / (l_max - l_min)) * 100.0
                    if l_drive == 1:
                        norm = 100.0 - norm
                    
                    # 从臂目标反归一化
                    f_val = 100.0 - norm if f_drive == 1 else norm
                    f_bounded = min(100.0, max(0.0, f_val))
                    f_target = int((f_bounded / 100.0) * (f_max - f_min) + f_min)

                    # 发送给从臂 6 号舵机
                    write2(ph, port_f, SERVO_ID, ADDR_TARGET, f_target)

                    curr_f = get_live_pos(ph, port_f, SERVO_ID)
                    bar = "█" * int(norm / 5) + "░" * (20 - int(norm / 5))
                    sys.stdout.write(f"\r主臂: {curr_l:4d} | 捏紧度: [{bar}] {norm:5.1f}% ===> 从臂: 实际={curr_f:4d}, 目标={f_target:4d}  ")
                    sys.stdout.flush()

                if msvcrt.kbhit():
                    key = msvcrt.getch().decode("utf-8", errors="ignore").lower()
                    if key in ["q", "\r", "\n"]:
                        ch = "q"
                        print("\n\n🎉 夹爪标定完成并验证通过！已安全保存。")
                        break
                    elif key == "r":
                        ch = "r"
                        write1(ph, port_f, SERVO_ID, ADDR_TORQUE, 0)
                        print("\n重新开始标定...")
                        break
                time.sleep(0.03)

            if ch != "r":
                break
        except KeyboardInterrupt:
            print("\n\n🎉 夹爪标定完成并验证通过！已安全保存。")
            break

    # 退出前释放力矩
    write1(ph, port_f, SERVO_ID, ADDR_TORQUE, 0)
    port_l.closePort()
    port_f.closePort()
    print("串口已关闭，夹爪精细映射成功！")


if __name__ == "__main__":
    main()
