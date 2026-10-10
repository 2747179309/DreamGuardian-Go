"""One-shot readback of all Feetech STS3215 servos on the follower arm (COM5).

Reads a snapshot of the useful registers for servo IDs 1..6 and prints a table.
No movement, read-only. Safe to run with the arm powered.
"""
import sys
import time

from scservo_sdk import PortHandler, PacketHandler

PORT = "COM5"
BAUDRATE = 1000000

# STS3215 (STS series) control-table addresses: name -> (address, size_bytes)
ADDR = {
    "Model_Number": (3, 2),
    "Min_Position_Limit": (9, 2),
    "Max_Position_Limit": (11, 2),
    "Torque_Enable": (40, 1),
    "Present_Position": (56, 2),
    "Present_Velocity": (58, 2),
    "Present_Load": (60, 2),
    "Present_Voltage": (62, 1),
    "Present_Temperature": (63, 1),
    "Moving": (66, 1),
    "Present_Current": (69, 2),
}

JOINTS = {
    1: "shoulder_pan",
    2: "shoulder_lift",
    3: "elbow_flex",
    4: "wrist_flex",
    5: "wrist_roll",
    6: "gripper",
}

RES = 4096


def sign_magnitude(value, sign_bit):
    """Decode Feetech sign-magnitude: magnitude is bits below sign_bit."""
    mag = value & (sign_bit - 1)
    return -mag if (value & sign_bit) else mag


def read_reg(ph, port, sid, name):
    addr, size = ADDR[name]
    if size == 1:
        data, result, error = ph.read1ByteTxRx(port, sid, addr)
    else:
        data, result, error = ph.read2ByteTxRx(port, sid, addr)
    return data, result, error


def snapshot(ph, port):
    rows = []
    for sid in range(1, 7):
        regs = {}
        online = False
        for name in ADDR:
            data, result, error = read_reg(ph, port, sid, name)
            if result == 0:
                regs[name] = data
                online = True
            else:
                regs[name] = None

        if not online:
            rows.append({"id": sid, "online": False})
            continue

        pos = regs["Present_Position"]
        angle = (pos / RES) * 360.0 if pos is not None else None
        volt = regs["Present_Voltage"] / 10.0 if regs["Present_Voltage"] is not None else None
        temp = regs["Present_Temperature"]
        load_raw = regs["Present_Load"]
        load = sign_magnitude(load_raw, 0x400) if load_raw is not None else None
        speed_raw = regs["Present_Velocity"]
        vel = sign_magnitude(speed_raw, 0x8000) if speed_raw is not None else None
        cur = regs["Present_Current"]
        moving = regs["Moving"]
        torque_on = regs["Torque_Enable"]
        model = regs["Model_Number"]
        mn = regs["Min_Position_Limit"]
        mx = regs["Max_Position_Limit"]

        rows.append({
            "id": sid, "online": True, "pos": pos, "angle": angle, "vel": vel,
            "load": load, "volt": volt, "temp": temp, "cur": cur,
            "moving": moving, "torque_on": torque_on, "model": model,
            "mn": mn, "mx": mx,
        })
    return rows


def main():
    port = PortHandler(PORT)
    # STS3215 -> STS series -> protocol 0 (little-endian). PacketHandler(1) would
    # byte-swap every 2-byte register. See MODEL_PROTOCOL in tables.py.
    ph = PacketHandler(0)

    print(f"Connecting to {PORT} @ {BAUDRATE} ...")
    if not port.openPort():
        print(f"[ERROR] cannot open {PORT} (in use by another app, or wrong port)")
        sys.exit(1)
    if not port.setBaudRate(BAUDRATE):
        print(f"[ERROR] cannot set baudrate {BAUDRATE}")
        port.closePort()
        sys.exit(1)

    time.sleep(0.2)

    rows = snapshot(ph, port)

    hdr = ("ID  joint           model  TQ  pos    angle     vel      load    volt   temp  cur    moving  min     max")
    print("=" * len(hdr))
    print(hdr)
    print("=" * len(hdr))
    for r in rows:
        if not r["online"]:
            print(f"{r['id']:<3} {JOINTS[r['id']]:<15}  --- OFFLINE / no response ---")
            continue
        print(
            f"{r['id']:<3} {JOINTS[r['id']]:<15} "
            f"{r['model'] if r['model'] is not None else '?':>5} "
            f"{r['torque_on'] if r['torque_on'] is not None else '?':>3} "
            f"{r['pos']:>5} {r['angle']:>7.1f} "
            f"{r['vel'] if r['vel'] is not None else '?':>7} "
            f"{r['load'] if r['load'] is not None else '?':>7} "
            f"{r['volt'] if r['volt'] is not None else '?':>5} "
            f"{r['temp'] if r['temp'] is not None else '?':>4} "
            f"{r['cur'] if r['cur'] is not None else '?':>5} "
            f"{r['moving'] if r['moving'] is not None else '?':>5} "
            f"{r['mn'] if r['mn'] is not None else '?':>5} "
            f"{r['mx'] if r['mx'] is not None else '?':>5}"
        )
    print("=" * len(hdr))
    print("units: pos/angle = 0..4095 / deg | vel = signed rpm-ish | load = signed, 10 = 1%")
    print("       volt = V | temp = C | cur = mA(raw) | moving: 1=in motion | TQ: 1=torque on")

    port.closePort()


if __name__ == "__main__":
    main()
