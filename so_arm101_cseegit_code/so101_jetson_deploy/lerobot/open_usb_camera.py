import cv2
import sys

# 默认打开外接 USB 机械臂手眼摄像头 (Index 0)
CAMERA_INDEX = 0

print("=" * 60)
print(f"正在尝试打开外接 USB 摄像头 [Index {CAMERA_INDEX}]...")
cap = cv2.VideoCapture(CAMERA_INDEX, cv2.CAP_DSHOW)

if not cap.isOpened():
    print(f"[提示] Index {CAMERA_INDEX} 打开失败，尝试打开 Index 0...")
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    if not cap.isOpened():
        print("[错误] 未能打开任何摄像头！请检查 USB 接口是否插紧。")
        sys.exit(1)
    CAMERA_INDEX = 0

# 设置 640x480 分辨率与 30 帧率
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
cap.set(cv2.CAP_PROP_FPS, 30)

print(f"✅ 摄像头 [Index {CAMERA_INDEX}] 已就绪，正在弹出实时画面窗口...")
print("提示: 点击画面窗口，按键盘 [Q] 键或 [Esc] 键退出。")
print("=" * 60)

window_name = f"SO-ARM101 USB Camera (Index {CAMERA_INDEX})"
cv2.namedWindow(window_name, cv2.WINDOW_AUTOSIZE)

while True:
    ret, frame = cap.read()
    if not ret or frame is None:
        continue

    # 在画面左上角绘制状态文字
    cv2.putText(frame, f"USB Camera [Index {CAMERA_INDEX}] - Press Q to Quit", 
                (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 0), 2)
    
    cv2.imshow(window_name, frame)
    
    # 监听键盘按键
    key = cv2.waitKey(1) & 0xFF
    if key == ord('q') or key == ord('Q') or key == 27:
        break

cap.release()
cv2.destroyAllWindows()
print("\n摄像头预览已正常关闭。")
