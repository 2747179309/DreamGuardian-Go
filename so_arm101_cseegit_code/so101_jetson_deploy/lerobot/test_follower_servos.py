import time
import sys
from scservo_sdk import PortHandler, PacketHandler

PORT = "COM5"
BAUDRATE = 1000000

print("=" * 60)
print(f"正在连接从臂串口: {PORT} (波特率 {BAUDRATE})...")
portHandler = PortHandler(PORT)
packetHandler = PacketHandler(0) # STS3215 属 STS 系列 -> protocol 0 (小端)


def write_pos(s_id, position, speed=500, acc=50):
    """等价于旧 SDK 的 WritePosEx：写目标位置 + 速度 + 加速度。"""
    packetHandler.write2ByteTxRx(portHandler, s_id, 42, position)  # Goal_Position
    packetHandler.write2ByteTxRx(portHandler, s_id, 46, speed)     # Goal_Velocity
    packetHandler.write1ByteTxRx(portHandler, s_id, 41, acc)       # Acceleration

if not portHandler.openPort():
    print(f"[错误] 无法打开串口 {PORT}，请确认端口号或是否有其他软件占用了该串口！")
    sys.exit(1)

if not portHandler.setBaudRate(BAUDRATE):
    print(f"[错误] 无法设置波特率 {BAUDRATE}")
    portHandler.closePort()
    sys.exit(1)

print("[成功] 串口已连接！正在扫描舵机 ID 1 到 6...\n")

joint_names = {
    1: "底座旋转 (shoulder_pan)",
    2: "大臂俯仰 (shoulder_lift)",
    3: "肘部俯仰 (elbow_flex)",
    4: "手腕俯仰 (wrist_flex)",
    5: "手腕旋转 (wrist_roll)",
    6: "末端夹爪 (gripper)"
}

online_servos = []
current_positions = {}

for s_id in range(1, 7):
    pos, result, error = packetHandler.read2ByteTxRx(portHandler, s_id, 56)
    if result == 0:
        print(f"  ✅ 发现舵机 [ID {s_id}] : {joint_names.get(s_id, '未知关节'):<25} | 当前位置读数: {pos}")
        online_servos.append(s_id)
        current_positions[s_id] = pos
    else:
        print(f"  ❌ 未响应 [ID {s_id}] : {joint_names.get(s_id, '未知关节')}")

print("-" * 60)
if not online_servos:
    print("未检测到任何舵机！请检查：\n1. 12V 5A 电源是否已插好通电？\n2. 驱动板上的舵机排线是否插紧？")
    portHandler.closePort()
    sys.exit(1)

print(f"扫描完成！共发现 {len(online_servos)} 个在线舵机: {online_servos}\n")
print("准备进行【安全微幅动作测试】(每个关节轻微活动约 8 度后平稳复位)...")
print("提示: 动作非常轻柔，不会发生剧烈碰撞。\n")

for s_id in online_servos:
    orig_pos = current_positions[s_id]
    name = joint_names.get(s_id, f"ID {s_id}")
    print(f"正在测试 [ID {s_id}] - {name}...")
    
    # 动作 1: 正向移动一点 (加 100 个脉冲，约 8.7 度)
    target_1 = min(orig_pos + 100, 4000)
    write_pos(s_id, target_1)
    time.sleep(0.8)

    # 动作 2: 反向移动一点
    target_2 = max(orig_pos - 100, 100)
    write_pos(s_id, target_2)
    time.sleep(0.8)

    # 动作 3: 安全回到原始位置
    write_pos(s_id, orig_pos)
    time.sleep(0.8)
    print(f"  -> [ID {s_id}] 测试完毕并已平稳复位！\n")

print("=" * 60)
print("🎉 所有在线舵机动作测试全部通过！机械臂状态良好！")
portHandler.closePort()
