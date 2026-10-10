#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
压力传感器实时监测 —— 本地 Web 服务
====================================
功能：浏览器页面实时显示 6 个压力传感器的读数。
数据来源：ESP32/单片机通过串口（COM 口）把 6 个数值一行行发上来。

用法：
    python server.py --sim                          # 模拟数据（无硬件先看效果，零依赖）
    python server.py --port COM3 --baud 115200      # 读真实串口（需要 pyserial）

然后浏览器打开  http://127.0.0.1:8000

依赖：
    真实串口模式需要 pyserial：  pip install pyserial
    模拟模式零依赖。

固件端数据格式约定：
    每行输出 6 个数字，用 逗号 / 空格 / Tab 分隔 都行，例如：
        512 480 300 1023 700 610
    或  512,480,300,1023,700,610
"""

import argparse
import json
import math
import os
import re
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

N = 9  # 传感器数量（6 压力 + 3 脑电波：GPIO8 / ADS1120-AIN0 / ADS1120-AIN1）

latest = [0.0] * N
lock = threading.Lock()
eeg_stream = deque(maxlen=512)  # 高速脑电流（100Hz，最多约 5 秒）
serial_ok = False  # 串口是否成功打开
ser = None         # 全局串口对象（读压力 + 发按摩仪命令共用）
ser_lock = threading.Lock()


def send_cmd(cmd):
    """把一行命令写到串口（按摩仪控制 / 固件切换）。返回 (ok, msg)。"""
    with ser_lock:
        s = ser
    if s is None:
        return False, "串口未连接"
    try:
        s.write((cmd + "\n").encode("utf-8"))
        s.flush()
        return True, "已发送"
    except Exception as e:
        return False, str(e)


def parse_line(line):
    """从一行文本里提取 9 个数字，支持 逗号/空格/Tab 分隔。

    只认"纯数字行"（压力固件输出），含字母的行（ESP-IDF 日志 / 按摩仪日志）
    直接跳过，避免把日志里的数字误当成压力数据。
    """
    if re.search(r"[A-Za-z]", line):
        return None
    nums = re.findall(r"-?\d+(?:\.\d+)?", line)
    if len(nums) >= N:
        return [float(x) for x in nums[:N]]
    return None


def parse_eeg_line(line):
    """解析高速脑电批：以 "E" 开头，后面跟一批整数（如 E -123 456 ...）。
    返回 list[int]；不是脑电行返回 None。"""
    if not line.startswith("E"):
        return None
    nums = re.findall(r"-?\d+", line[1:])
    if len(nums) >= 2:
        return [int(x) for x in nums]
    return None


def serial_reader(port, baud):
    """串口读线程：不断读行，解析出 9 个值更新 latest。

    切换固件（boot_massage / boot_pressure）会让板子重启、USB 串口短暂断开，
    所以这里外层负责重开串口、内层负责读行，断线自动重连。
    """
    global latest, serial_ok, ser
    import serial as ser_mod
    while True:
        try:
            with ser_lock:
                ser = ser_mod.Serial(port, baud, timeout=0.2)
            serial_ok = True
            print(f"[串口] 已打开 {port} @ {baud}")
        except Exception as e:
            serial_ok = False
            with ser_lock:
                ser = None
            print(f"[串口] 打开 {port} 失败: {e}，2 秒后重试…")
            time.sleep(2)
            continue

        while True:
            try:
                raw = ser.readline()
            except Exception as e:
                print(f"[串口] 断开: {e}，重连…")
                serial_ok = False
                try:
                    ser.close()
                except Exception:
                    pass
                with ser_lock:
                    ser = None
                time.sleep(0.5)
                break  # 跳出内层，回外层重开串口
            if not raw:
                continue
            line = raw.decode("utf-8", errors="ignore").strip()
            eeg_vals = parse_eeg_line(line)
            if eeg_vals:
                with lock:
                    eeg_stream.extend(eeg_vals)
                continue
            vals = parse_line(line)
            if vals:
                with lock:
                    latest = vals


def sim_reader():
    """模拟数据线程：正弦波，方便没硬件时看页面效果。"""
    global latest
    t = 0.0
    while True:
        t += 0.1
        vals = [
            500 + 400 * math.sin(t * 0.8 + i * 0.9) + 60 * math.sin(t * 2.3 + i)
            for i in range(N)
        ]
        with lock:
            latest = vals
        time.sleep(0.1)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # 安静点，不刷屏

    def do_GET(self):
        if self.path == "/":
            self._serve_html()
        elif self.path == "/eeg":
            self._serve_eeg()
        elif self.path == "/vib":
            self._serve_vib()
        elif self.path == "/data":
            self._serve_json()
        else:
            self.send_error(404)

    def do_POST(self):
        # 按摩仪控制 / 固件切换命令。body: {"cmd": "level 3"}
        if self.path == "/cmd":
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length).decode("utf-8", errors="ignore")
            try:
                data = json.loads(body)
                cmd = str(data.get("cmd", "")).strip()
            except Exception:
                cmd = body.strip()
            ok, msg = send_cmd(cmd)
            resp = json.dumps({"ok": ok, "msg": msg}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
        else:
            self.send_error(404)

    def _serve_file(self, fname):
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                body = f.read().encode("utf-8")
        except Exception as e:
            body = f"<h1>{fname} 找不到: {e}</h1>".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_html(self):
        self._serve_file("index.html")

    def _serve_eeg(self):
        self._serve_file("eeg.html")

    def _serve_vib(self):
        self._serve_file("vib.html")

    def _serve_json(self):
        with lock:
            data = {"values": latest, "serial_ok": serial_ok,
                    "eeg": list(eeg_stream)}
        body = json.dumps(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    ap = argparse.ArgumentParser(description="压力传感器实时监测")
    ap.add_argument("--port", default="COM3", help="串口号，默认 COM3")
    ap.add_argument("--baud", type=int, default=115200, help="波特率，默认 115200")
    ap.add_argument("--sim", action="store_true", help="模拟数据模式（无硬件）")
    ap.add_argument("--http", type=int, default=8000, help="网页端口，默认 8000")
    args = ap.parse_args()

    if args.sim:
        threading.Thread(target=sim_reader, daemon=True).start()
        print("[模式] 模拟数据（--sim）")
    else:
        threading.Thread(target=serial_reader, args=(args.port, args.baud), daemon=True).start()
        print(f"[模式] 串口 {args.port} @ {args.baud}")

    srv = ThreadingHTTPServer(("127.0.0.1", args.http), Handler)
    print(f"\n  浏览器打开  http://127.0.0.1:{args.http}\n  按 Ctrl+C 退出\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")


if __name__ == "__main__":
    main()
