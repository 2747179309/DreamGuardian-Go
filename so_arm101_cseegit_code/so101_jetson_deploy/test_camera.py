#!/usr/bin/env python
"""
手眼摄像头快速测试脚本 (Jetson / Linux / PC)
用于确认摄像头索引号 (Index)、实际分辨率与画面输出。

运行方式:
  python3 test_camera.py --index 0
  python3 test_camera.py --index 1
"""

import argparse
import glob
import os
import platform
import time
import cv2


def scan_video_devices():
    if platform.system() != "Windows":
        return sorted(glob.glob("/dev/video*"))
    return []


def main():
    parser = argparse.ArgumentParser(description="手眼摄像头测试工具")
    parser.add_argument("--index", type=int, default=0, help="摄像头设备索引 (默认 0)")
    parser.add_argument("--width", type=int, default=640, help="图像宽度 (默认 640)")
    parser.add_argument("--height", type=int, default=480, help="图像高度 (默认 480)")
    parser.add_argument("--fps", type=int, default=30, help="目标帧率 (默认 30)")
    parser.add_argument("--save", type=str, default="camera_test.jpg", help="测试截图保存路径")
    parser.add_argument("--no-display", action="store_true", help="无界面模式 (仅抓图保存)")
    args = parser.parse_args()

    print("=" * 55)
    print("📷 SO-ARM101 手眼摄像头快速诊断工具")
    devices = scan_video_devices()
    if devices:
        print(f"🔍 系统检测到的视频设备: {devices}")
    print(f"👉 正在尝试打开摄像头 Index: {args.index} ...")
    print("=" * 55)

    cap = cv2.VideoCapture(args.index)
    if not cap.isOpened():
        print(f"\n❌ 无法打开摄像头 index {args.index}！")
        if devices:
            print(f"提示: 请检查是否应该使用其他索引，例如尝试 --index 1 或 --index 2")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
    cap.set(cv2.CAP_PROP_FPS, args.fps)

    actual_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    actual_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    actual_fps = cap.get(cv2.CAP_PROP_FPS)

    print(f"✓ 摄像头成功开启！")
    print(f"📐 实际设定分辨率: {actual_w} x {actual_h} | 设定帧率: {actual_fps} FPS")

    # 预热读取 10 帧并测算真实采样速度
    start_t = time.time()
    for _ in range(10):
        ret, frame = cap.read()
    fps_measured = 10.0 / max(time.time() - start_t, 1e-4)
    print(f"⚡ 实际抓帧速率: {fps_measured:.1f} FPS")

    ret, frame = cap.read()
    if ret:
        cv2.imwrite(args.save, frame)
        print(f"📸 已成功捕获并保存一帧图像至: {os.path.abspath(args.save)}")
    else:
        print("❌ 读取图像帧失败！")

    if not args.no_display:
        try:
            print("\n正在弹出实时画面预览窗口（按键盘 [Q] 键退出）...")
            cv2.namedWindow(f"Camera Test (Index {args.index})", cv2.WINDOW_AUTOSIZE)
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                cv2.putText(frame, f"Index {args.index} | {actual_w}x{actual_h} | Press Q to Exit",
                            (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                cv2.imshow(f"Camera Test (Index {args.index})", frame)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    break
            cv2.destroyAllWindows()
        except Exception as e:
            print(f"提示: 无法开启 GUI 窗口 ({e})，已仅保存图像文件。")

    cap.release()
    print("✓ 测试完成，摄像头已释放！\n")


if __name__ == "__main__":
    main()
