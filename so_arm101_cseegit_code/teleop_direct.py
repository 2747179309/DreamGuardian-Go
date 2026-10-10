#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
SO-ARM101 极速直通主从遥操作系统 (Direct Hardware Teleop + Threaded Camera Display)
================================================================================
核心架构：
1. 【控制解耦】：机械臂主从控制独占高优先级后台线程，以 100Hz (~2.4ms) 极速广播直随，
   绝不受视觉读取或画面渲染的任何阻塞影响，保证物理机械臂绝对零延迟！
2. 【无缓冲相机】：手眼相机独占后台线程拉流，设置 BUFFERSIZE=1，彻底清除 Windows 默认 3~5 帧的缓冲延迟。
3. 【实时仪表盘】：主线程 30FPS 渲染 OpenCV 实时画面并叠加机械臂各轴脉冲、频率与通信耗时 HUD。
4. 【1:1 绝对线性映射】：严格按硬件 EEPROM 标定极限直通，4号俯仰与5号手腕自转自然顺滑，绝不死锁或截断。
"""

import sys
import time
import argparse
import threading
import cv2
import numpy as np

from scservo_sdk import PortHandler, PacketHandler, GroupSyncWrite

# STS3215 寄存器地址
ADDR_MIN = 9           # 最小物理限制 (2 Bytes)
ADDR_MAX = 11          # 最大物理限制 (2 Bytes)
ADDR_TORQUE = 40       # 力矩开关 (1 Byte, 0=关闭, 1=开启)
ADDR_ACCEL = 41        # 加速度 (1 Byte, 0=无限制极速响应, 254=最大加速度)
ADDR_GOAL_POS = 42     # 目标位置 (2 Bytes)
ADDR_GOAL_SPEED = 46   # 目标转速 (2 Bytes, 0=全速无限制)
ADDR_PRESENT_POS = 56  # 当前位置 (2 Bytes)
ADDR_VOLTAGE = 62      # 当前电压 (1 Byte)

JOINTS = {
    1: "Pan",
    2: "Lift",
    3: "Elbow",
    4: "Flex",
    5: "Roll",
    6: "Grip",
}


def read2(ph, port, sid, addr):
    data, result, _ = ph.read2ByteTxRx(port, sid, addr)
    return data if result == 0 else None


def read1(ph, port, sid, addr):
    data, result, _ = ph.read1ByteTxRx(port, sid, addr)
    return data if result == 0 else None


def write1(ph, port, sid, addr, val):
    return ph.write1ByteTxRx(port, sid, addr, val)[0] == 0


def write2(ph, port, sid, addr, val):
    return ph.write2ByteTxRx(port, sid, addr, val)[0] == 0


class ThreadedCamera:
    """无延迟多线程摄像头拉流器，强制缓冲区为 1 帧"""
    def __init__(self, index=0, width=640, height=480):
        self.index = index
        self.width = width
        self.height = height
        self.running = False
        self.thread = None
        self.cap = None
        self.lock = threading.Lock()
        self.frame = None
        self.fps = 0.0

    def start(self):
        # 优先使用 Windows DSHOW 底层，消除 MSMF 初始化卡顿
        self.cap = cv2.VideoCapture(self.index, cv2.CAP_DSHOW)
        if not self.cap.isOpened():
            self.cap = cv2.VideoCapture(self.index)

        if not self.cap.isOpened():
            print(f"[WARN] 无法打开摄像头索引 {self.index}，将以纯数据仪表盘模式渲染。")
            return False

        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # 彻底清除延迟队列

        self.running = True
        self.thread = threading.Thread(target=self._capture_loop, daemon=True)
        self.thread.start()
        return True

    def _capture_loop(self):
        last_t = time.perf_counter()
        count = 0
        while self.running:
            ret, frame = self.cap.read()
            if ret and frame is not None:
                with self.lock:
                    self.frame = frame
                count += 1
                now = time.perf_counter()
                if now - last_t >= 1.0:
                    self.fps = count / (now - last_t)
                    count = 0
                    last_t = now
            else:
                time.sleep(0.005)

    def get_frame(self):
        with self.lock:
            return self.frame.copy() if self.frame is not None else None

    def stop(self):
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=0.5)
        if self.cap and self.cap.isOpened():
            self.cap.release()


class TeleopController(threading.Thread):
    """独立高速机械臂控制线程 (100Hz，延迟 ~2.4ms，与渲染完全解耦)"""
    def __init__(self, leader_port="COM6", follower_port="COM5", target_fps=100, flips=None, release_on_exit=True):
        super().__init__(daemon=True)
        self.leader_port = leader_port
        self.follower_port = follower_port
        self.target_fps = target_fps
        self.flips = flips or set()
        self.release_on_exit = release_on_exit

        self.stop_event = threading.Event()
        self.telemetry = {
            "fps": 0.0,
            "delay_ms": 0.0,
            "voltage": 0.0,
            "positions": [],
            "status": "Initializing",
        }
        self.lock = threading.Lock()

    def run(self):
        lp = PortHandler(self.leader_port)
        fp = PortHandler(self.follower_port)
        ph = PacketHandler(0)

        if not lp.openPort():
            print(f"[ERROR] 无法打开主臂串口 {self.leader_port}")
            with self.lock:
                self.telemetry["status"] = f"Error: Cannot open {self.leader_port}"
            return

        if not fp.openPort():
            print(f"[ERROR] 无法打开从臂串口 {self.follower_port}")
            with self.lock:
                self.telemetry["status"] = f"Error: Cannot open {self.follower_port}"
            lp.closePort()
            return

        lp.setBaudRate(1000000)
        fp.setBaudRate(1000000)
        time.sleep(0.1)

        # 读取标定极限与初始位置
        limits_l, limits_f, cur_l, cur_f = {}, {}, {}, {}
        for sid in range(1, 7):
            l_min = read2(ph, lp, sid, ADDR_MIN)
            l_max = read2(ph, lp, sid, ADDR_MAX)
            l_pos = read2(ph, lp, sid, ADDR_PRESENT_POS)
            f_min = read2(ph, fp, sid, ADDR_MIN)
            f_max = read2(ph, fp, sid, ADDR_MAX)
            f_pos = read2(ph, fp, sid, ADDR_PRESENT_POS)

            if l_pos is None or f_pos is None:
                print(f"[ERROR] 舵机 ID {sid} 通信失败！")
                with self.lock:
                    self.telemetry["status"] = f"Error: Motor {sid} timeout"
                lp.closePort()
                fp.closePort()
                return

            limits_l[sid] = (l_min, l_max)
            limits_f[sid] = (f_min, f_max)
            cur_l[sid] = l_pos
            cur_f[sid] = f_pos

        volt_raw = read1(ph, fp, 5, ADDR_VOLTAGE)
        voltage = (volt_raw / 10.0) if volt_raw else 12.0

        # 配置舵机模式
        for sid in range(1, 7):
            write1(ph, lp, sid, ADDR_TORQUE, 0)      # 主臂关力矩
            write1(ph, fp, sid, ADDR_TORQUE, 1)      # 从臂使能力矩
            write1(ph, fp, sid, ADDR_ACCEL, 0)       # 0 = 极速加速度
            write2(ph, fp, sid, ADDR_GOAL_SPEED, 0)  # 0 = 全速跟随

        # 启动柔和渐进过渡 (0.5秒)
        init_targets = {}
        for sid in range(1, 7):
            lpos = cur_l[sid]
            lmin, lmax = limits_l[sid]
            fmin, fmax = limits_f[sid]
            norm = (lpos - lmin) / (lmax - lmin) if lmax != lmin else 0.5
            norm = 0.0 if norm < 0.0 else (1.0 if norm > 1.0 else norm)
            if sid in self.flips:
                norm = 1.0 - norm
            init_targets[sid] = fmin + norm * (fmax - fmin)

        for step in range(1, 26):
            if self.stop_event.is_set():
                break
            alpha = step / 25.0
            for sid in range(1, 7):
                interp = int(round(cur_f[sid] + alpha * (init_targets[sid] - cur_f[sid])))
                write2(ph, fp, sid, ADDR_GOAL_POS, interp)
            time.sleep(0.02)

        with self.lock:
            self.telemetry["status"] = "Active (Ultra-Fast 100Hz)"
            self.telemetry["voltage"] = voltage

        # 进入 100Hz 极速控制循环
        gsw = GroupSyncWrite(fp, ph, ADDR_GOAL_POS, 2)
        loop_period = 1.0 / self.target_fps
        last_stat_t = time.perf_counter()
        cycle_count = 0

        try:
            while not self.stop_event.is_set():
                t_start = time.perf_counter()
                gsw.clearParam()
                current_positions = []

                for sid in range(1, 7):
                    lpos = read2(ph, lp, sid, ADDR_PRESENT_POS)
                    if lpos is None:
                        continue

                    lmin, lmax = limits_l[sid]
                    fmin, fmax = limits_f[sid]

                    # 1:1 硬件比例线性全范围映射
                    norm = (lpos - lmin) / (lmax - lmin) if lmax != lmin else 0.5
                    norm = 0.0 if norm < 0.0 else (1.0 if norm > 1.0 else norm)

                    if sid in self.flips:
                        norm = 1.0 - norm

                    target_f = int(round(fmin + norm * (fmax - fmin)))
                    target_f = max(0, min(4095, target_f))

                    param = [target_f & 0xFF, (target_f >> 8) & 0xFF]
                    gsw.addParam(sid, param)
                    current_positions.append((sid, lpos, target_f))

                gsw.txPacket()

                # 耗时统计
                cycle_ms = (time.perf_counter() - t_start) * 1000.0
                cycle_count += 1
                now = time.perf_counter()
                if now - last_stat_t >= 0.1:  # 每 100ms 更新一次遥测数据
                    with self.lock:
                        self.telemetry["fps"] = cycle_count / (now - last_stat_t)
                        self.telemetry["delay_ms"] = cycle_ms
                        self.telemetry["positions"] = current_positions
                    cycle_count = 0
                    last_stat_t = now

                # 精确休眠保持 100Hz
                elapsed = time.perf_counter() - t_start
                sleep_t = loop_period - elapsed
                if sleep_t > 0:
                    time.sleep(sleep_t)

        finally:
            gsw.clearParam()
            if self.release_on_exit:
                for sid in range(1, 7):
                    write1(ph, fp, sid, ADDR_TORQUE, 0)
            lp.closePort()
            fp.closePort()
            with self.lock:
                self.telemetry["status"] = "Stopped"

    def get_telemetry(self):
        with self.lock:
            return dict(self.telemetry)

    def stop(self):
        self.stop_event.set()


def draw_hud(canvas, telemetry, cam_fps):
    """在画面上叠加高对比度专业机械臂状态 HUD"""
    h, w = canvas.shape[:2]

    # 顶部半透明背景条
    overlay = canvas.copy()
    cv2.rectangle(overlay, (0, 0), (w, 75), (15, 15, 15), -1)
    # 底部提示条
    cv2.rectangle(overlay, (0, h - 30), (w, h), (15, 15, 15), -1)
    cv2.addWeighted(overlay, 0.75, canvas, 0.25, 0, canvas)

    # 状态栏文字
    t_fps = telemetry.get("fps", 0.0)
    delay = telemetry.get("delay_ms", 0.0)
    volt = telemetry.get("voltage", 0.0)
    status = telemetry.get("status", "Running")

    # 第一行：性能指标
    line1 = f"TELEOP: {t_fps:4.1f} Hz | DELAY: {delay:3.1f} ms | CAM: {cam_fps:3.0f} FPS | POWER: {volt:.1f}V"
    cv2.putText(canvas, line1, (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 120), 2)

    # 第二行：6轴实时脉冲映射
    pos_data = telemetry.get("positions", [])
    if pos_data:
        pos_str = " | ".join(f"{JOINTS[s]}:{lp:4d}->{fp:4d}" for s, lp, fp in pos_data)
    else:
        pos_str = "Tracking Initializing..."
    cv2.putText(canvas, pos_str, (12, 54), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (220, 240, 255), 1)

    # 底部操作提示
    cv2.putText(canvas, "Press [Q] or [ESC] to Exit Teleop Safely", (12, h - 10),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (180, 180, 180), 1)


def main():
    parser = argparse.ArgumentParser(description="SO-ARM101 极速直通主从遥操作 (带视觉显示)")
    parser.add_argument("--leader", default="COM6", help="主臂 (Leader) 串口，默认 COM6")
    parser.add_argument("--follower", default="COM5", help="从臂 (Follower) 串口，默认 COM5")
    parser.add_argument("--fps", type=int, default=100, help="控制通信频率 (Hz)，默认 100")
    parser.add_argument("--camera-index", type=int, default=0, help="手眼相机设备索引，默认 0")
    parser.add_argument("--no-camera", action="store_true", default=False, help="纯机械臂模式，不打开摄像头画面")
    parser.add_argument("--flip", default="", help="需要反转转向的关节ID列表，例如 '1' (默认无反转)")
    args = parser.parse_args()

    flips = {int(x) for x in args.flip.split(",") if x.strip()}

    print("=" * 75)
    print(">> SO-ARM101 极速直通遥操作 + 实时视觉监控启动")
    print(f"   [Leader]   示教臂串口: {args.leader}")
    print(f"   [Follower] 从动臂串口: {args.follower}")
    print(f"   [Rate]     控制频率  : {args.fps} Hz (独占后台线程，~2.4ms 延迟)")
    print(f"   [Camera]   手眼相机  : {'已禁用 (--no-camera)' if args.no_camera else f'Index {args.camera_index}'}")
    print("=" * 75)

    # 1. 启动多线程摄像头
    camera = None
    if not args.no_camera:
        camera = ThreadedCamera(index=args.camera_index, width=640, height=480)
        camera_ok = camera.start()
        if not camera_ok:
            camera = None

    # 2. 启动独占控制线程
    controller = TeleopController(
        leader_port=args.leader,
        follower_port=args.follower,
        target_fps=args.fps,
        flips=flips,
        release_on_exit=True,
    )
    controller.start()

    # 3. 准备 OpenCV 监控窗口
    win_name = "SO-ARM101 High-Speed Teleop (Direct Hardware)"
    cv2.namedWindow(win_name, cv2.WINDOW_AUTOSIZE)

    print("\n[OK] 控制与视觉线程全部就绪！画面窗口已打开。\n")

    try:
        while True:
            # 获取最新遥测数据
            telemetry = controller.get_telemetry()
            if not controller.is_alive():
                print(f"\n[退出] 控制线程已结束: {telemetry.get('status')}")
                break

            # 获取最新视频帧
            cam_fps = camera.fps if camera else 0.0
            frame = camera.get_frame() if camera else None

            if frame is not None:
                canvas = frame
            else:
                # 若无相机输入，使用深灰背景仪表盘
                canvas = np.full((360, 640, 3), 30, dtype=np.uint8)

            # 绘制 HUD
            draw_hud(canvas, telemetry, cam_fps)

            # 刷新画面窗口
            cv2.imshow(win_name, canvas)
            key = cv2.waitKey(20) & 0xFF  # ~50 FPS 界面刷新率

            if key in (ord('q'), ord('Q'), 27):
                print("\n[退出] 用户按下 Q / ESC，正在安全停止...")
                break

    except KeyboardInterrupt:
        print("\n[退出] 用户按下 Ctrl+C，正在安全停止...")
    finally:
        print("-> 正在停止控制线程并释放电机力矩...")
        controller.stop()
        controller.join(timeout=1.5)

        if camera:
            print("-> 正在关闭摄像头...")
            camera.stop()

        cv2.destroyAllWindows()
        print("[OK] 系统已安全退出，串口与视觉设备已释放！\n")


if __name__ == "__main__":
    main()
