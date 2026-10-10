#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
SO-ARM101 机械臂 12V 供电与通信状态快速检测工具
用法:
  python check_power.py               # 快速单次检测
  python check_power.py --monitor     # 实时循环刷新检测（适合边插电源边看是否接通）
  python check_power.py --port COM5   # 指定检测端口
"""

import argparse
import sys
import time

# 兼容 Windows GBK 控制台输出
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    import serial.tools.list_ports
    import scservo_sdk as scs
except ImportError as e:
    print(f"缺少依赖: {e}，请确认已激活环境: conda activate lerobot")
    sys.exit(1)


def test_servo_power(port_name, baudrate=1000000):
    """检测指定串口的 12V 供电与 1~6 号舵机在线状态"""
    try:
        ph = scs.PortHandler(port_name)
        if not ph.openPort():
            return False, 0.0, [], "串口无法打开 (可能已被其他程序占用)"
    except Exception as e:
        return False, 0.0, [], f"串口打开异常: {e}"

    try:
        ph.setBaudRate(baudrate)
        pkh = scs.PacketHandler(0)

        # 检查 1 号底座舵机电压 (寄存器 62)
        vol_raw, res, err = pkh.read1ByteTxRx(ph, 1, 62)
        voltage = (vol_raw / 10.0) if res == 0 else 0.0

        # Ping 全部 1~6 号舵机
        online_servos = []
        for sid in range(1, 7):
            _, ping_res, _ = pkh.ping(ph, sid)
            if ping_res == 0:
                online_servos.append(sid)

        ph.closePort()

        if res == 0 and voltage >= 9.0:
            if len(online_servos) == 6:
                msg = f"供电正常 ({voltage:.1f}V) | 全部 6 个舵机在线就绪"
                return True, voltage, online_servos, msg
            else:
                msg = f"已通电 ({voltage:.1f}V)，但仅部分舵机响应 (在线 ID: {online_servos})"
                return False, voltage, online_servos, msg
        else:
            msg = "12V 未通电 (电压 0.0V / 舵机无响应) - 请插紧 12V 独立电源插头"
            return False, 0.0, online_servos, msg

    except Exception as e:
        try:
            ph.closePort()
        except Exception:
            pass
        return False, 0.0, [], f"通信测试异常: {e}"


def run_once(target_port=None):
    all_ports = [p.device for p in serial.tools.list_ports.comports()]

    if target_port:
        check_list = [target_port]
    else:
        candidates = ["COM5", "COM6"]
        check_list = [p for p in candidates if p in all_ports]
        if not check_list and all_ports:
            # 过滤掉蓝牙串口
            check_list = [p.device for p in serial.tools.list_ports.comports() if "BTHENUM" not in p.hwid]

    print("=" * 65)
    print("[SO-ARM101 Hardware Power & Servo Status Check]")
    print(f"当前系统识别到的全部串口: {all_ports if all_ports else '无'}")
    print("=" * 65)

    if not check_list:
        print("[FAIL] 未检测到机械臂串口！请检查从臂 USB 数据线是否插紧。")
        print("=" * 65)
        return False

    all_pass = True
    for port in check_list:
        is_ok, vol, online, msg = test_servo_power(port)
        status_tag = "[PASS 正常]" if is_ok else "[FAIL 异常]"
        print(f"  {status_tag} 端口 {port:<6} : {msg}")
        if online:
            print(f"         ↳ 在线舵机: {online}")
        if not is_ok:
            all_pass = False

    print("=" * 65)
    if all_pass:
        print(">>> 机械臂 12V 供电正常，通信通畅，可立即启动模型推理！")
    else:
        print(">>> 排查步骤:")
        print("    1. 检查插在从臂控制板上的 12V DC 圆头电源线是否插紧。")
        print("    2. 检查 12V 适配器是否插在通电插座上，观察板载指示灯。")
        print("    3. 检查从控制板到底座 1 号舵机的 3 芯白色排线是否插好。")
    print("=" * 65)
    return all_pass


def main():
    parser = argparse.ArgumentParser(description="SO-ARM101 电源检测工具")
    parser.add_argument("--port", type=str, default=None, help="指定检测端口 (默认自动扫描 COM5)")
    parser.add_argument("--monitor", "-m", action="store_true", help="实时持续检测模式 (按 Ctrl+C 退出)")
    args = parser.parse_args()

    if args.monitor:
        port = args.port or "COM5"
        print(f"进入实时持续监测模式 (端口: {port})，按 Ctrl+C 退出。")
        print("您可以现在去插拔或开启 12V 电源，观察状态变化...\n")
        try:
            while True:
                is_ok, vol, online, msg = test_servo_power(port)
                tag = "[PASS]" if is_ok else "[FAIL]"
                cur_time = time.strftime("%H:%M:%S")
                print(f"\r[{cur_time}] {tag} 电压: {vol:4.1f}V | 在线舵机: {len(online)}/6 | {msg}   ", end="", flush=True)
                if is_ok:
                    print(f"\n\n>>> 检测到 12V 电源已接通！(电压: {vol:.1f}V，6 个舵机就绪)")
                    print(">>> 现在可以运行: python eval_so101.py --task tissue\n")
                    break
                time.sleep(1.0)
        except KeyboardInterrupt:
            print("\n已退出监测模式。")
    else:
        run_once(args.port)


if __name__ == "__main__":
    main()
