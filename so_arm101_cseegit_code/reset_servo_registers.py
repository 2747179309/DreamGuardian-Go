#!/usr/bin/env python
"""
恢复 SO-ARM101 舵机出厂默认扭矩与电流寄存器配置
将 1~5 号大关节舵机恢复为原生 100% 满扭矩与无限制电流，避免重力过载报错。
"""
import time
import scservo_sdk as scs

PORT = "COM5"
BAUDRATE = 1000000

def main():
    ph = scs.PortHandler(PORT)
    pkh = scs.PacketHandler(0)

    if not ph.openPort():
        print(f"无法打开串口 {PORT}，请检查是否被占用或需重新拔插 USB。")
        return

    if not ph.setBaudRate(BAUDRATE):
        print(f"无法设置波特率 {BAUDRATE}")
        ph.closePort()
        return

    print("=" * 60)
    print("正在检测并恢复 1~5 号舵机原生扭矩与电流寄存器...")
    print("=" * 60)

    # 1~5 号为底座与大臂小臂关节，6 号为夹爪
    for mid in range(1, 6):
        # 探测舵机
        model, comm, err = pkh.ping(ph, mid)
        if comm != scs.COMM_SUCCESS:
            print(f"舵机 ID {mid}: 离线或未通 12V 电源 (comm={comm})")
            continue

        # 读取当前电压
        vol, comm, _ = pkh.read1ByteTxRx(ph, mid, 62)
        voltage_v = vol / 10.0 if comm == scs.COMM_SUCCESS else 0.0

        # 解锁 EPROM (写入 0 到地址 55)
        pkh.write1ByteTxRx(ph, mid, 55, 0)

        # 恢复出厂设置:
        # 地址 16 (2 bytes): Max_Torque_Limit = 1000 (100% 满扭矩)
        pkh.write2ByteTxRx(ph, mid, 16, 1000)
        # 地址 28 (2 bytes): Protection_Current = 0 (解除电流人为限制)
        pkh.write2ByteTxRx(ph, mid, 28, 0)
        # 地址 36 (1 byte): Overload_Torque = 254 (100% 保护扭矩)
        pkh.write1ByteTxRx(ph, mid, 36, 254)

        # 重新锁定 EPROM (写入 1 到地址 55)
        pkh.write1ByteTxRx(ph, mid, 55, 1)

        print(f"[OK] 舵机 ID {mid}: 在线 (电压 {voltage_v:.1f}V) | 扭矩恢复 1000 (100%) | 电流限制已解除")

    # 6 号夹爪单独保持安全配置
    model, comm, err = pkh.ping(ph, 6)
    if comm == scs.COMM_SUCCESS:
        pkh.write1ByteTxRx(ph, 6, 55, 0)
        pkh.write2ByteTxRx(ph, 6, 16, 500)
        pkh.write2ByteTxRx(ph, 6, 28, 250)
        pkh.write1ByteTxRx(ph, 6, 36, 25)
        pkh.write1ByteTxRx(ph, 6, 55, 1)
        print("[OK] 舵机 ID 6 (夹爪): 维持 50% 安全扭矩与过载防烧保护")

    ph.closePort()
    print("=" * 60)
    print("全部舵机寄存器已恢复出厂原生状态！")

if __name__ == "__main__":
    main()
