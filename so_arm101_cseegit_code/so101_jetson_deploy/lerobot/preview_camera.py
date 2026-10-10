import cv2
import sys

def test_cameras():
    print("=" * 60)
    print("正在扫描可用的摄像头索引 (Index 0 ~ 4)...")
    available_indices = []
    
    for idx in range(5):
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW) # DirectShow for fast opening on Windows
        if cap.isOpened():
            ret, frame = cap.read()
            if ret and frame is not None:
                h, w = frame.shape[:2]
                print(f"  [发现摄像头] -> 索引编号 Index: {idx} (分辨率: {w}x{h})")
                available_indices.append(idx)
            cap.release()
            
    if not available_indices:
        print("\n[错误] 未检测到任何可用的摄像头设备！请检查 USB 连接或相机权限。")
        return
        
    print("=" * 60)
    target_idx = available_indices[-1] # 默认打开最新接入的外接摄像头
    print(f"\n正在打开摄像头 [Index {target_idx}] 实时画面窗口...")
    print("提示: 在画面窗口中按键盘 [Q] 键退出，按 [空格键] 可切换下一个摄像头！\n")
    
    current_idx_pos = available_indices.index(target_idx)
    cap = cv2.VideoCapture(available_indices[current_idx_pos], cv2.CAP_DSHOW)
    
    while True:
        ret, frame = cap.read()
        if not ret:
            print("读取画面失败，正在重试...")
            continue
            
        cur_id = available_indices[current_idx_pos]
        cv2.putText(frame, f"Camera Index: {cur_id} (Press Space to Switch, Q to Quit)", 
                    (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        
        cv2.imshow("USB Camera Live Preview", frame)
        key = cv2.waitKey(1) & 0xFF
        
        if key == ord('q') or key == 27: # Q 或 Esc 退出
            break
        elif key == 32: # 空格键切换下一个摄像头
            cap.release()
            current_idx_pos = (current_idx_pos + 1) % len(available_indices)
            new_id = available_indices[current_idx_pos]
            print(f"切换至摄像头 [Index {new_id}]...")
            cap = cv2.VideoCapture(new_id, cv2.CAP_DSHOW)
            
    cap.release()
    cv2.destroyAllWindows()
    print("已关闭摄像头预览。")

if __name__ == "__main__":
    test_cameras()
