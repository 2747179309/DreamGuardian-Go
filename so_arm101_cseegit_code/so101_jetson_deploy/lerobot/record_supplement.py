#!/usr/bin/env python
'''
DreamGuardian Next - 专用增补数据集录制启动器 (record_supplement.py)

功能:
  独立录制专门针对【左前方、奇特角度、极限位置】的增补示教数据集。
  存储于独立目录 D:/group project/data/tissue_handover_supplement，
  与原数据集绝对物理隔离，彻底杜绝混淆与误覆盖。

使用方法:
  1. 首次录制 (共 20 轮):
     python record_supplement.py
  2. 中途退出后断点续录:
     python record_supplement.py --resume
  3. 自定义参数:
     python record_supplement.py --num-episodes 25 --camera-index 0 --leader-port COM6
'''

import argparse
import os
import subprocess
import sys
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="SO-ARM101 增补泛化数据集录制工具")
    parser.add_argument("--num-episodes", type=int, default=20, help="增补录制总轮数 (默认 20 轮)")
    parser.add_argument("--resume", action="store_true", help="中途退出后断点续录 (接着已有轮次继续录)")
    parser.add_argument("--follower-port", type=str, default="COM5", help="从臂串口 (默认 COM5)")
    parser.add_argument("--leader-port", type=str, default="COM6", help="主臂串口 (默认 COM6)")
    parser.add_argument("--camera-index", type=int, default=0, help="手眼相机索引 (默认 0)")
    parser.add_argument("--output-dir", type=str, default="D:/group project/data/tissue_handover_supplement", help="增补数据集存储目录")
    parser.add_argument("--no-display", action="store_true", help="关闭 Rerun 可视化弹窗 (极简流畅模式，彻底杜绝 Windows socket 10093 报错)")
    args = parser.parse_args()

    out_path = Path(args.output_dir)
    camera_cfg = f'{{"handeye": {{"type": "opencv", "index_or_path": {args.camera_index}, "fps": 30, "width": 640, "height": 480}}}}'

    display_flag = "false" if args.no_display else "true"

    cmd = [
        "lerobot-record",
        "--robot.type=so101_follower",
        f"--robot.port={args.follower_port}",
        "--robot.id=follower",
        "--teleop.type=so101_leader",
        f"--teleop.port={args.leader_port}",
        "--teleop.id=leader",
        f"--robot.cameras={camera_cfg}",
        "--dataset.repo_id=local/tissue_handover_supplement",
        f"--dataset.root={str(out_path)}",
        "--dataset.single_task=Grasp the tissue and handover to human hand",
        f"--dataset.num_episodes={args.num_episodes}",
        "--dataset.episode_time_s=120",
        "--dataset.push_to_hub=false",
        f"--display_data={display_flag}",
        "--play_sounds=false",
    ]

    if args.resume:
        cmd.append("--resume=true")

    print("=" * 65)
    print("🎬 DreamGuardian Next - 专用增补数据集录制启动")
    print(f"📦 独立保存路径: {out_path} (与原始数据集物理隔离)")
    print(f"🎯 增补目标轮数: {args.num_episodes} 轮 | 续录模式: {'是 (--resume)' if args.resume else '否 (全新开录)'}")
    print(f"🔌 从臂串口: {args.follower_port} | 主臂串口: {args.leader_port} | 📷 相机: {args.camera_index}")
    print(f"🖥️ 可视化窗口: {'已关闭 (--no-display 纯终端极速模式)' if args.no_display else '已开启 (注意: 弹出的 Rerun 窗口切勿手动点右上角叉号关闭，最小化即可)'}")
    print("=" * 65)
    print("\n👉 录制操作要诀:")
    print("   [S] 键: 手动开启当前轮次录制 (摆好左前方纸巾后按 S)")
    print("   [E] 键: 抓取递送完成，保存当前轮并归位")
    print("   [Esc] 键: 暂停/退出录制")
    if not args.no_display:
        print("   ⚠️ 提示: 如果录制时无需查看实时画面，可追加 --no-display 获得极佳稳定性！")
    print("-" * 65 + "\n")

    env = os.environ.copy()
    scripts_dir = str(Path(sys.prefix) / "Scripts")
    env["PATH"] = f"{scripts_dir};{env.get('PATH', '')}"

    sys.exit(subprocess.call(cmd, env=env))

if __name__ == "__main__":
    main()
