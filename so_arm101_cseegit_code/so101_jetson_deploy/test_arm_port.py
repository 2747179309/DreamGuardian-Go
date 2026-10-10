#!/usr/bin/env python
"""
机械臂串口通信与 6 轴舵机快速诊断工具 (Jetson / Linux / PC)
用于验证 USB 转串口芯片通信、权限、波特率以及 1~6 号舵机的在线状态与当前读数。

运行方式:
  python3 test_arm_port.py
  python3 test_arm_port.py --port /dev/ttyACM0
  python3 test_arm_port.py --port /dev/ttyUSB0
"""

import argparse
import glob
import os
import platform
import sys
import time

try:
    import serial
    from feetech_servo_sdk import PortHandler, PacketHandler
except ImportError as e:
    print(f"缺少依赖: {e}，请先运行: pip install pyserial feetech-servo-sdk")
    sys.exit(1)

SERVO_NAMES = {
    1: "shoulder_pan  (底座旋转)",
    2: "shoulder_lift (大臂俯仰)",
    3: "elbow_flex    (肘部俯仰)",
    4: "wrist_flex    (手腕俯仰)",
    5: "wrist_roll    (手腕旋转)",
    6: "gripper       (末端夹爪)",
}


def scan_ports():
    if platform.system() == "Windows":
        import serial.tools.list_ports
        return [p.device for p in serial.tools.list_ports.comports()]
    else:
        return sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))


def main():
    available = scan_ports()
    default_port = "COM5" if platform.system() == "Windows" else ("/dev/ttyACM0" if "/dev/ttyACM0" in available else ("/dev/ttyUSB0" if available else "/dev/ttyACM0"))

    parser = argparse.ArgumentParser(description="SO-ARM101 舵机通信诊断")
    parser.add_argument("--port", type=str, default=default_port, help="串口设备号")
    parser.add_argument("--baudrate", type=int, default=1000000, help="波特率 (默认 1000000 / 1Mbps)")
    args = parser.parse_args()

    print("=" * 60)
    print("🔌 SO-ARM101 机械臂串口与 6 轴舵机连通性诊断")
    print(f"💻 当前操作系统: {platform.system()} ({platform.machine()})")
    print(f"🔍 检测到的所有串口: {available if available else '未检测到可用串口'}")
    print(f"👉 正在测试目标端口: {args.port} | 波特率: {args.baudrate}")
    print("=" * 60)

    # 检查串口权限（Linux/Jetson 特有）
    if platform.system() != "Windows" and os.path.exists(args.port):
        if not os.access(args.port, os.R_OK | os.W_OK):
            print(f"\n❌ 权限不足！当前用户无权读写 {args.port}")
            print(f"👉 请执行临时提权: sudo chmod 666 {args.port}")
            print(f"👉 或将当前用户永久加入 dialout 组: sudo usermod -a -G dialout $USER\n")
            return

    port_handler = PortHandler(args.port)
    packet_handler = PacketHandler(0)  # STS3215 协议

    if not port_handler.openPort():
        print(f"\n❌ 无法打开串口 {args.port}！")
        print("可能原因:")
        print("  1. 串口已被其他程序占用 (例如另有一个 eval 脚本正在运行)")
        print("  2. USB 数据线松动或未插好")
        print("  3. 端口号不匹配，请尝试指定其他串口 (例如 --port /dev/ttyUSB0)")
        return

    if not port_handler.setBaudRate(args.baudrate):
        print(f"❌ 无法设置波特率为 {args.baudrate}")
        port_handler.closePort()
        return

    print("✓ 串口成功打开！正在依次 Ping 1~6 号 STS3215 舵机...\n")

    online_count = 0
    # STS3215 寄存器地址
    ADDR_PRESENT_POSITION = 56
    ADDR_PRESENT_VOLTAGE = 62

    for servo_id in range(1, 7):
        model_num, comm_result, error = packet_handler.ping(port_handler, servo_id)
        if comm_result == 0:
            # 读取当前位置与电压
            pos, pos_res, _ = packet_handler.read2ByteTxRx(port_handler, servo_id, ADDR_PRESENT_POSITION)
            volt, volt_res, _ = packet_handler.read1ByteTxRx(port_handler, servo_id, ADDR_PRESENT_VOLTAGE)

            pos_str = f"{pos:4d}" if pos_res == 0 else "读取中"
            volt_str = f"{volt/10.0:.1f}V" if volt_res == 0 else "N/A"

            print(f"  [ID {servo_id}] 🟢 在线 | {SERVO_NAMES[servo_id]} | 当前位置: {pos_str} | 供电: {volt_str}")
            online_count += 1
        else:
            print(f"  [ID {servo_id}] 🔴 离线 | {SERVO_NAMES[servo_id]} (通信错误码: {comm_result})")

    print("-" * 60)
    if online_count == 6:
        print("🎉 完美！全部 6 个舵机均正常通信，供电良好，机械臂可立即投入推理！")
    elif online_count > 0:
        print(f"⚠️ 只有 {online_count}/6 个舵机在线！请检查 12V 供电线接头及舵机间串联连线。")
    else:
        print("❌ 0 个舵机响应！请特别确认:")
        print("   1. 从臂控制板的 12V 独立电源插头是否已通电（必须接通 12V 舵机才会亮起并工作）")
        print("   2. USB 线是否为支持数据传输的线缆")

    port_handler.closePort()
    print()


if __name__ == "__main__":
    main()
