# SO-ARM101 纯净 ACT 策略 Jetson 部署与运行全流程指南

本指南专为 **NVIDIA Jetson 系列开发板**（Jetson Orin Nano / Orin NX / AGX Orin / Xavier NX / Nano，系统基于 Ubuntu Linux aarch64）编写，用于将训练好的 **抓纸巾 (`act_tissue`)** 与 **抓眼罩 (`act_eyemask`)** 纯净 ACT 大模型部署到真机机械臂上执行闭环自主控制。

---

## 目录
1. [部署包目录结构说明](#1-部署包目录结构说明)
2. [Jetson 硬件连接与接线注意事项](#2-jetson-硬件连接与接线注意事项)
3. [Jetson 系统环境与 PyTorch (CUDA 加速) 安装](#3-jetson-系统环境与-pytorch-cuda-加速-安装)
4. [一键配置与依赖安装](#4-一键配置与依赖安装)
5. [机械臂串口与手眼摄像头端口确定](#5-机械臂串口与手眼摄像头端口确定)
6. [硬件连通性测试 (诊断工具)](#6-硬件连通性测试-诊断工具)
7. [模型自主推理运行命令](#7-模型自主推理运行命令)
8. [实测动态参数微调指南](#8-实测动态参数微调指南)
9. [Jetson 性能满血释放技巧](#9-jetson-性能满血释放技巧)
10. [常见问题与故障排查 (FAQ)](#10-常见问题与故障排查-faq)

---

## 1. 部署包目录结构说明

解压后的 `so101_jetson_deploy` 文件夹包含以下核心组件：

```text
so101_jetson_deploy/
├── models/
│   ├── act_tissue/               # 训练好的 107 轮抓纸巾 ACT 策略权重 (safetensors + config)
│   └── act_eyemask/              # 训练好的抓眼罩 ACT 策略权重
├── lerobot/                      # 定制版 LeRobot 源码 (保留 SO-101 机械臂 6 轴舵机总线协议)
├── calibration/
│   └── follower.json             # 从臂 6 轴舵机的中位与行程校准缓存 (防止弹交互标定提示)
├── eval_so101.py                 # 跨平台真机自主推理主程序 (自适应 Jetson Linux 端口与无界面运行)
├── test_arm_port.py              # 机械臂串口及 1~6 号舵机通信在线状态快速诊断工具
├── test_camera.py                # 手眼摄像头帧率、分辨率与抓图测试工具
├── save_calibration.py           # 从舵机 EPROM 直接读取并刷新标定缓存的工具
├── setup_jetson_env.sh           # Jetson 串口免权、依赖安装与标定部署一键脚本
├── requirements-jetson.txt       # Jetson 纯净 Python 依赖包清单
├── DEPLOY_GUIDE_JETSON.md        # 本详细部署手册
└── README.md                     # 极速上手速查表
```

---

## 2. Jetson 硬件连接与接线注意事项

连接从臂机械臂和手眼摄像头到 Jetson 开发板：

1. **机械臂 USB 通信线**：
   - 使用附带的 Type-C/Micro-USB 线，将机械臂驱动板连接到 Jetson 的任意 USB 3.0 接口。
   - **核心提示**：该接口在 Linux 系统下通常会被识别为 `/dev/ttyACM0`（若为 CH343/CH340 则为 `/dev/ttyUSB0`）。
2. **机械臂 12V 独立供电（严禁遗漏）**：
   - 驱动板的 12V DC 电源插头必须通电！Jetson USB 仅提供 5V 逻辑通信，**12V 电源才是驱动 STS3215 舵机旋转的动力源**。如果不插 12V，舵机会出现 0 响应。
3. **手眼摄像头**：
   - 将摄像头 USB 线插入 Jetson 的 USB 接口（系统下识别为 `/dev/video0` 或 `/dev/video1`）。

---

## 3. Jetson 系统环境与 PyTorch (CUDA 加速) 安装

> [!IMPORTANT]
> **切勿在 Jetson (ARM64) 上直接使用 `pip install torch`**！因为 PyPI 官方的默认 wheel 包只包含 CPU 版本，会导致模型在 CPU 上运行极其缓慢。
> Jetson 的 PyTorch 必须从 NVIDIA 官方专门为 Jetson 编译的 Wheel 包安装。

### 3.1 确认 JetPack 版本与 Python 版本
在 Jetson 终端输入：
```bash
cat /etc/nv_tegra_release
python3 --version
```
- **JetPack 5.x (Ubuntu 20.04)**：默认 Python 3.8
- **JetPack 6.x (Ubuntu 22.04)**：默认 Python 3.10

### 3.2 安装带 CUDA 加速的 PyTorch (根据对应版本选择)

#### 若为 JetPack 6.x (Ubuntu 22.04 + Python 3.10) [推荐]：
```bash
# 1. 安装系统底层依赖
sudo apt update
sudo apt install -y python3-pip python3-h5py libopenblas-base libopenmpi-dev libomp-dev

# 2. 安装 NVIDIA 官方 PyTorch 2.3+ for JetPack 6 (aarch64)
pip3 install --no-cache-dir https://developer.download.nvidia.com/compute/redist/jp/v60/pytorch/torch-2.3.0a0+ebedce2.nv24.06-cp310-cp310-linux_aarch64.whl

# 3. 安装对应 torchvision
pip3 install torchvision==0.18.0 --no-deps
```

#### 若为 JetPack 5.x (Ubuntu 20.04 + Python 3.8)：
```bash
sudo apt update
sudo apt install -y python3-pip python3-h5py libopenblas-base libopenmpi-dev libomp-dev
pip3 install --no-cache-dir https://developer.download.nvidia.cn/compute/redist/jp/v512/pytorch/torch-2.1.0a0+41361538.nv23.06-cp38-cp38-linux_aarch64.whl
pip3 install torchvision==0.16.1 --no-deps
```

### 3.3 验证 CUDA 状态
在终端运行：
```bash
python3 -c "import torch; print('PyTorch Version:', torch.__version__); print('CUDA Available:', torch.cuda.is_available()); print('Device Name:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'None')"
```
输出必须为 `CUDA Available: True`。

---

## 4. 一键配置与依赖安装

进入解压后的部署目录，执行一键配置脚本：

```bash
cd so101_jetson_deploy

# 赋予执行权限
chmod +x setup_jetson_env.sh

# 运行一键配置脚本
./setup_jetson_env.sh
```

### 该脚本自动完成的操作：
1. **解决串口权限**：将当前用户加入 `dialout` 串口组，并写入 udev 规则，从此插拔机械臂免 `sudo`。
2. **免除交互式标定**：自动将 6 轴舵机标定中位线缓存复制到 `~/.cache/huggingface/lerobot/calibration/robots/so101_follower/follower.json`。
3. **安装 LeRobot 库**：以 `-e` 开发模式安装随包附带的 LeRobot 源码，确保完全兼容 SO-101 协议。
4. **安装推理依赖**：安装 `safetensors`、`draccus`、`feetech-servo-sdk`、`pyserial` 等必要库。

> [!NOTE]
> 如果修改了用户组，建议在终端执行 `newgrp dialout` 或重新打开终端，以刷新组权限。

---

## 5. 机械臂串口与手眼摄像头端口确定

### 5.1 机械臂串口查看与更改

在 Windows 上机械臂端口一般为 `COM5`，但在 Linux/Jetson 上为字符设备：

1. **插拔前后对比排查**：
   在终端运行：
   ```bash
   ls -l /dev/ttyACM* /dev/ttyUSB*
   ```
   - 常见从臂端口为：`/dev/ttyACM0` 或 `/dev/ttyUSB0`。
2. **查看系统内核日志确认**：
   ```bash
   dmesg | tail -n 20
   ```
   会看到类似 `ch343-uart detected` 或 `cdc_acm ... /dev/ttyACM0` 的日志。
3. **如何在运行命令中更改端口**：
   在后续运行命令中，通过 `--port` 参数指定即可，例如：
   ```bash
   # 如果系统分配的是 ttyACM0
   python3 eval_so101.py --task tissue --port /dev/ttyACM0
   
   # 如果系统分配的是 ttyUSB0
   python3 eval_so101.py --task tissue --port /dev/ttyUSB0
   ```

### 5.2 手眼摄像头设备号查看与更改

1. **查看系统视频设备**：
   ```bash
   ls -l /dev/video*
   ```
2. **确定摄像头 Index**：
   通常单个 USB 手眼摄像头插入后对应 `/dev/video0`（部分相机同时占用 video0 与 video1，取较小数即可）。
3. **如何在命令中更改摄像头**：
   通过 `--camera-index` 指定，例如：
   ```bash
   python3 eval_so101.py --task tissue --camera-index 0
   ```

---

## 6. 硬件连通性测试 (诊断工具)

在正式启动大模型推理之前，请运行我们随包提供的**两个轻量诊断工具**，确保通信无虞。

### 6.1 测试 6 轴舵机通信 (`test_arm_port.py`)
```bash
python3 test_arm_port.py --port /dev/ttyACM0
```
**正常输出示例**：
```text
✓ 串口成功打开！正在依次 Ping 1~6 号 STS3215 舵机...
  [ID 1] 🟢 在线 | shoulder_pan  (底座旋转) | 当前位置: 2048 | 供电: 12.1V
  [ID 2] 🟢 在线 | shoulder_lift (大臂俯仰) | 当前位置: 2110 | 供电: 12.1V
  [ID 3] 🟢 在线 | elbow_flex    (肘部俯仰) | 当前位置: 1890 | 供电: 12.0V
  [ID 4] 🟢 在线 | wrist_flex    (手腕俯仰) | 当前位置: 2045 | 供电: 12.1V
  [ID 5] 🟢 在线 | wrist_roll    (手腕旋转) | 当前位置: 2048 | 供电: 12.1V
  [ID 6] 🟢 在线 | gripper       (末端夹爪) | 当前位置: 2350 | 供电: 12.0V
🎉 完美！全部 6 个舵机均正常通信，供电良好，机械臂可立即投入推理！
```
*如果出现 🔴 离线，请检查 12V 供电是否接通。*

### 6.2 测试手眼摄像头采样 (`test_camera.py`)
```bash
# 无显示器/SSH 远程环境（自动抓取一帧保存为 camera_test.jpg）
python3 test_camera.py --index 0 --no-display
```
查看当前目录下生成的 `camera_test.jpg`，确认手眼相机画面未倒置、对焦清晰。

---

## 7. 模型自主推理运行命令

### 7.1 抓纸巾任务 (Tissue Handover)
```bash
# 桌面图形环境（弹出实时 HUD 手眼视窗）
python3 eval_so101.py --task tissue --port /dev/ttyACM0 --camera-index 0

# SSH 远程终端运行（无图形界面，适合远程调试，终端实时输出 FPS/关节角度）
python3 eval_so101.py --task tissue --port /dev/ttyACM0 --camera-index 0 --no-display
```

### 7.2 抓眼罩任务 (Eye Mask Handover)
```bash
# 桌面图形环境
python3 eval_so101.py --task eyemask --port /dev/ttyACM0 --camera-index 0

# SSH 远程终端无界面模式
python3 eval_so101.py --task eyemask --port /dev/ttyACM0 --camera-index 0 --no-display
```

### 7.3 控制与交互热键
- **安全退出**：随时按终端 `Ctrl + C`，或在画面窗口按 `Q` 键，机械臂将立即安全断电释放扭矩。
- **重置下一轮抓取**：按键盘 `R` 键，将重置神经网络记忆与平滑器，立即开始新一轮自主抓取。

---

## 8. 实测动态参数微调指南

由于真实物理环境（纸巾摆放远近、左偏角度、桌面高低、光照）可能与原训练采集略有出入，`eval_so101.py` 内置了以下快速补偿参数：

| 参数名 | 默认值 | 典型推荐值 | 适用场景与效果 |
| :--- | :---: | :---: | :--- |
| `--pan-gain` | `1.0` | `1.25` ~ `1.35` | **左转幅度放大系数**：当纸巾放在极靠左侧前方时，放大向左下潜的转向幅度。 |
| `--pan-offset`| `0.0` | `-5.0` ~ `-8.0` | **底座航向静态偏置**：负值整体向左补偿角度，解决“差 2 厘米对不准左侧目标”的问题。 |
| `--lift-offset`| `0.0` | `-3.0` 或 `+3.0` | **抓取高度俯仰补偿**：负值抬升接近高度（防止撞盒壁），正值下潜更深（防止抓空）。 |
| `--smooth-alpha`| `0.65` | `0.80` ~ `0.85` | **平滑系数**：0.65 超级平滑；若感觉机械臂转向较慢，调高至 0.85 提升响应灵敏度。 |
| `--n-action-steps` | `60` | `100` | **重规划步长**：原生 100 步 chunk 动作更连贯；30 步对准更精细。 |

### 针对边缘长尾位置（如左前方纸巾）的黄金组合命令：
```bash
python3 eval_so101.py --task tissue --port /dev/ttyACM0 --camera-index 0 --pan-gain 1.25 --pan-offset -5.0 --smooth-alpha 0.80
```

---

## 9. Jetson 性能满血释放技巧

为了让 ACT 扩散策略与 ResNet18 视觉主干在 Jetson 上达到最流畅的 30 FPS 实时闭环控制：

1. **开启最高功率模式 (MAXN)**：
   ```bash
   sudo nvpmodel -m 0
   ```
2. **锁定 CPU / GPU 满血运行频率**：
   ```bash
   sudo jetson_clocks
   ```
3. **内存清理与监控**：
   可以使用 `jtop`（通过 `pip3 install jetson-stats` 安装）实时查看 Jetson GPU 利用率、功耗与显存占用。

---

## 10. 常见问题与故障排查 (FAQ)

### Q1: 运行提示 `Permission denied: '/dev/ttyACM0'`？
- **原因**：当前 Linux 用户没有串口设备的直接读写权限。
- **解决**：
  ```bash
  sudo chmod 666 /dev/ttyACM0
  # 永久解决：
  sudo usermod -a -G dialout $USER
  ```
  然后注销并重新登录终端。

### Q2: SSH 远程连接运行时报 `cv2.error: Cannot connect to display`？
- **原因**：通过普通 SSH 登录 Jetson，没有连接物理显示器或没有开启 X11 Forwarding。
- **解决**：加上 `--no-display` 参数即可运行：
  ```bash
  python3 eval_so101.py --task tissue --port /dev/ttyACM0 --no-display
  ```
  终端会每秒打印当前机械臂状态与抓取步骤，模型在后台全自动控制。

### Q3: 运行报错 `SO101Follower: Not calibrated` 并弹出校准提示？
- **原因**：LeRobot 在新系统上找不到缓存的标定文件。
- **解决**：运行包内的标定导出脚本，1 秒从芯片生成缓存：
  ```bash
  python3 save_calibration.py --port /dev/ttyACM0
  ```

### Q4: 机械臂刚启动就猛跳一下？
- **原因**：机械臂启动前摆放的初始姿势距离原点休息姿势相差太远。
- **解决**：在启动 Python 脚本前，**手动将机械臂轻轻摆到常规居中向前、夹爪微张的标准休息位**，再敲回车启动。

### Q5: 运行慢、帧率只有 5~8 FPS？
- **原因**：PyTorch 使用了 CPU 推理，没有启用 Jetson GPU CUDA。
- **排查**：运行 `python3 -c "import torch; print(torch.cuda.is_available())"`。若为 `False`，必须按第 3 节重新安装 NVIDIA 官方 Jetson PyTorch Wheel。
