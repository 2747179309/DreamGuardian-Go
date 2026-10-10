# -*- coding: utf-8 -*-
import scservo_sdk as scs

def check_port(port_name):
    ph = scs.PortHandler(port_name)
    if not ph.openPort():
        return False, 0.0, 'Port open failed'
    ph.setBaudRate(1000000)
    pkh = scs.PacketHandler(0)
    vol, res, err = pkh.read1ByteTxRx(ph, 1, 62)
    ph.closePort()
    if res == 0:
        return True, vol / 10.0, 'OK'
    else:
        return False, 0.0, 'No servo response (12V OFF or cable loose)'

def main():
    print('=' * 60)
    print('[Hardware Power & Servo Status Check]')
    print('=' * 60)
    ports = {'Follower (从臂)': 'COM5', 'Leader (主臂)': 'COM6'}
    all_ok = True
    for role, port in ports.items():
        ok, vol, msg = check_port(port)
        if ok:
            print(f'  [PASS] {role} [{port}]: Power ON | Voltage: {vol:.1f}V | {msg}')
        else:
            print(f'  [FAIL] {role} [{port}]: Power OFF | Voltage: {vol:.1f}V | {msg}')
            all_ok = False
    print('=' * 60)
    if all_ok:
        print('Ready! Both arms powered and communicating.')
    else:
        print('Please check the 12V adapter, switch, or cable for the failed arm.')

if __name__ == '__main__':
    main()
