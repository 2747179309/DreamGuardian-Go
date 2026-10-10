"""
SO-ARM101 ACT具身抓取 + YOLO手部动态跟随与【3秒静止确认智能递送】系统 (v4.0)
================================================================================
核心交互规范（遵照用户精准要求）：
--------------------------------------------------------------------------------
1. 【阶段 1: ACT 纯净轨迹抓取与升空运送】
   - 机械臂完全由 ACT 策略模型原生驱动（参数与 eval_so101.py 100% 一致）；
   - 下潜开爪 -> 闭爪咬死纸巾 -> 升空运送至空中预定递送位置；
   - 夹爪一旦咬住纸巾，底层【绝对锁定 100%】，升空运送全程绝不松爪！

2. 【交接点: 在 ACT 准备松爪的一瞬间平滑切入跟随】
   - 到达空中递送点后，夹爪保持 100% 紧闭，控制权无缝平滑交接给 YOLO 手部跟随系统；

3. 【阶段 2: 先动态跟随，绝不一看到手就松开！】
   - 用户在空中移动手：机械臂底座与大臂实时跟随移动，夹爪始终紧锁 100% 纸巾；
   - 无论手怎么移动、移动多久，机械臂都专注跟手，【绝对不提前松爪】；

4. 【阶段 3: 等手停下满 3 秒，再判定松开交付！】
   - 用户将手移动到心仪位置并【静止停下】；
   - 系统检测到手部进入静止状态，屏幕亮起黄色倒计时进度条 (0.0s -> 3.0s)；
   - 若中途手又动了，计时自动清零重来，机械臂继续跟手；
   - 只有当手部连续静止保持满 3.0 秒（确认用户已准备好接取），夹爪才正式平稳松开至 50% 递交纸巾！
   - （同时支持人手直接轻拽瞬时松爪作为物理冗余保护）。

5. 【阶段 4: 优雅避让后撤与自动循环】
   - 递送后机械臂自动后仰 15° 礼让出空间；
   - 倒计时 3 秒自动复位开启下一轮抓取！随时可按 [R] 手动立即重试。
"""

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
from ultralytics import YOLO

from lerobot.cameras.opencv.configuration_opencv import OpenCVCameraConfig
from lerobot.policies.act.modeling_act import ACTPolicy
from lerobot.robots.so101_follower.config_so101_follower import SO101FollowerConfig
from lerobot.robots.so101_follower.so101_follower import SO101Follower
from lerobot.utils.control_utils import predict_action
from lerobot.utils.robot_utils import busy_wait
from lerobot.utils.utils import get_safe_torch_device


class HandVisualTracker:
    """基于轻量级 YOLO 的高速 CPU 手部检测与视觉伺服计算器"""

    def __init__(self, model_path, conf_thresh=0.25, imgsz=320):
        print(f"[YOLO] 正在加载轻量级手部模型: {model_path} ...")
        self.model = YOLO(model_path)
        self.conf_thresh = conf_thresh
        self.imgsz = imgsz

        # 视觉伺服控制增益 (P 控制，平滑微调)
        self.kp_pan = 1.6
        self.kp_lift = 1.2
        self.max_pan_step = 2.2
        self.max_lift_step = 1.8

        # 手部平滑滤波器
        self.last_target_cx = 320.0
        self.last_target_cy = 240.0
        self.filter_alpha = 0.50

    def detect_hand(self, bgr_img):
        """执行轻量推理，返回置信度最高的人手框及中心坐标"""
        results = self.model.predict(
            bgr_img,
            imgsz=self.imgsz,
            conf=self.conf_thresh,
            device='cpu',
            verbose=False,
        )
        boxes = results[0].boxes
        if boxes is None or len(boxes) == 0:
            return None

        best_box = None
        best_conf = -1.0
        for box in boxes:
            conf = float(box.conf[0])
            if conf > best_conf:
                best_conf = conf
                coords = box.xyxy[0].cpu().numpy()
                best_box = coords

        x1, y1, x2, y2 = best_box
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        w = x2 - x1
        h = y2 - y1

        self.last_target_cx = self.filter_alpha * cx + (1.0 - self.filter_alpha) * self.last_target_cx
        self.last_target_cy = self.filter_alpha * cy + (1.0 - self.filter_alpha) * self.last_target_cy

        return {
            'box': (int(x1), int(y1), int(x2), int(y2)),
            'cx': self.last_target_cx,
            'cy': self.last_target_cy,
            'w': w,
            'h': h,
            'conf': best_conf,
        }

    def compute_following_delta(self, hand_info, img_w=640, img_h=480):
        """根据手眼相机几何反解舵机修正量 (Visual Servoing Delta)"""
        if hand_info is None:
            return 0.0, 0.0

        norm_ex = (hand_info['cx'] - (img_w / 2.0)) / (img_w / 2.0)
        norm_ey = (hand_info['cy'] - (img_h / 2.0)) / (img_h / 2.0)

        # 死区控制: 小于 8% 时绝不晃动
        if abs(norm_ex) < 0.08:
            norm_ex = 0.0
        if abs(norm_ey) < 0.08:
            norm_ey = 0.0

        delta_pan = norm_ex * self.kp_pan
        delta_pan = np.clip(delta_pan, -self.max_pan_step, self.max_pan_step)

        delta_lift = norm_ey * self.kp_lift
        delta_lift = np.clip(delta_lift, -self.max_lift_step, self.max_lift_step)

        return delta_pan, delta_lift


def main():
    parser = argparse.ArgumentParser(description='SO-ARM101 ACT抓取 + YOLO 3秒静止确认智能递送系统')
    parser.add_argument('--task', type=str, default='tissue', choices=['tissue', 'eyemask'], help='任务类型')
    parser.add_argument('--model-path', type=str, default=None, help='ACT模型路径 (默认自动匹配)')
    parser.add_argument('--hand-model', type=str, default='D:/group project/models/hand_yolo/hand_yolov8n.pt', help='YOLO手部模型路径')
    parser.add_argument('--port', type=str, default='COM5', help='从臂串口号 (默认 COM5)')
    parser.add_argument('--camera-index', type=int, default=0, help='手眼相机索引 (默认 0)')
    parser.add_argument('--fps', type=int, default=30, help='控制循环帧率 (默认 30)')
    parser.add_argument('--smooth-alpha', type=float, default=0.65, help='动作EMA平滑系数 (默认 0.65)')
    parser.add_argument('--pan-gain', type=float, default=1.0, help='动态左转增益')
    parser.add_argument('--pan-offset', type=float, default=0.0, help='底座静态偏置角度')
    parser.add_argument('--lift-offset', type=float, default=0.0, help='大臂静态高度偏置角度')
    parser.add_argument('--n-action-steps', type=int, default=60, help='重规划步长 (默认 60)')
    parser.add_argument('--still-time', type=float, default=3.0, help='手部静止保持确认时间（秒，默认 3.0 秒）')
    parser.add_argument('--still-thresh', type=float, default=38.0, help='手部判定为静止的位移容差（像素，默认 38px）')
    parser.add_argument('--tug-thresh', type=float, default=4.0, help='人手轻拽外力阻抗感应阈值 (度)')
    parser.add_argument('--follow-only', action='store_true', default=False, help='直接启动手部跟随模式 (跳过ACT抓取)')
    args = parser.parse_args()

    # 路径匹配
    if args.model_path is None:
        if args.task == 'tissue':
            args.model_path = 'D:/group project/models/act_tissue'
        else:
            args.model_path = 'D:/group project/models/act_eyemask'

    task_desc = 'Grasp the tissue and handover to human hand' if args.task == 'tissue' else 'Grasp the eye mask and handover to human hand'

    print('=' * 75)
    print('🤖 DreamGuardian Next - ACT 具身抓取 + 【手部跟随与3秒静止确认递送】系统')
    print(f'📦 ACT 策略模型: {args.model_path}')
    print(f'👁️ YOLO 手部模型: {args.hand_model}')
    print(f'🔌 机械臂从臂: {args.port} | 📷 手眼相机: Index {args.camera_index}')
    print(f'⏱️ 静止释放设定: 手动则持续跟随；【手静止停住满 {args.still_time:.1f} 秒】才正式松爪！')
    print('💡 快捷键: [F] 立即进入/退出跟随 | [R] 重新开局抓取 | [Q] 安全退出')
    print('=' * 75)

    # 1. 加载 ACT 策略模型
    print('\n[1/3] 正在加载 ACT 策略神经网络...')
    policy = ACTPolicy.from_pretrained(args.model_path)
    policy.config.n_action_steps = args.n_action_steps
    policy.eval()
    device = get_safe_torch_device('cpu')
    policy.to(device)
    print('✓ ACT 抓取策略加载完成！')

    # 2. 加载 YOLO 手部检测模型
    print('\n[2/3] 正在加载 YOLO 手部检测模型 (CPU 加速)...')
    tracker = HandVisualTracker(args.hand_model, conf_thresh=0.25, imgsz=320)
    print('✓ YOLO 手部检测器加载完成！')

    # 3. 初始化硬件机械臂与相机
    print('\n[3/3] 正在连接 SO-ARM101 从臂与手眼相机...')
    camera_cfg = OpenCVCameraConfig(
        index_or_path=args.camera_index,
        fps=args.fps,
        width=640,
        height=480,
    )
    robot_cfg = SO101FollowerConfig(
        port=args.port,
        id='follower',
        cameras={'handeye': camera_cfg},
    )
    robot = SO101Follower(robot_cfg)
    robot.connect()
    print('✓ 从臂与手眼相机已全部连接就绪！\n')

    policy.reset()
    start_time = time.time()
    step = 0
    smoothed_action = None

    system_state = 'YOLO_HAND_FOLLOW' if args.follow_only else 'ACT_GRASP_AND_LIFT'
    seen_open = False
    has_grasped = False
    grasp_step = 0

    # 手部静止检测状态变量
    anchor_cx = None
    anchor_cy = None
    still_start_time = time.time()
    still_time = 0.0
    lost_frames = 0

    delivery_timestamp = 0.0
    retreat_start_time = 0.0
    completed_timestamp = 0.0
    trigger_source = 'NONE'

    cv2.namedWindow('SO-ARM101 Intelligent Hand-Delivery Feed', cv2.WINDOW_AUTOSIZE)

    print('🚀 系统正式启动！')
    if args.follow_only:
        print(f'👉 [直接跟随模式] 机械臂已就位！手移动机械臂跟随；【停下手保持 {args.still_time:.1f} 秒】将自动松爪！\n')
    else:
        print('👉 [全流程模式] 抓取升空 -> 随手而动 -> 手静止停下3秒自动松爪递送。\n')

    try:
        while True:
            loop_start = time.perf_counter()
            step += 1
            elapsed = time.time() - start_time

            obs = robot.get_observation()
            img = obs['handeye']
            bgr_img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)

            # 全程实时检测人手并绘制画面
            hand_info = tracker.detect_hand(bgr_img)
            if hand_info:
                x1, y1, x2, y2 = hand_info['box']
                cx, cy = int(hand_info['cx']), int(hand_info['cy'])
                conf = hand_info['conf']
                w, h = hand_info['w'], hand_info['h']

                if system_state == 'ACT_GRASP_AND_LIFT':
                    box_color = (255, 200, 0)
                    label_text = f"Hand {conf:.2f} (ACT Grasping...)"
                else:
                    # 跟随阶段：静止中显黄色，移动中显绿色
                    box_color = (0, 255, 255) if still_time > 0.3 else (0, 255, 0)
                    label_text = f"Hand {conf:.2f} ({w}x{h})"

                cv2.rectangle(bgr_img, (x1, y1), (x2, y2), box_color, 2)
                cv2.circle(bgr_img, (cx, cy), 5, (0, 0, 255), -1)
                if system_state == 'YOLO_HAND_FOLLOW':
                    cv2.line(bgr_img, (320, 240), (cx, cy), (0, 255, 255), 1)
                cv2.putText(bgr_img, label_text, (x1, max(22, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.52, box_color, 2)

            motor_names = list(robot.action_features.keys())
            state_vector = np.array([obs[k] for k in motor_names], dtype=np.float32)

            # =================================================================
            # 阶段 1: ACT 纯净策略抓取与升空运送
            # =================================================================
            if system_state == 'ACT_GRASP_AND_LIFT':
                obs_frame = {
                    'observation.state': state_vector,
                    'observation.images.handeye': np.array(img, dtype=np.uint8),
                }

                action_tensor = predict_action(
                    obs_frame,
                    policy,
                    device,
                    policy.config.use_amp,
                    task=task_desc,
                    robot_type=robot.robot_type,
                )
                action_dict = {key: action_tensor[i].item() for i, key in enumerate(robot.action_features)}

                if smoothed_action is None or args.smooth_alpha >= 1.0:
                    smoothed_action = {k: v for k, v in action_dict.items()}
                else:
                    for k in action_dict:
                        smoothed_action[k] = args.smooth_alpha * action_dict[k] + (1.0 - args.smooth_alpha) * smoothed_action[k]

                final_action = {k: v for k, v in smoothed_action.items()}
                raw_gripper = smoothed_action.get('gripper.pos', 100.0)

                if 'shoulder_pan.pos' in final_action:
                    if args.pan_gain != 1.0 and final_action['shoulder_pan.pos'] < 0:
                        final_action['shoulder_pan.pos'] *= args.pan_gain
                    if args.pan_offset != 0.0:
                        final_action['shoulder_pan.pos'] += args.pan_offset

                if args.lift_offset != 0.0 and 'shoulder_lift.pos' in final_action:
                    final_action['shoulder_lift.pos'] += args.lift_offset

                obs_lift = obs.get('shoulder_lift.pos', -100.0)

                # 1. 开爪接近
                if raw_gripper < 80.0:
                    seen_open = True

                # 2. 闭爪咬死纸巾
                if seen_open and raw_gripper >= 85.0:
                    if not has_grasped:
                        has_grasped = True
                        grasp_step = step
                        print(f'\n✓ [抓取闭合成功] 机械臂在 Step {step} 紧紧夹住纸巾！')
                        print('🔒 [夹爪锁定] 升空运送全程绝对锁定 100% 紧闭，绝不提前松开！')

                # 一旦抓取成功，夹爪死死锁定 100%
                if has_grasped:
                    final_action['gripper.pos'] = 100.0
                else:
                    final_action['gripper.pos'] = raw_gripper

                # 3. 判定何时到达空中递送位置 (ACT 准备松爪或升空到位)
                if has_grasped:
                    steps_since_grasp = step - grasp_step
                    # 当升空且 ACT 开始想要在空中松爪 (raw_gripper < 85)，或者升空超过 90 步
                    if (raw_gripper < 85.0 and steps_since_grasp > 35) or steps_since_grasp > 95:
                        system_state = 'YOLO_HAND_FOLLOW'
                        anchor_cx, anchor_cy = None, None
                        still_start_time = time.time()
                        still_time = 0.0
                        lost_frames = 0
                        print('\n🎯 [到达递送点] ACT 已完全按轨迹将纸巾运送至目标空中位置！')
                        print('🤝 [开始动态跟随] 夹爪死死咬住纸巾，开启 YOLO 手部跟随！')
                        print(f'👉 手移动机械臂跟随；【请停下手部保持 {args.still_time:.1f} 秒】，将自动松爪递送！\n')

                # 4. 抓取超时自动重试
                if not has_grasped and step > 240:
                    print('\n⚠️ [未成功抓取] 超时未能抓紧纸巾，正在自动重试抓取...')
                    policy.reset()
                    start_time = time.time()
                    step = 0
                    smoothed_action = None
                    seen_open = False
                    has_grasped = False
                    continue

                robot.send_action(final_action)
                state_hud_text = f'PHASE 1: ACT RUNNING | Step {step} | Gripper: {final_action["gripper.pos"]:.0f}%'
                hud_color = (0, 255, 200)

            # =================================================================
            # 阶段 2: YOLO 手部动态跟随 + 【停下满 3 秒才释放】
            # =================================================================
            elif system_state == 'YOLO_HAND_FOLLOW':
                delta_pan, delta_lift = tracker.compute_following_delta(hand_info)

                current_pan = obs.get('shoulder_pan.pos', 0.0)
                current_lift = obs.get('shoulder_lift.pos', -35.0)

                target_pan = np.clip(current_pan + delta_pan, -80.0, 80.0)
                target_lift = np.clip(current_lift + delta_lift, -65.0, -10.0)

                follow_action = {
                    'shoulder_pan.pos': target_pan,
                    'shoulder_lift.pos': target_lift,
                    'elbow_flex.pos': smoothed_action.get('elbow_flex.pos', 20.0) if smoothed_action else 20.0,
                    'wrist_flex.pos': smoothed_action.get('wrist_flex.pos', 20.0) if smoothed_action else 20.0,
                    'wrist_roll.pos': smoothed_action.get('wrist_roll.pos', -50.0) if smoothed_action else -50.0,
                    'gripper.pos': 100.0,  # 夹爪依然 100% 紧咬纸巾，绝不松爪！
                }
                robot.send_action(follow_action)
                smoothed_action = follow_action

                # ★★★ 核心算法：手部静止/悬停 3 秒智能检测 ★★★
                is_hand_moving = True
                if hand_info is not None:
                    lost_frames = 0
                    cx, cy = hand_info['cx'], hand_info['cy']

                    if anchor_cx is None or anchor_cy is None:
                        anchor_cx, anchor_cy = cx, cy
                        still_start_time = time.time()
                        still_time = 0.0
                    else:
                        disp = np.hypot(cx - anchor_cx, cy - anchor_cy)
                        # 在静止容差范围内（默认 38 像素，允许轻微呼吸颤抖）
                        if disp < args.still_thresh:
                            is_hand_moving = False
                            still_time = time.time() - still_start_time
                        else:
                            # 手部发生明显位移 -> 正在移动跟随！重置锚点，清零静止计时！
                            anchor_cx, anchor_cy = cx, cy
                            still_start_time = time.time()
                            still_time = 0.0
                else:
                    # 容忍最多 5 帧闪烁，超过则重置
                    lost_frames += 1
                    if lost_frames > 5:
                        anchor_cx, anchor_cy = None, None
                        still_start_time = time.time()
                        still_time = 0.0

                # 物理轻拽备选冗余
                lift_err = abs(obs.get('shoulder_lift.pos', target_lift) - target_lift)
                current_wrist = obs.get('wrist_flex.pos', 20.0)
                target_wrist = smoothed_action.get('wrist_flex.pos', 20.0)
                wrist_err = abs(current_wrist - target_wrist)
                is_tugged = (lift_err > args.tug_thresh or wrist_err > args.tug_thresh)

                # ★★★ 判定条件：手部持续静止停下满 3 秒 OR 物理轻拽纸巾 ★★★
                if still_time >= args.still_time or is_tugged:
                    if is_tugged:
                        trigger_source = '物理轻拽顺应感应 (Physical Tug)'
                    else:
                        trigger_source = f'手部静止停下满 {args.still_time:.1f} 秒 (Hand Still 3s)'

                    system_state = 'SMART_DELIVERED'
                    delivery_timestamp = time.time()
                    print(f'\n🎉 [确认递送触发] {trigger_source}！')
                    print('👉 夹爪正式平稳松开递送纸巾！随后将自动后撤避让...')

                # 界面状态显示与 3 秒进度条绘制
                if hand_info:
                    conf_val = hand_info['conf']
                    if not is_hand_moving and still_time > 0.2:
                        # 正在静止倒计时
                        prog = min(1.0, still_time / float(args.still_time))
                        # 绘制底部宽进度条
                        cv2.rectangle(bgr_img, (120, 415), (520, 445), (40, 40, 40), -1)
                        fill_w = int(400 * prog)
                        cv2.rectangle(bgr_img, (120, 415), (120 + fill_w, 445), (0, 255, 255), -1)
                        remain_s = max(0.0, args.still_time - still_time)
                        cv2.putText(bgr_img, f'HOLD STILL TO RELEASE: {still_time:.1f}s / {args.still_time:.1f}s ({int(prog*100)}%)', (130, 436), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (0, 0, 0), 2)
                        state_hud_text = f'HAND STILL ({still_time:.1f}s/{args.still_time:.1f}s) - Release in {remain_s:.1f}s'
                        hud_color = (0, 255, 255)
                    else:
                        state_hud_text = f'YOLO FOLLOWING (Conf: {conf_val:.2f}) | Move to spot, then HOLD STILL'
                        hud_color = (0, 255, 0)
                else:
                    state_hud_text = 'SEARCHING FOR HAND... (Holding Tissue Steady at Handover Pose)'
                    hud_color = (0, 165, 255)

            # =================================================================
            # 阶段 3: 智能释放完成，夹爪打开至 50% 安全开度
            # =================================================================
            elif system_state == 'SMART_DELIVERED':
                release_action = dict(smoothed_action) if smoothed_action else {}
                release_action['gripper.pos'] = 50.0  # 正式平稳松开递送！
                robot.send_action(release_action)

                state_hud_text = f'DELIVERED! ({trigger_source})'
                hud_color = (0, 255, 0)

                if time.time() - delivery_timestamp > 1.2:
                    system_state = 'AUTO_RETREATING'
                    retreat_start_time = time.time()
                    print('👉 纸巾已送达，机械臂开始自动后撤避让...')

            # =================================================================
            # 阶段 4: 优雅后撤避让 (大臂小幅后仰抬升)
            # =================================================================
            elif system_state == 'AUTO_RETREATING':
                retreat_action = dict(smoothed_action) if smoothed_action else {}
                current_lift = obs.get('shoulder_lift.pos', -35.0)
                retreat_action['shoulder_lift.pos'] = np.clip(current_lift - 0.8, -60.0, -10.0)
                retreat_action['gripper.pos'] = 50.0
                robot.send_action(retreat_action)
                smoothed_action = retreat_action

                state_hud_text = 'AUTO-RETREATING (Giving you space)...'
                hud_color = (255, 180, 0)

                if time.time() - retreat_start_time > 1.5:
                    system_state = 'CYCLE_COMPLETED'
                    completed_timestamp = time.time()
                    print('\n✨ [全流程交互完成] 机械臂已安全后撤避让！')
                    print('👉 3 秒后将自动开启下一轮抓取，或按 [R] 立即重来，按 [Q] 退出。')

            # =================================================================
            # 阶段 5: 交互闭环完成，自动倒计时进入下一轮尝试
            # =================================================================
            elif system_state == 'CYCLE_COMPLETED':
                wait_action = dict(smoothed_action) if smoothed_action else {}
                wait_action['gripper.pos'] = 50.0
                robot.send_action(wait_action)

                remain_s = max(0.0, 3.0 - (time.time() - completed_timestamp))
                state_hud_text = f'CYCLE COMPLETE! Next round in {remain_s:.1f}s | [R] Instant Reset | [Q] Quit'
                hud_color = (255, 200, 0)

                if remain_s <= 0.0:
                    print('\n🔄 [自动下一轮] 正在自动重置策略，开启新一轮抓取！')
                    policy.reset()
                    start_time = time.time()
                    step = 0
                    smoothed_action = None
                    system_state = 'ACT_GRASP_AND_LIFT'
                    seen_open = False
                    has_grasped = False
                    anchor_cx, anchor_cy = None, None
                    still_time = 0.0
                    trigger_source = 'NONE'

            # 绘制瞄准标与 HUD 状态栏
            cv2.drawMarker(bgr_img, (320, 240), (100, 100, 100), cv2.MARKER_CROSS, 20, 1)
            cv2.rectangle(bgr_img, (0, 0), (640, 50), (20, 20, 20), -1)
            cv2.putText(bgr_img, state_hud_text, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, hud_color, 2)
            cv2.putText(bgr_img, f'State: {system_state} | [F] Toggle Follow | [R] Reset | [Q] Quit', (10, 44), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (200, 200, 200), 1)

            cv2.imshow('SO-ARM101 Intelligent Hand-Delivery Feed', bgr_img)
            key = cv2.waitKey(1) & 0xFF

            if key == ord('q') or key == ord('Q') or key == 27:
                print('\n[退出] 用户按下退出键，安全停机。')
                break
            elif key == ord('f') or key == ord('F'):
                if system_state != 'YOLO_HAND_FOLLOW':
                    print('\n⚡ [手动切换] 强制切入【阶段 2: YOLO 手部动态跟随模式】！')
                    system_state = 'YOLO_HAND_FOLLOW'
                    anchor_cx, anchor_cy = None, None
                    still_time = 0.0
                else:
                    print('\n⚡ [手动切换] 切换回【阶段 1: ACT 纯净抓取模式】！')
                    system_state = 'ACT_GRASP_AND_LIFT'
            elif key == ord('r') or key == ord('R'):
                print('\n🔄 [重置] 重新启动新一轮 ACT 抓取！')
                policy.reset()
                start_time = time.time()
                step = 0
                smoothed_action = None
                system_state = 'ACT_GRASP_AND_LIFT'
                seen_open = False
                has_grasped = False
                anchor_cx, anchor_cy = None, None
                still_time = 0.0
                trigger_source = 'NONE'

            # 保持 30Hz 控制循环
            dt = time.perf_counter() - loop_start
            busy_wait(1.0 / args.fps - dt)

    except KeyboardInterrupt:
        print('\n[中断] 用户强制中断...')
    finally:
        print('正在安全断开机械臂并释放力矩...')
        robot.disconnect()
        cv2.destroyAllWindows()
        print('✓ 运行结束！')


if __name__ == '__main__':
    main()
