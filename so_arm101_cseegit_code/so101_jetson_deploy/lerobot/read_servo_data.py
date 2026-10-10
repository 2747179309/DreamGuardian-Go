import time
import sys
import os
from scservo_sdk import PortHandler, PacketHandler

PORT = "COM5"
BAUDRATE = 1000000

print(f"正在连接从臂串口: {PORT} (波特率 {BAUDRATE})...")
portHandler = PortHandler(PORT)
packetHandler = PacketHandler(0) # STS3215 属 STS 系列 -> protocol 0 (小端)。填 1 会把 2 字节寄存器高低位反转

if not portHandler.openPort():
    print(f"[错误] 无法打开串口 {PORT}，请确认端口号或是否有其他软件（如上位机）占用了串口！")
    sys.exit(1)

if not portHandler.setBaudRate(BAUDRATE):
    print(f"[错误] 无法设置波特率 {BAUDRATE}")
    portHandler.closePort()
    sys.exit(1)

joint_names = {
    1: "底座旋转 (shoulder_pan)",
    2: "大臂俯仰 (shoulder_lift)",
    3: "肘部俯仰 (elbow_flex)",
    4: "手腕俯仰 (wrist_flex)",
    5: "手腕旋转 (wrist_roll)",
    6: "末端夹爪 (gripper)"
}

print("=" * 75)
print("【实时数据监控已启动】用手转动机械臂，终端数据会实时变化！(按 Ctrl+C 退出)")
print("=" * 75)

try:
    while True:
        output_lines = []
        for s_id in range(1, 7):
            # 读取位置 (0~4095)
            pos, result, error = packetHandler.read2ByteTxRx(portHandler, s_id, 56)
            # 读取电压 (0.1V) 与温度 (℃)
            voltage, _, res_v, _ = packetHandler.read1ByteTxRx(portHandler, s_id, 62)
            temp, _, res_t, _ = packetHandler.read1ByteTxRx(portHandler, s_id, 63)
            
            if result == 0:
                deg = (pos / 4096.0) * 360.0
                v_str = f"{voltage/10.0:.1f}V" if res_v == 0 else "N/A"
                t_str = f"{temp}℃" if res_t == 0 else "N/A"
                output_lines.append(f"ID {s_id} [{joint_names[s_id]:<22}] -> 位置读数: {pos:4d} | 角度: {deg:5.1f}° | 电压: {v_str:<5} | 温度: {t_str}")
            else:
                output_lines.append(f"ID {s_id} [{joint_names[s_id]:<22}] -> ❌ 未响应 (请检查供电/线缆)")
        
        # 终端清屏并重新打印最新帧数据
        os.system('cls' if os.name == 'nt' else 'clear')
        print("=" * 75)
        print("【SO-ARM101 从臂 (COM5) 实时状态监控】 (按 Ctrl+C 退出)")
        print("=" * 75)
        for line in output_lines:
            print(line)
        print("=" * 75)
        print("提示: 轻轻用手掰动机械臂各个关节，可观察上方位置和角度的实时变化。")
        time.sleep(0.1) # 10Hz 刷新频率

except KeyboardInterrupt:
    print("\n已退出实时监控。")
finally:
    portHandler.closePort()
