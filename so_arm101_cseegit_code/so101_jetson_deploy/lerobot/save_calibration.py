#!/usr/bin/env python
"""把两臂舵机 EPROM 里的标定值导出成 lerobot 缓存文件。

读每个舵机的 homing_offset / range_min / range_max，写成 lerobot 期望的 JSON 缓存，
这样 lerobot-teleoperate / lerobot-record 会认为臂已标定，不会弹交互式标定提示。
只读 EPROM + 写 JSON 文件，不动舵机。
"""
from lerobot.robots.so101_follower import SO101Follower, SO101FollowerConfig
from lerobot.teleoperators.so101_leader import SO101Leader, SO101LeaderConfig


def save_follower():
    robot = SO101Follower(SO101FollowerConfig(port="COM5", id="follower"))
    robot.bus.connect()
    robot.calibration = robot.bus.read_calibration()
    robot._save_calibration()
    robot.bus.disconnect()
    print("follower ->", robot.calibration_fpath)


def save_leader():
    leader = SO101Leader(SO101LeaderConfig(port="COM6", id="leader"))
    leader.bus.connect()
    leader.calibration = leader.bus.read_calibration()
    leader._save_calibration()
    leader.bus.disconnect()
    print("leader ->", leader.calibration_fpath)


if __name__ == "__main__":
    save_follower()
    save_leader()
    print("Done.")
