#!/usr/bin/env python
"""完整重定从臂 wrist_roll (ID5)：零位(homing) + 限位(min/max)。

上次"只补限位"失败的原因：零位偏移也是错的，腕子转到一端时位置变成负数
(0x844B = -1099)。所以这次把零位和限位一起重定。

关键点：你不需要知道 0 位在哪——脚本用「两端点求中点」自动算出物理中间，
再据此定零位。你只需要照旧：左转到底、右转到底，各按一次回车。

用法：python calibrate_wrist_roll.py   (默认 COM5, ID5)
"""
import sys
import time

from scservo_sdk import PortHandler, PacketHandler

PORT = "COM5"
SERVO_ID = 5

ADDR_POS = 56       # Present_Position
ADDR_MIN = 9        # Min_Position_Limit
ADDR_MAX = 11       # Max_Position_Limit
ADDR_HOMING = 31    # Homing_Offset
ADDR_TORQUE = 40    # Torque_Enable


def read2(ph, port, sid, addr):
    data, result, _ = ph.read2ByteTxRx(port, sid, addr)
    return data if result == 0 else None


def main():
    port = PortHandler(PORT)
    ph = PacketHandler(0)  # STS3215 -> STS series -> little-endian

    if not port.openPort():
        print(f"[错误] 无法打开串口 {PORT}")
        sys.exit(1)
    port.setBaudRate(1000000)
    time.sleep(0.2)

    pos = read2(ph, port, SERVO_ID, ADDR_POS)
    hom = read2(ph, port, SERVO_ID, ADDR_HOMING)
    if pos is None:
        print("[错误] ID5 无响应，请检查从臂供电/排线")
        sys.exit(1)

    print(f"当前：位置={pos}，旧零位偏移={hom}")
    print("正在重置 ID5：零位=0，限位=[0,4095]（扭矩关闭，可手掰）...")
    ph.write1ByteTxRx(port, SERVO_ID, ADDR_TORQUE, 0)
    ph.write2ByteTxRx(port, SERVO_ID, ADDR_HOMING, 0)
    ph.write2ByteTxRx(port, SERVO_ID, ADDR_MIN, 0)
    ph.write2ByteTxRx(port, SERVO_ID, ADDR_MAX, 4095)
    time.sleep(0.2)

    input("\n① 把腕子往【一个方向】转到底，然后按回车...")
    a1 = read2(ph, port, SERVO_ID, ADDR_POS)
    input("② 把腕子往【相反方向】转到底，然后按回车...")
    a2 = read2(ph, port, SERVO_ID, ADDR_POS)

    if a1 is None or a2 is None:
        print("[错误] 读取位置失败，请重试")
        port.closePort()
        sys.exit(1)

    lo, hi = sorted([a1, a2])
    span = hi - lo
    print(f"\n两端点(原始) = {a1}, {a2} -> [{lo}, {hi}]，跨度 {span}")

    if span < 1500:
        print("[警告] 跨度太小，可能没转到底，请重新运行一次。")
        port.closePort()
        sys.exit(1)

    middle = (lo + hi) / 2.0
    homing = int(round(middle - 2047))  # 与 lerobot 一致：半圈 = 2047
    print(f"物理中间 = {middle:.0f}，计算零位偏移 = {homing}")

    ph.write2ByteTxRx(port, SERVO_ID, ADDR_HOMING, homing)
    time.sleep(0.1)

    p_lo = lo - homing
    p_hi = hi - homing
    ph.write2ByteTxRx(port, SERVO_ID, ADDR_MIN, p_lo)
    ph.write2ByteTxRx(port, SERVO_ID, ADDR_MAX, p_hi)
    time.sleep(0.1)

    r_hom = read2(ph, port, SERVO_ID, ADDR_HOMING)
    r_mn = read2(ph, port, SERVO_ID, ADDR_MIN)
    r_mx = read2(ph, port, SERVO_ID, ADDR_MAX)
    r_pos = read2(ph, port, SERVO_ID, ADDR_POS)
    print(f"\n完成：零位偏移={r_hom}，限位=[{r_mn},{r_mx}]，当前位置={r_pos} ({r_pos / 4096 * 360:.1f}°)")
    print("(正常应接近 零位偏移 ~53，限位 [~120,~3970])")

    port.closePort()


if __name__ == "__main__":
    main()
