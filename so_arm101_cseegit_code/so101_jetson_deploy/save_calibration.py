#!/usr/bin/env python
"""
从臂舵机 EPROM 标定导出脚本 (Jetson / Linux / PC)
直接读取 6 个 STS3215 舵机芯片内部已烧录的 homing_offset、range_min、range_max，
并自动写入 LeRobot 期望的 follower.json 标定缓存，防止运行时弹出标定提示。

运行方式:
  python3 save_calibration.py --port /dev/ttyACM0
"""

import argparse
import glob
import os
import platform
import shutil
import sys
from pathlib import Path

def scan_ports():
    if platform.system() == "Windows":
        import serial.tools.list_ports
        return [p.device for p in serial.tools.list_ports.comports()]
    else:
        return sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))

def main():
    available = scan_ports()
    default_port = "COM5" if platform.system() == "Windows" else ("/dev/ttyACM0" if "/dev/ttyACM0" in available else ("/dev/ttyUSB0" if available else "/dev/ttyACM0"))

    parser = argparse.ArgumentParser(description="导出从臂 EPROM 标定缓存")
    parser.add_argument("--port", type=str, default=default_port, help="从臂串口号")
    args = parser.parse_args()

    print(f"👉 正在从 {args.port} 读取 6 个舵机 EPROM 寄存器...")
    try:
        from lerobot.robots.so101_follower import SO101Follower, SO101FollowerConfig
        robot = SO101Follower(SO101FollowerConfig(port=args.port, id="follower"))
        robot.bus.connect()
        robot.calibration = robot.bus.read_calibration()
        robot._save_calibration()
        robot.bus.disconnect()

        print(f"✓ 标定已成功写入 LeRobot 系统缓存: {robot.calibration_fpath}")

        # 同时备份一份到当前目录的 calibration/follower.json
        local_calib = Path(__file__).resolve().parent / "calibration" / "follower.json"
        local_calib.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(robot.calibration_fpath, local_calib)
        print(f"✓ 本地副本已更新: {local_calib}")
        print("🎉 标定缓存就绪，现在运行 eval_so101.py 将绝不会弹标定提示！")
    except Exception as e:
        print(f"\n❌ 读取标定失败: {e}")
        if platform.system() != "Windows":
            print(f"请检查串口权限: sudo chmod 666 {args.port}")
        sys.exit(1)

if __name__ == "__main__":
    main()
