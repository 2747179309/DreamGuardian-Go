#!/usr/bin/env python
"""Minimal leader -> follower teleoperation for SO-ARM101 (STS3215), no lerobot/torch/camera.

Reads the leader arm's joint positions and mirrors them onto the follower arm,
mapping through each arm's calibration limits (Min/Max Position Limit stored in
the servo EPROM). This is the same normalization lerobot does, but standalone.

Hardware prep:
  * Follower = COM5  (torque ON  -> it moves and holds position)
  * Leader   = COM6  (torque OFF -> you move it by hand freely)
  * BOTH arms need their own 12V power supply connected.

Usage:
  python minimal_teleop.py --leader COM6 --follower COM5
  python minimal_teleop.py --leader COM6 --follower COM5 --dry-run   # read-only, no motion
  python minimal_teleop.py --leader COM6 --follower COM5 --flip 1,4  # reverse direction of joints 1 and 4

Safety:
  * --max-step clamps how far any joint can move in one frame, so a misaligned
    start can't cause a sudden jump.
  * On Ctrl+C the follower torque is left ENABLED so the arm holds still instead
    of going limp. Power-cycle or re-run a lerobot session to release it.
"""
import argparse
import sys
import time

from scservo_sdk import PortHandler, PacketHandler

# STS3215 (STS series) control-table addresses
ADDR_GOAL = 42       # Goal_Position (2 bytes)
ADDR_POS = 56        # Present_Position (2 bytes)
ADDR_MIN = 9         # Min_Position_Limit (2 bytes)
ADDR_MAX = 11        # Max_Position_Limit (2 bytes)
ADDR_TORQUE = 40     # Torque_Enable (1 byte)
ADDR_ACCEL = 41      # Acceleration (1 byte)
ADDR_GOAL_VEL = 46   # Goal_Velocity (2 bytes)

JOINTS = {
    1: "shoulder_pan",
    2: "shoulder_lift",
    3: "elbow_flex",
    4: "wrist_flex",
    5: "wrist_roll",
    6: "gripper",
}


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--leader", default="COM6")
    ap.add_argument("--follower", default="COM5")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument(
        "--max-step", type=int, default=200,
        help="max per-frame position change in encoder counts (safety clamp)",
    )
    ap.add_argument(
        "--flip", default="",
        help="comma-separated joint IDs to reverse direction, e.g. 1,4",
    )
    ap.add_argument(
        "--dry-run", action="store_true",
        help="read-only: print the mapping, do not move the follower",
    )
    return ap.parse_args()


def read2(ph, port, sid, addr):
    data, result, _ = ph.read2ByteTxRx(port, sid, addr)
    return data if result == 0 else None


def main():
    args = parse_args()
    flips = {int(x) for x in args.flip.split(",") if x.strip()}

    lp = PortHandler(args.leader)
    fp = PortHandler(args.follower)
    ph = PacketHandler(0)  # STS3215 -> STS series -> protocol 0 (little-endian)

    if not lp.openPort():
        print(f"[ERROR] cannot open leader port {args.leader}")
        sys.exit(1)
    if not fp.openPort():
        print(f"[ERROR] cannot open follower port {args.follower}")
        sys.exit(1)
    lp.setBaudRate(1000000)
    fp.setBaudRate(1000000)
    time.sleep(0.2)

    # Read calibration limits and current positions from both arms.
    limits, cur, online = {}, {}, {"leader": [], "follower": []}
    for name, port in (("leader", lp), ("follower", fp)):
        limits[name], cur[name] = {}, {}
        for sid in range(1, 7):
            mn = read2(ph, port, sid, ADDR_MIN)
            mx = read2(ph, port, sid, ADDR_MAX)
            pos = read2(ph, port, sid, ADDR_POS)
            if pos is None:
                print(f"[WARN] {name} ID{sid} ({JOINTS[sid]}) not responding")
                continue
            online[name].append(sid)
            limits[name][sid] = (mn if mn is not None else 0, mx if mx is not None else 4095)
            cur[name][sid] = pos

    if not online["leader"]:
        print(f"[ERROR] no leader servos responding on {args.leader}.")
        print("        Check the leader arm's 12V power supply and the servo cable.")
        sys.exit(1)
    if not online["follower"]:
        print(f"[ERROR] no follower servos responding on {args.follower}.")
        sys.exit(1)

    common = sorted(set(online["leader"]) & set(online["follower"]))

    if not args.dry_run:
        # Leader: torque OFF (free to move). Follower: torque ON, hold current pos first.
        for sid in online["leader"]:
            ph.write1ByteTxRx(lp, sid, ADDR_TORQUE, 0)
        for sid in online["follower"]:
            ph.write2ByteTxRx(fp, sid, ADDR_GOAL, cur["follower"][sid])  # no jump on enable
            ph.write1ByteTxRx(fp, sid, ADDR_TORQUE, 1)
            ph.write2ByteTxRx(fp, sid, ADDR_GOAL_VEL, 2000)
            ph.write1ByteTxRx(fp, sid, ADDR_ACCEL, 254)

    goal = {sid: cur["follower"][sid] for sid in online["follower"]}

    print("=" * 90)
    mode = "DRY-RUN (no motion)" if args.dry_run else "LIVE"
    print(f"Teleop: leader {args.leader} -> follower {args.follower}   [{mode}]   Ctrl+C to stop")
    if flips:
        print(f"Direction flipped on joints: {sorted(flips)}")
    print("=" * 90)

    try:
        while True:
            t0 = time.perf_counter()
            line = []
            for sid in common:
                lpos = read2(ph, lp, sid, ADDR_POS)
                if lpos is None:
                    continue
                lmin, lmax = limits["leader"][sid]
                fmin, fmax = limits["follower"][sid]
                norm = (lpos - lmin) / (lmax - lmin) if lmax > lmin else lpos / 4095.0
                norm = min(1.0, max(0.0, norm))
                if sid in flips:
                    norm = 1.0 - norm
                target = fmin + norm * (fmax - fmin)
                # per-step safety clamp
                delta = target - goal[sid]
                delta = max(-args.max_step, min(args.max_step, delta))
                target = goal[sid] + delta
                goal[sid] = target
                if not args.dry_run:
                    ph.write2ByteTxRx(fp, sid, ADDR_GOAL, int(target))
                line.append(f"{JOINTS[sid]}:{int(lpos)}->{int(target)}")
            print("  " + " | ".join(line), end="\r")
            dt = time.perf_counter() - t0
            time.sleep(max(0.0, 1.0 / args.fps - dt))
    except KeyboardInterrupt:
        print("\nStopped. Follower torque left ENABLED (arm holds position, safe).")


if __name__ == "__main__":
    main()
