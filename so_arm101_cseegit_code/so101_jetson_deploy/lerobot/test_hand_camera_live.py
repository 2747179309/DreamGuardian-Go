"""
YOLO 手部实时检测与相机画面独立验证脚本 (无需连接机械臂)
=========================================================
功能：
1. 独立启动手眼相机（默认 Index 0）或笔记本自带相机（Index 1）；
2. 实时运行 CPU YOLO 手部检测网络，可视化手部检测绿框与置信度；
3. 实时显示 FPS 与推理延迟（毫秒）；
4. 模拟方案 B 视觉近场接取意图判定（伸手靠近时进度条增长）；
5. 快捷键：
   - 按 [C] 键：在相机 0 与相机 1 之间快速切换；
   - 按 [Q] 键：退出测试。
"""

import argparse
import time
import cv2
import numpy as np
from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser(description="YOLO 手部实时检测与相机验证工具")
    parser.add_argument("--camera-index", type=int, default=0, help="相机索引号 (默认 0)")
    parser.add_argument("--hand-model", type=str, default="D:/group project/models/hand_yolo/hand_yolov8n.pt", help="YOLO模型路径")
    parser.add_argument("--conf", type=float, default=0.25, help="检测置信度阈值 (默认 0.25)")
    parser.add_argument("--imgsz", type=int, default=320, help="推理分辨率 (默认 320)")
    args = parser.parse_args()

    print("=" * 65)
    print("👁️ YOLO 手部检测实时视觉验证工具 (独立模式，无需机械臂)")
    print(f"📦 手部模型: {args.hand_model}")
    print(f"📷 当前相机: Index {args.camera_index} (按 [C] 键可随时切换相机)")
    print(f"🎯 置信度阈值: {args.conf} | 分辨率: {args.imgsz}")
    print("👉 请在相机前伸手，观察是否有绿色手部识别框与坐标跟随！")
    print("=" * 65)

    print("\n正在加载轻量级 YOLO 模型...")
    model = YOLO(args.hand_model)
    print("✓ 模型加载成功！正在启动摄像头...\n")

    current_cam_idx = args.camera_index
    cap = cv2.VideoCapture(current_cam_idx)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    if not cap.isOpened():
        print(f"❌ 无法打开相机 {current_cam_idx}，尝试切换相机...")
        current_cam_idx = 1 if current_cam_idx == 0 else 0
        cap = cv2.VideoCapture(current_cam_idx)

    win_name = "YOLO Hand Tracking Test (Independent Feed)"
    cv2.namedWindow(win_name, cv2.WINDOW_AUTOSIZE)

    contact_frames = 0
    required_frames = 12

    fps_list = []

    try:
        while True:
            t0 = time.perf_counter()
            ret, frame = cap.read()
            if not ret:
                print("⚠️ 无法读取相机画面，重试中...")
                time.sleep(0.05)
                continue

            # YOLO 预测
            t_infer_start = time.perf_counter()
            results = model.predict(
                frame,
                imgsz=args.imgsz,
                conf=args.conf,
                device="cpu",
                verbose=False,
            )
            infer_ms = (time.perf_counter() - t_infer_start) * 1000.0

            boxes = results[0].boxes
            hand_detected = False
            is_close = False

            if boxes is not None and len(boxes) > 0:
                hand_detected = True
                # 绘制所有检测到的手部框
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
                    conf = float(box.conf[0])
                    cx, cy = int((x1 + x2) / 2), int((y1 + y2) / 2)
                    w, h = x2 - x1, y2 - y1
                    area = w * h

                    # 方案 B 近场接取特征：包围盒尺寸足够大且居中
                    is_close = (w >= 185 or h >= 185 or area >= 35000) and (110 <= cx <= 530)

                    box_color = (0, 255, 255) if is_close else (0, 255, 0)

                    # 绘制检测框与中心点
                    cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)
                    cv2.circle(frame, (cx, cy), 6, (0, 0, 255), -1)
                    cv2.line(frame, (320, 240), (cx, cy), (0, 255, 255), 1)

                    # 标签
                    label = f"Hand {conf:.2f} ({w}x{h})"
                    cv2.putText(frame, label, (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, box_color, 2)

            # 近场计数
            if is_close:
                contact_frames += 1
            else:
                contact_frames = max(0, contact_frames - 1)

            # 绘制进度条
            if contact_frames > 0:
                prog = min(1.0, contact_frames / float(required_frames))
                cv2.rectangle(frame, (160, 420), (480, 445), (40, 40, 40), -1)
                cv2.rectangle(frame, (160, 420), (160 + int(320 * prog), 445), (0, 255, 255), -1)
                txt = "TRIGGERED! (Claw auto-releases)" if prog >= 1.0 else f"APPROACHING INTENT: {int(prog*100)}%"
                cv2.putText(frame, txt, (170, 438), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)

            # 计算 FPS
            dt = time.perf_counter() - t0
            fps = 1.0 / max(1e-5, dt)
            fps_list.append(fps)
            if len(fps_list) > 30:
                fps_list.pop(0)
            avg_fps = sum(fps_list) / len(fps_list)

            # HUD 顶栏
            cv2.rectangle(frame, (0, 0), (640, 45), (20, 20, 20), -1)
            cv2.drawMarker(frame, (320, 240), (100, 100, 100), cv2.MARKER_CROSS, 20, 1)

            if hand_detected:
                status_text = f"YOLO: HAND DETECTED! | Infer: {infer_ms:.1f}ms | FPS: {avg_fps:.1f}"
                status_color = (0, 255, 0)
            else:
                status_text = f"YOLO: SEARCHING HAND... | Infer: {infer_ms:.1f}ms | FPS: {avg_fps:.1f}"
                status_color = (0, 165, 255)

            cv2.putText(frame, status_text, (10, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, status_color, 2)
            cv2.putText(frame, f"Cam {current_cam_idx} | Press [C] Switch Cam | [Q] Quit", (10, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)

            cv2.imshow(win_name, frame)
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == ord('Q') or key == 27:
                print("\n[退出] 验证完成。")
                break
            elif key == ord('c') or key == ord('C'):
                # 切换相机
                cap.release()
                current_cam_idx = 1 if current_cam_idx == 0 else 0
                print(f"\n🔄 正在切换至相机 {current_cam_idx}...")
                cap = cv2.VideoCapture(current_cam_idx)
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    finally:
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
