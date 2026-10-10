#!/usr/bin/env python
"""
SO-ARM101 真机 AI 策略闭环自主运行脚本 (DreamGuardian Next)

使用方法:
  1. 测试抓纸巾:
     python eval_so101.py --task tissue
  2. 测试抓眼罩:
     python eval_so101.py --task eyemask
  3. 自定义参数:
     python eval_so101.py --model-path "D:/group project/models/act_tissue" --port COM5 --camera-index 0
"""

import argparse
import time
from pathlib import Path

import cv2
import numpy as np
import torch

from lerobot.cameras.opencv.configuration_opencv import OpenCVCameraConfig
from lerobot.policies.act.modeling_act import ACTPolicy
from lerobot.robots.so101_follower.config_so101_follower import SO101FollowerConfig
from lerobot.robots.so101_follower.so101_follower import SO101Follower
from lerobot.utils.control_utils import predict_action
from lerobot.utils.robot_utils import busy_wait
from lerobot.utils.utils import get_safe_torch_device

def main():
    parser = argparse.ArgumentParser(description="SO-ARM101 真机自主抓取递送实测")
    parser.add_argument("--task", type=str, choices=["tissue", "eyemask"], default="tissue",
                        help="选择任务: tissue (抓纸巾) 或 eyemask (抓眼罩)")
    parser.add_argument("--model-path", type=str, default=None,
                        help="自定义模型权重路径（如果不填则自动匹配 task 对应路径）")
    parser.add_argument("--port", type=str, default="COM5", help="从臂串口号 (默认 COM5)")
    parser.add_argument("--camera-index", type=int, default=0, help="手眼相机索引 (默认 0)")
    parser.add_argument("--fps", type=int, default=30, help="控制循环帧率 (默认 30)")
    parser.add_argument("--duration", type=int, default=0, help="自主运行单轮时长（秒），默认 0 为不设时限（一直运行直到手动退出）")
    parser.add_argument("--n-action-steps", type=int, default=None, help="重规划步长（默认根据任务自动匹配：tissue 为 60 步，eyemask 为 65 步以跨越初始休眠死区）")
    parser.add_argument("--smooth-alpha", type=float, default=0.65, help="动作平滑滤波系数 (0.1~1.0，0.65 可彻底消除换块点头与卡顿)")
    parser.add_argument("--lift-offset", type=float, default=0.0, help="接近阶段肩部高度补偿（度，默认 0.0 原生训练姿态；若目标较高，负值如 -3.0 可抬升接近高度）")
    parser.add_argument("--pan-offset", type=float, default=0.0, help="底座旋转航向偏置（度，负值向左偏，正值向右偏）")
    parser.add_argument("--pan-gain", type=float, default=1.0, help="左转幅度放大系数（如 1.25，当模型意图向左时按比例放大转向幅度）")
    parser.add_argument("--pan-right-gain", type=float, default=1.0, help="右转幅度缩放系数（如 0.80 或 0.75，当机械臂向右伸爪过于靠右时，按比例收缩右偏角度）")
    parser.add_argument("--roll-offset", type=float, default=0.0, help="腕部翻转微调偏置（度，微调夹爪倾角以精准匹配眼罩）")
    parser.add_argument("--auto-reset", action="store_true", default=True, help="抓取递送归位后自动重置策略进入下一轮抓取（默认开启）")
    parser.add_argument("--device", type=str, default="auto", help="计算设备: cuda 或 cpu (默认自动选择)")
    args = parser.parse_args()

    # 根据任务特性匹配最优步长 (tissue 为 60 步连贯顺滑；eyemask 设为 65 步跨过演示开头的静止停顿，彻底消除原地点头)
    if args.n_action_steps is not None:
        n_action_steps = args.n_action_steps
    else:
        n_action_steps = 60 if args.task == "tissue" else 65

    # 1. 确定模型路径与任务指令
    if args.model_path:
        model_dir = Path(args.model_path)
    else:
        model_dir = Path(f"D:/group project/models/act_{args.task}")

    if not model_dir.exists():
        raise FileNotFoundError(f"未找到模型权重目录: {model_dir}")

    task_desc = "Grasp the tissue and handover to human hand" if args.task == "tissue" else "Grasp the eye mask and handover to human hand"

    print("=" * 65)
    print("🤖 DreamGuardian Next - SO-ARM101 具身模型真机自主推理启动")
    print(f"🎯 执行任务: {args.task.upper()} ({task_desc})")
    print(f"📦 加载模型: {model_dir}")
    print(f"🔌 从臂串口: {args.port} | 📷 手眼相机: index {args.camera_index} (30 FPS)")
    print(f"🔄 动作执行步长: 每 {n_action_steps} 步 (约 {n_action_steps/args.fps:.2f} 秒) 重规划 | 🌊 平滑: α={args.smooth_alpha}")
    pan_parts = []
    if args.pan_offset != 0:
        pan_parts.append(f"偏置={args.pan_offset:+.1f}°")
    if args.pan_gain != 1.0:
        pan_parts.append(f"左转增益=x{args.pan_gain:.2f}")
    if args.pan_right_gain != 1.0:
        pan_parts.append(f"右转缩放=x{args.pan_right_gain:.2f}")
    pan_info = f" | 🧭 转向调节: {', '.join(pan_parts)}" if pan_parts else ""
    lift_info = f" | 📐 高度补偿: {args.lift_offset:+.1f}°" if args.lift_offset != 0 else ""
    roll_info = f" | 🔄 腕部倾角: {args.roll_offset:+.1f}°" if args.roll_offset != 0 else ""
    print(f"🦾 夹爪策略: 遵循训练分布与姿态微调{pan_info}{lift_info}{roll_info}")
    print("♾️ 运行模式: 连续闭环（自动识别归位重置，按 [Q] 退出，按 [R] 手动立即重置）")
    print("=" * 65)

    # 2. 加载 ACT 策略网络
    print("\n[1/3] 正在加载 ACT 策略神经网络...")
    policy = ACTPolicy.from_pretrained(str(model_dir))
    policy.config.n_action_steps = n_action_steps
    policy.eval()
    
    device = get_safe_torch_device(args.device if args.device != "auto" else policy.config.device)
    policy.to(device)
    print(f"✓ 模型加载成功！运算设备: {device.type.upper()} | 步长: {n_action_steps}")

    # 3. 初始化并连接机械臂从臂与手眼相机
    print("\n[2/3] 正在连接从臂硬件与手眼相机...")
    camera_cfg = OpenCVCameraConfig(
        index_or_path=args.camera_index,
        fps=args.fps,
        width=640,
        height=480,
    )
    robot_cfg = SO101FollowerConfig(
        port=args.port,
        id="follower",
        cameras={"handeye": camera_cfg},
    )
    robot = SO101Follower(robot_cfg)
    robot.connect()
    print("✓ 从臂与摄像头已就绪！")

    # 4. 进入自主推理控制循环
    print("\n[3/3] 正在启动闭环自主控制...")
    print("👉 机械臂已完全由 AI 大模型接管！")
    print("👉 在弹出的手眼画面窗口按【Q】或终端按【Ctrl+C】随时安全退出。")
    print("👉 按【R】重置策略记忆（开始新一轮抓取）。\n")

    policy.reset()
    start_time = time.time()
    step = 0
    smoothed_action = None
    has_worked = False

    cv2.namedWindow("SO-ARM101 Handeye Feed", cv2.WINDOW_AUTOSIZE)

    try:
        while True:
            loop_start = time.perf_counter()
            step += 1
            elapsed = time.time() - start_time

            if args.duration > 0 and elapsed > args.duration:
                print(f"\n[提示] 单轮运行已达到设定的 {args.duration} 秒，自动结束。")
                break

            # 获取机械臂当前状态与手眼画面
            obs = robot.get_observation()
            
            # 格式化输入给策略网络（6个电机位置作为状态向量）
            motor_names = list(robot.action_features.keys())
            state_vector = np.array([obs[k] for k in motor_names], dtype=np.float32)
            obs_frame = {
                "observation.state": state_vector,
                "observation.images.handeye": np.array(obs["handeye"], dtype=np.uint8),
            }

            # AI 大脑前向推理动作
            action_tensor = predict_action(
                obs_frame,
                policy,
                device,
                policy.config.use_amp,
                task=task_desc,
                robot_type=robot.robot_type,
            )

            # 转换为舵机目标字典
            action_dict = {key: action_tensor[i].item() for i, key in enumerate(robot.action_features)}

            # 动作平滑滤波（EMA）：消除 Chunk 边界不连续带来的机械臂“点头/跳变”
            if smoothed_action is None or args.smooth_alpha >= 1.0:
                smoothed_action = {k: v for k, v in action_dict.items()}
            else:
                for k in action_dict:
                    smoothed_action[k] = args.smooth_alpha * action_dict[k] + (1.0 - args.smooth_alpha) * smoothed_action[k]

            final_action = {k: v for k, v in smoothed_action.items()}
            raw_gripper = smoothed_action.get("gripper.pos", 100.0)

            # 1. 转向补偿与动态增益（解决目标朝向偏置问题）
            if "shoulder_pan.pos" in final_action:
                # 动态左转增益（pan < 0）：当向左转向不足时放大
                if args.pan_gain != 1.0 and final_action["shoulder_pan.pos"] < 0:
                    final_action["shoulder_pan.pos"] *= args.pan_gain
                # 动态右转缩放（pan > 0）：当向右转向过度时按比例收缩（如 0.80）
                elif args.pan_right_gain != 1.0 and final_action["shoulder_pan.pos"] > 0:
                    final_action["shoulder_pan.pos"] *= args.pan_right_gain
                # 静态角度偏置：整体平移底座朝向（负值为向左偏，正值为向右偏）
                if args.pan_offset != 0.0:
                    final_action["shoulder_pan.pos"] += args.pan_offset

            # 2. 接近阶段高度补偿（负偏置可抬升接近姿态）
            if args.lift_offset != 0.0 and "shoulder_lift.pos" in final_action:
                final_action["shoulder_lift.pos"] += args.lift_offset

            # 3. 腕部翻转微调偏置（微调夹爪倾角以精准匹配眼罩）
            if args.roll_offset != 0.0 and "wrist_roll.pos" in final_action:
                final_action["wrist_roll.pos"] += args.roll_offset

            # 4. 夹爪动作完全遵循训练数据原生分布
            final_action["gripper.pos"] = raw_gripper

            # 下发动作给从臂执行（底层已自动将 0~100% 安全反归一化为舵机行程，防止堵转与越界）
            robot.send_action(final_action)

            # 5. 归位状态自动重置机制：展开作业后再次回到休眠位置时，自动清空历史进入下一轮
            current_lift = obs.get("shoulder_lift.pos", -100.0)
            if current_lift > -60.0:
                has_worked = True
            if args.auto_reset and has_worked and current_lift < -92.0:
                print("\n[自动循环] 检测到机械臂已递送归位，自动重置策略并启动下一轮抓取...")
                policy.reset()
                smoothed_action = None
                has_worked = False
                time.sleep(0.3)

            # 显示手眼画面与状态 HUD
            img = obs["handeye"]
            bgr_img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)

            # 绘制 HUD 状态栏
            cv2.rectangle(bgr_img, (0, 0), (640, 50), (20, 20, 20), -1)
            hud_text_1 = f"AI AUTO [{args.task.upper()}] | Step: {step} | Chunk: {n_action_steps} | {elapsed:.1f}s"
            lift_str = f" | Lift:{args.lift_offset:+.1f}°" if args.lift_offset != 0 else ""
            pan_str = ""
            if args.pan_offset != 0:
                pan_str += f" | Pan:{args.pan_offset:+.1f}°"
            if args.pan_right_gain != 1.0:
                pan_str += f"(R:x{args.pan_right_gain:.2f})"
            hud_text_2 = f"Gripper: {raw_gripper:.1f}%{pan_str}{lift_str} | [Q] Quit | [R] Reset"
            cv2.putText(bgr_img, hud_text_1, (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 200), 2)
            cv2.putText(bgr_img, hud_text_2, (10, 44), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 220, 220), 1)

            cv2.imshow("SO-ARM101 Handeye Feed", bgr_img)
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == ord('Q') or key == 27:
                print("\n[退出] 用户按下 Q / Esc，安全停止运行。")
                break
            elif key == ord('r') or key == ord('R'):
                print("\n[重置] 策略记忆与平滑器已重置，开始新一轮抓取！")
                policy.reset()
                start_time = time.time()
                step = 0
                smoothed_action = None
                has_worked = False

            # 维持稳定的控制频率 (30 Hz)
            dt = time.perf_counter() - loop_start
            busy_wait(1.0 / args.fps - dt)

    except KeyboardInterrupt:
        print("\n[中断] 用户按下 Ctrl+C，安全退出。")
    except Exception as e:
        print(f"\n[运行异常中断] 错误类型: {type(e).__name__} | 信息: {e}")
        if "PermissionError" in str(e) or "31" in str(e) or "Cannot configure port" in str(e):
            print(">>> 诊断: CH343 串口芯片因触桌过载或供电瞬态波动进入假死保护！")
            print(">>> 解决: 请拔下从臂 USB 线等待 3 秒重新插上，并运行 python check_power.py 验证。")
        elif "ConnectionError" in str(e):
            print(">>> 诊断: 舵机总线通信中断，请检查 12V 供电线是否松动或被机械臂扯动。")
    finally:
        print("正在断开从臂连接并安全释放扭矩...")
        robot.disconnect()
        cv2.destroyAllWindows()
        print("✓ 机械臂已安全断开，运行结束！")

if __name__ == "__main__":
    main()
