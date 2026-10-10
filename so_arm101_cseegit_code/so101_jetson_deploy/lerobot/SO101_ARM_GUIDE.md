# SO-ARM101 从臂调试与联动操作手册

> 项目路径：`D:\分组项目\lerobot`
> Python 环境：`D:\Anaconda\envs\lerobot`（Python 3.10，lerobot 已安装）
> 适用硬件：单臂 SO-ARM101（`so101_follower` + `so101_leader`），6 × STS3215 舵机

---

## 1. 硬件与串口

| 设备 | COM 口 | 说明 |
|------|--------|------|
| **从臂 (follower)** | **COM5** | 扭矩开启时跟随动作 |
| **主臂 (leader / 示教器)** | **COM6** | 扭矩关闭，手掰做示教 |
| COM3 / COM4 | —— | 蓝牙串口，忽略 |

- 波特率：**1000000**（1Mbps）
- 串口芯片：CH343（USB 转串口），插上后显示为 `USB-Enhanced-SERIAL CH343`
- **主臂也需要接 12V 电源**：示教器里也是 STS3215 舵机，编码器要通电才能回传位置。USB 线负责通信，12V 负责舵机供电，两者都要接。

**扫描串口（PowerShell）：**

```powershell
Get-PnpDevice -Class Ports | Select-Object Status,FriendlyName
```

---

## 2. 关节映射

| 舵机 ID | 关节名 | 说明 |
|--------|--------|------|
| 1 | `shoulder_pan` | 底座旋转 |
| 2 | `shoulder_lift` | 大臂俯仰 |
| 3 | `elbow_flex` | 肘部俯仰 |
| 4 | `wrist_flex` | 手腕俯仰 |
| 5 | `wrist_roll` | 手腕旋转 |
| 6 | `gripper` | 末端夹爪 |

---

## 3. 关键知识点（踩坑记录）

### 3.1 字节序：`PacketHandler(0)` 不是 `PacketHandler(1)`

新版 `feetech-servo-sdk` 里，`PacketHandler(协议号)` 的参数**直接决定字节序**：

- STS3215 属 **STS 系列 → 协议号 0（小端）→ 必须用 `PacketHandler(0)`**
- 用 `PacketHandler(1)` 会把所有 2 字节寄存器高低位反转，读出超范围的大数（如型号 2307、位置 36872）。

### 3.2 新版 SDK 没有 `ReadPos` / `WritePosEx`

旧 Feetech SDK 的 `ReadPos` / `WritePosEx` 在新版 `feetech-servo-sdk` 里**不存在**。改用寄存器直读直写：

| 旧 API | 新版等价写法 |
|--------|-------------|
| `ReadPos(port, id)` | `read2ByteTxRx(port, id, 56)`（地址 56 = Present_Position） |
| `WritePosEx(port, id, pos, speed, acc)` | `write2ByteTxRx(port, id, 42, pos)` + `write2ByteTxRx(port, id, 46, speed)` + `write1ByteTxRx(port, id, 41, acc)` |

常用寄存器地址（STS3215）：

| 名称 | 地址 | 字节 |
|------|------|------|
| Model_Number | 3 | 2 |
| Min_Position_Limit | 9 | 2 |
| Max_Position_Limit | 11 | 2 |
| Homing_Offset | 31 | 2 |
| Torque_Enable | 40 | 1 |
| Acceleration | 41 | 1 |
| Goal_Position | 42 | 2 |
| Goal_Velocity | 46 | 2 |
| Present_Position | 56 | 2 |
| Present_Load | 60 | 2 |
| Present_Voltage | 62 | 1 |
| Present_Temperature | 63 | 1 |
| Present_Current | 69 | 2 |

### 3.3 标定的三个概念

| 概念 | 是什么 | 寄存器 |
|------|--------|--------|
| **限位 (min/max)** | 关节能转到的最左端和最右端 | Min/Max_Position_Limit (9/11) |
| **零位 / 中间位 (homing)** | 关节转动范围的物理中间，对准编码器 2047 | Homing_Offset (31) |
| **回家姿态** | 整条臂的固定起始姿势 | 标定不需要，录数据才需要 |

**联动映射原理**：读主臂位置 → 按主臂限位归一化到 [0,1] → 再按从臂限位反归一化 → 写从臂目标位置。所以**主臂和从臂的限位 + 零位都必须正确**，否则对应关节会"跟不上/幅度不对/方向反"。

### 3.4 主臂和从臂的齿轮比不同

SO-ARM101 主臂部分关节齿轮比与从臂不同（如 wrist_roll：主臂 1/147，从臂 1/345）。这**不影响联动**——归一化会自动吸收齿轮比差异。体现为两臂同一关节的限位数值略有不同（这是正常的）。

---

## 4. 脚本清单（本项目新建）

| 脚本 | 功能 | 是否动臂 |
|------|------|---------|
| `read_servo_once.py` | 一次性读取 6 舵机全部数据（位置/角度/电压/温度/电流/限位） | 否 |
| `read_servo_data.py` | 实时监控数据（10Hz 刷新） | 否 |
| `test_follower_servos.py` | 6 舵机微幅动作测试 | **是（轻微）** |
| `minimal_teleop.py` | 最小联动脚本（仅 scservo_sdk，无需 lerobot） | **是** |
| `calibrate_wrist_roll.py` | 单关节完整标定（零位 + 限位） | 手动转，脚本不主动动 |
| `calibrate_gripper.py` | 专项夹爪快速标定与映射（主手柄与从夹爪 1:1 精确对齐） | 带实时捏合跟随测试 |
| `save_calibration.py` | 把 EPROM 标定导出成 lerobot 缓存文件 | 否 |
| `eval_so101.py` | 纯净 ACT 策略真机闭环自主推理（抓纸巾与抓眼罩） | **是** |
| `eval_so101_hand_follow.py` | ACT 具身抓取 + YOLO 3秒静止跟手智能递送系统 | **是** |

---

## 5. 常用命令速查

> 以下命令默认已在 `conda activate lerobot` 之后。若未激活，用完整路径
> `D:\Anaconda\envs\lerobot\python.exe <脚本>` / `D:\Anaconda\envs\lerobot\Scripts\lerobot-*.exe`。
>
> ⚠️ **PowerShell 注意**：命令换行用反引号 `` ` ``（不是 bash 的 `\`），且 `` ` `` 必须是行末最后一个字符。
> 嫌麻烦就直接**写成一行**（本手册的命令都是单行可用的）。

### 5.1 读数据

```bash
# 一次性快照（只读）
python read_servo_once.py

# 实时监控（Ctrl+C 退出）
python read_servo_data.py
```

### 5.2 微幅动作测试（会轻微动臂，先确认周围无障碍）

```bash
python test_follower_servos.py
```

### 5.3 标定

```bash
# 单关节标定（wrist_roll 示例，按提示转两端）
python calibrate_wrist_roll.py

# 完整官方标定（从臂 6 关节全标，交互式引导）
lerobot-calibrate --robot.type=so101_follower --robot.port=COM5 --robot.id=follower

# 完整官方标定（主臂）
lerobot-calibrate --teleop.type=so101_leader --teleop.port=COM6 --teleop.id=leader

# 把 EPROM 标定导出成缓存文件（标定后跑一次，避免联动时弹标定提示）
python save_calibration.py
```

### 5.4 联动（遥操作）

#### 5.4.1 纯机械臂联动（无相机画面）

```bash
# 官方无相机联动（单行）
lerobot-teleoperate --robot.type=so101_follower --robot.port=COM5 --robot.id=follower --teleop.type=so101_leader --teleop.port=COM6 --teleop.id=leader

# 最小联动（备选，带 --max-step 限幅防突跳）
python minimal_teleop.py --leader COM6 --follower COM5
python minimal_teleop.py --leader COM6 --follower COM5 --dry-run   # 只读不动作
python minimal_teleop.py --leader COM6 --follower COM5 --flip 5    # 翻转 5 号关节方向
```

#### 5.4.2 带手眼相机画面的联动测试（视觉跟随）

在手掰示教的同时，电脑屏幕实时弹出手眼相机的视频回显窗口，用于观察机械臂末端视角与对准情况：

```bash
# 官方带相机联动（单行，--display_data=true 开启画面回显）
lerobot-teleoperate --robot.type=so101_follower --robot.port=COM5 --robot.id=follower --teleop.type=so101_leader --teleop.port=COM6 --teleop.id=leader --robot.cameras='{"handeye": {"type": "opencv", "index_or_path": 1, "fps": 30, "width": 640, "height": 480}}' --display_data=true
```

> ⚠️ **相机参数说明**：
> - 外接 USB 手眼相机索引号为 `1`。
> - 在 `lerobot-teleoperate` 中开启画面的参数为 `--display_data=true`（而在 `lerobot-record` 录制中则为 `--display_cameras=true`）。

**联动前必做**：把主臂和从臂摆到**大致相同姿势**再启动，否则启动瞬间从臂会大幅跳过去。

**联动运行中**：主臂扭矩关闭（手掰），从臂扭矩开启（跟随）。`Ctrl+C` 停止。

### 5.5 纯净 ACT 策略真机自主推理（抓纸巾与抓眼罩）

无需主臂示教器，仅需连接从臂（COM5）与手眼摄像头：

```bash
# 抓纸巾 (Tissue) 自主运行
python eval_so101.py --task tissue

# 抓眼罩 (Eye Mask) 自主运行
python eval_so101.py --task eyemask

# 自定义端口与摄像头 (Linux/Jetson 示例: /dev/ttyACM0, 手眼相机 0)
python eval_so101.py --task tissue --port /dev/ttyACM0 --camera-index 0
```

---

## 6. 完整工作流

```
① 组装 + setup_motors（首次分配舵机 ID）
      ↓
② 标定（lerobot-calibrate，两臂各一次）
      ↓
③ 联动测试（lerobot-teleoperate，验证主从跟随，详细命令见 §9）
      ↓
④ 录数据（lerobot-record，⚠️ 需要摄像头才有图像输入）
      ↓
⑤ 训练（lerobot-train）
      ↓
⑥ 回放（lerobot-replay，在从臂上执行策略）
```

> **没有摄像头**时：③ 联动完全不需要摄像头；④ 录数据若只想做"纯关节"策略可以不加摄像头，但常见 SO-ARM101 流程需要摄像头录图像来训练视觉策略。

---

## 7. 故障排查

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `import lerobot` 报 `No module named 'lerobot'` | 路径含中文或未以可编辑模式安装 | 项目已迁移至英文路径 `D:\group project\lerobot`，运行 `pip install -e .` 即可彻底解决 |
| COM 口里舵机无响应（`no response` / result=-6） | 该臂 12V 电源没接 / 排线松 | 检查电源、排线 |
| 只有 1 个 CH343，找不到主臂口 | 主臂 USB 没插 | 插 USB；用 PowerShell 扫串口 |
| 读出位置/型号是超范围大数 | 用了 `PacketHandler(1)` | 改成 `PacketHandler(0)` |
| `ReadPos` / `WritePosEx` 报 AttributeError | 新版 SDK 无此 API | 换成 `read2ByteTxRx` / `write2ByteTxRx` |
| 联动时某关节方向反了 | 该关节需要翻转 | 加 `--flip <id>`，或改标定 drive_mode |
| 联动时某关节跟不上/幅度不对 | 该关节限位/零位没标好 | 重新标定该关节（`calibrate_wrist_roll.py` 或 `lerobot-calibrate`） |
| 运行 lerobot-teleoperate 弹标定提示 | 缓存文件缺失 | 先跑 `python save_calibration.py` |

---

## 8. 当前标定状态（备份参考）

**从臂（follower / COM5）：**

| 关节 | homing_offset | range |
|------|--------------|-------|
| shoulder_pan | -632 | 814 ~ 3499 |
| shoulder_lift | -603 | 828 ~ 3192 |
| elbow_flex | 542 | 878 ~ 3069 |
| wrist_flex | 459 | 827 ~ 3168 |
| wrist_roll | 30 | 94 ~ 4001 |
| gripper | -1496 | 551 ~ 3500 |

**主臂（leader / COM6）：**

| 关节 | homing_offset | range |
|------|--------------|-------|
| shoulder_pan | -111 | 741 ~ 3450 |
| shoulder_lift | 1084 | 861 ~ 3206 |
| elbow_flex | 101 | 849 ~ 3033 |
| wrist_flex | 45 | 830 ~ 3125 |
| wrist_roll | 691 | 210 ~ 3957 |
| gripper | 328 | 1933 ~ 3145 |

> 缓存文件位置：
> - 从臂 `C:\Users\Administrator\.cache\huggingface\lerobot\calibration\robots\so101_follower\follower.json`
> - 主臂 `C:\Users\Administrator\.cache\huggingface\lerobot\calibration\teleoperators\so101_leader\leader.json`

---

## 9. 完整遥操流程（端到端）

> 目标：主臂（leader）手掰示教 → 从臂（follower）实时跟随。**全程不需要摄像头**。

### 9.1 激活环境（每次新开终端都要做）

```powershell
# 1. 激活 conda 环境
conda activate lerobot

# 2. 确认 lerobot 可用（应打印 0.3.4，不报 ModuleNotFoundError）
python -c "import lerobot; print(lerobot.__version__)"

# 3. 确认两个串口都在（COM5=从臂、COM6=主臂）
Get-PnpDevice -Class Ports | Where-Object {$_.Status -eq "OK"} | Select-Object FriendlyName
```

### 9.2 硬件检查（每次上电后）

1. **从臂（COM5）和主臂（COM6）的 12V 电源都要接**——主臂虽是示教器，内部舵机编码器也要通电才能回传位置。
2. 两条 USB 线（CH343 芯片）都插好。
3. 两臂周围无障碍。

### 9.3 确认标定就绪（首次或改动后做一次）

```powershell
# 读 6 舵机数据，确认两臂都响应（限位/零位不是 [0,4095] 默认值）
python read_servo_once.py

# 改了 EPROM 标定后，重新导出缓存，避免联动时弹标定提示
python save_calibration.py
```

### 9.4 启动联动（核心命令）

#### 9.4.1 无相机联动（纯手掰机械跟随）

```powershell
# 官方联动（单行，直接复制）
lerobot-teleoperate --robot.type=so101_follower --robot.port=COM5 --robot.id=follower --teleop.type=so101_leader --teleop.port=COM6 --teleop.id=leader
```

#### 9.4.2 带手眼相机画面的联动测试（实时视觉回显）

```powershell
# 官方带相机联动（单行直接复制，屏幕弹出 handeye 实时视频窗口）
lerobot-teleoperate --robot.type=so101_follower --robot.port=COM5 --robot.id=follower --teleop.type=so101_leader --teleop.port=COM6 --teleop.id=leader --robot.cameras='{"handeye": {"type": "opencv", "index_or_path": 1, "fps": 30, "width": 640, "height": 480}}' --display_data=true
```

- **启动前**：把主臂和从臂摆到**大致相同姿势**，否则启动瞬间从臂会大幅跳过去。
- **运行中**：主臂扭矩关闭（用手掰），从臂扭矩开启（跟随）。手眼相机画面窗口会同步更新。
- **停止**：`Ctrl+C`。

### 9.5 备用联动（minimal_teleop，无需 lerobot）

```powershell
# 第一次建议先用这个（带 --max-step 限幅，防突跳）
python minimal_teleop.py --leader COM6 --follower COM5

# 只读不动作（先看数据流对不对）
python minimal_teleop.py --leader COM6 --follower COM5 --dry-run

# 某关节方向反了，翻转它（例：5 号 = wrist_roll）
python minimal_teleop.py --leader COM6 --follower COM5 --flip 5
```

### 9.6 联动常见问题

| 现象 | 处理 |
|------|------|
| 启动瞬间大幅跳动 | 先摆到相同姿势再启动；或用 `minimal_teleop.py` 限幅 |
| 某关节方向反 | 加 `--flip <id>` |
| 某关节跟不上/幅度不对 | 该关节限位/零位没标好，重新标定 |
| 报 `No module named 'lerobot'` | 环境未安装，在 `lerobot` 目录下执行 `pip install -e .` |
| 弹标定提示 | 先跑 `python save_calibration.py` |
| 报 `unrecognized arguments: --display-cameras` | 遥操中显示画面的参数是 `--display_data=true`（录制中才是 `--display_cameras=true`） |

---

## 10. 夹纸巾与人手递送示教录制（实战数据集采集）

> **任务目标**：机械臂手眼相机识别床头柜纸巾 ➔ 俯冲抓取 ➔ 垂直抬起并手腕抬头 ➔ 递送到人手掌心 ➔ 松开夹爪 ➔ 缩回待机位归位。
> **数据集存放路径**：`D:\group project\data\tissue_handover`

### 10.1 首次全新录制命令（从 Episode 0 开始创建）

第一次开工录制全新数据集时使用（**不带** `--resume`，总计录制 60 轮）：

```powershell
lerobot-record `
  --robot.type=so101_follower `
  --robot.port=COM5 `
  --robot.id=follower `
  --teleop.type=so101_leader `
  --teleop.port=COM6 `
  --teleop.id=leader `
  --robot.cameras='{"handeye": {"type": "opencv", "index_or_path": 1, "fps": 30, "width": 640, "height": 480}}' `
  --dataset.repo_id="local/tissue_handover" `
  --dataset.root="D:/group project/data/tissue_handover" `
  --dataset.single_task="Grasp the tissue and handover to human hand" `
  --dataset.num_episodes=60 `
  --dataset.episode_time_s=120 `
  --dataset.push_to_hub=false `
  --display_data=true `
  --play_sounds=false
```

### 10.2 中途退出后继续录制命令（断点续录）

中途按 `Esc` 退出休息，下次想**接着上次已有的轮次往下追加录制**时使用（核心差异：添加了 `--resume=true`）：

```powershell
lerobot-record `
  --robot.type=so101_follower `
  --robot.port=COM5 `
  --robot.id=follower `
  --teleop.type=so101_leader `
  --teleop.port=COM6 `
  --teleop.id=leader `
  --robot.cameras='{"handeye": {"type": "opencv", "index_or_path": 1, "fps": 30, "width": 640, "height": 480}}' `
  --dataset.repo_id="local/tissue_handover" `
  --dataset.root="D:/group project/data/tissue_handover" `
  --dataset.single_task="Grasp the tissue and handover to human hand" `
  --dataset.num_episodes=60 `
  --dataset.episode_time_s=120 `
  --resume=true `
  --dataset.push_to_hub=false `
  --display_data=true `
  --play_sounds=false
```

### 10.3 键盘控制与录制要诀（S 键开录，E 键保存，无倒计时催促）

本系统录制流程已做深度优化：**彻底移除了原版的固定倒计时自动开录机制**，由你完全把控每一轮的起止节奏。

#### 1. 两阶段全流程说明：
- **【阶段 1：准备/待命】（终端显示 `👉 【准备/待命】`）**：
  - **不录制任何数据**（手眼相机与主从臂遥控实时可用，供你调整角度、回位）。
  - **绝对没有时间倒计时**！想休息、喝水、摆纸巾多久都可以。
  - 摆好纸巾、做好准备后，**按键盘【S 键】（Start）**，正式开录！
- **【阶段 2：正在录制】（终端显示 `🔴 >>> 【正在录制】`）**：
  - 手眼相机与轨迹正在实时录入数据集。
  - 抓取纸巾 ➔ 递送到人手 ➔ 人手拿走 ➔ 机械臂归位。
  - 归位后，**按键盘【E 键】（End）**，立即封包保存本轮，并自动切回【阶段 1：准备/待命】。

#### 2. 按键功能速查表：
- 🟢 **`S` 键 (Start 开录)**：
  - 在【准备待命】时：按一下 ➔ **正式开始录制本轮**。
- 🔴 **`E` 键 (End 结束)**：
  - 在【正在录制】时：按一下 ➔ **立即结束并保存本轮**（随后自动转入下一轮待命）。
- 👈 **左箭头 `←` 或 `R` 键 (Re-record 重录)**：
  - 中途手滑、纸巾掉落或动作变形时按一下，**立刻作废本轮**（清空缓存），直接返回待命阶段重新开始。
  - **安全性保证**：作废**仅清空当前正在录制这一轮的临时内存**，之前已经保存的轮次完好无损保存在硬盘上，已录进度不倒退！
- 🛑 **`Esc` 键 (退出)**：
  - 想休息时，按 `Esc` 安全退出程序。
  - 若在待命阶段按 `Esc`，之前录好的轮次全部完好保存；若在录制中途按 `Esc`，自动舍弃该未完成轮次后安全退出。
- ⚠️ **防夹爪堵转避坑**：
  - 抓纸巾时，手柄**轻合微捏、纸巾不掉即可**，切勿用力死死捏紧到底，避免从臂 6 号舵机持续大电流触发 Overload 32 堵转保护。

### 10.4 夹爪重新精细映射与标定（解决手柄映射不好、夹不紧或过紧过载）

若觉得主臂手柄与从臂夹爪的开合幅度不匹配（例如手柄捏了一半夹爪没反应、捏紧后从臂夹爪死死挤压堵转、或者开度不够）：

**运行专属夹爪标定脚本（1 分钟完成，绝不影响 1~5 号手臂舵机）：**

```powershell
python calibrate_gripper.py
```

#### 操作步骤（4步交互）：
1. **主臂手柄完全松开**：手自然放开主臂夹爪，按回车；
2. **主臂手柄正常捏紧**：单手握紧手柄到平时夹纸巾的自然力度，保持住按回车；
3. **从臂夹爪完全张开**：用手将从臂夹爪轻轻掰到最大的自然张开位置，按回车；
4. **从臂夹爪刚好闭合**：用手将从臂两指合拢到指尖刚好贴合碰触（切勿硬挤死别），按回车；
5. **实时联动测试**：脚本会自动更新主从臂的 `leader.json` 和 `follower.json`，并开启夹爪联动。此时在键盘终端前捏合手柄，观察从臂夹爪是否 1:1 丝滑跟随。满意按 `Q` 退出保存即可！

---

## 11. 抓眼罩与人手递送示教录制（多任务第二弹：eyemask_handover）

> **任务目标**：机械臂手眼相机识别床头柜眼罩 ➔ 俯冲夹取眼罩（忽略旁边作为干扰项的纸巾） ➔ 垂直抬起并平稳运送 ➔ 递送到人手掌心 ➔ 松开夹爪 ➔ 机械臂缩回初始待机位。  
> **数据集存放路径**：`D:\group project\data\eyemask_handover`  
> **任务指令**：`"Grasp the eye mask and handover to human hand"`

### 11.1 首次全新录制命令（从 Episode 0 开始创建）

第一次开始录制眼罩全新数据集时使用（**不带** `--resume`，总计录制 60 轮）：

```powershell
lerobot-record `
  --robot.type=so101_follower `
  --robot.port=COM5 `
  --robot.id=follower `
  --teleop.type=so101_leader `
  --teleop.port=COM6 `
  --teleop.id=leader `
  --robot.cameras='{"handeye": {"type": "opencv", "index_or_path": 1, "fps": 30, "width": 640, "height": 480}}' `
  --dataset.repo_id="local/eyemask_handover" `
  --dataset.root="D:/group project/data/eyemask_handover" `
  --dataset.single_task="Grasp the eye mask and handover to human hand" `
  --dataset.num_episodes=60 `
  --dataset.episode_time_s=120 `
  --dataset.push_to_hub=false `
  --display_data=true `
  --play_sounds=false
```

### 11.2 中途退出后继续录制命令（断点续录）

中途按 `Esc` 退出休息，下次想**接着上次已有的眼罩轮次往下追加录制**时使用（核心差异：添加了 `--resume=true`）：

```powershell
lerobot-record `
  --robot.type=so101_follower `
  --robot.port=COM5 `
  --robot.id=follower `
  --teleop.type=so101_leader `
  --teleop.port=COM6 `
  --teleop.id=leader `
  --robot.cameras='{"handeye": {"type": "opencv", "index_or_path": 1, "fps": 30, "width": 640, "height": 480}}' `
  --dataset.repo_id="local/eyemask_handover" `
  --dataset.root="D:/group project/data/eyemask_handover" `
  --dataset.single_task="Grasp the eye mask and handover to human hand" `
  --dataset.num_episodes=60 `
  --dataset.episode_time_s=120 `
  --resume=true `
  --dataset.push_to_hub=false `
  --display_data=true `
  --play_sounds=false
```

### 11.3 桌面抗干扰摆放与示教技巧

1. **桌面双物同台（保留纸巾当静态干扰项）**：
   - 桌面上依然同时摆放【眼罩】与【米黄色小包纸巾】；
   - 示教时，主臂**只控制机械臂去精准抓取眼罩**，旁边的纸巾保持静止，充当最真实的静态视觉负样本（Distractor）。
2. **位置与姿态多样性（避免死记绝对坐标）**：
   - 每 15~20 轮左右调换一次眼罩与纸巾的相对位置（眼罩在左/纸巾在右、眼罩在右/纸巾在左、眼罩靠前/纸巾靠后）；
   - 眼罩有时平放伸展，有时微拢微折，绑带有时在前有时在后。
3. **眼罩抓取手法**：
   - 眼罩是柔性织物面料，夹爪既可以夹取眼罩中间的鼻梁连接处，也可以夹取眼罩正面织物边缘；
   - 手柄自然轻捏即可咬牢，不需要死命死死捏紧。

### 11.4 快捷键说明（全手动节奏控制）

- 🟢 **`S` 键 (Start 开录)**：在【准备待命】模式下按一下 ➔ **正式开录本轮**；
- 🔴 **`E` 键 (End 结束)**：在【正在录制】模式下动作完成归位后按一下 ➔ **立即结束并封包保存本轮**；
- 👈 **`←` 或 `R` 键 (Re-record 重录)**：中途夹偏或脱手时按一下 ➔ **立即作废本轮重来**（已存轮次完好无损）；
- 🛑 **`Esc` 键 (退出)**：安全退出录制程序。

### 11.5 眼罩数据集打包与云端训练

眼罩数据集已全部录制完成并打包就绪：
- **压缩包文件**：`D:\group project\eyemask_handover.zip`
- **压缩包体积**：`509.36 MB`
- **包含内容**：126 个数据文件（全部 61 轮 Parquet 舵机轨迹 + 61 轮手眼 MP4 视频 + 完整元数据，累计 40,535 帧，100% 校验健康）。

#### 云端一键训练与权重打包指引：
详细的 AutoDL 云端训练步骤（包括解压、v3.0 轻量格式转换、训练命令、打包下载与真机评测）请直接参阅：
👉 [README_AutoDL云端训练操作指南.md](../README_AutoDL云端训练操作指南.md)

1. **解压与格式轻量转换（JupyterLab 终端）**：
   ```bash
   cd /root && unzip -q eyemask_handover.zip -d /root/
   python -m lerobot.scripts.convert_dataset_v21_to_v30 --repo-id=local/eyemask_handover --root=/root/eyemask_handover --push-to-hub=false
   ```
2. **一键启动训练**：
   ```bash
   lerobot-train --dataset.repo_id="local/eyemask_handover" --dataset.root="/root/eyemask_handover" --policy.type=act --policy.push_to_hub=false --policy.use_amp=true --output_dir="/root/outputs/train/act_eyemask" --batch_size=16 --steps=50000 --save_freq=10000
   ```
3. **打包权重并下载**：
   ```bash
   tar -czvhf /root/act_eyemask_weights.tar.gz -C /root/outputs/train/act_eyemask/checkpoints/last/pretrained_model .
   ```
4. **本地真机闭环评测**：
   ```powershell
   python eval_so101.py --task eyemask
   ```
   *(如果测试抓纸巾，运行: `python eval_so101.py --task tissue`)*

---

## 12. 空间泛化增强：左前方/极限姿态增补数据录制与一键合成

详细录制规划与 AutoDL 微调指南见：👉 [README_AutoDL云端训练操作指南.md](../README_AutoDL云端训练操作指南.md) 第 7 节。

### 12.1 独立录制增补数据集（物理隔离，保存于 `tissue_handover_supplement`）
```powershell
conda activate lerobot
cd "D:\group project"
# 首次录制 (默认 20 轮):
python record_supplement.py
# 断点续录:
python record_supplement.py --resume
# 极简稳定模式 (推荐！关闭 Rerun 弹窗，杜绝 Windows socket 报错与卡顿):
python record_supplement.py --resume --no-display
```

### 12.2 本地一键无缝合并 (`merge_datasets.py`)
```powershell
python merge_datasets.py `
  --base "D:/group project/data/tissue_handover" `
  --supplement "D:/group project/data/tissue_handover_supplement" `
  --output "D:/group project/data/tissue_handover_merged"
```
合并后自动将 66 轮基准与 20 轮增补拼接为 **86 轮全新数据集**（或 107 轮升级版），重编索引并通过原生校验。直接打包上传 AutoDL 训练即可让模型获得大角度左偏自适应抓取能力！

---

## 13. 纯净 ACT 策略真机闭环自主运行 (`eval_so101.py`)

> **运行特性**：
> - **纯净具身大模型闭环**：完全脱离 YOLO 手部视觉跟随，100% 由 ACT 策略神经网络端到端自主掌控（手眼相机视觉感知 ➔ 6 自由度关节位置输出 ➔ 机械臂执行抓取与递送）；
> - **跨平台自适应**：原生适配 Windows 11 本地运行与 NVIDIA Jetson (Linux aarch64) 边缘端运行；
> - **智能安全机制**：内置动作平滑滤波（EMA），消除 Chunk 切换卡顿，夹爪完全遵循原生力控分布，绝不堵转。

### 13.1 核心启动命令速查

#### 1. 抓纸巾任务 (Tissue Handover)
```powershell
# Windows 本地快速启动 (默认 COM5，手眼相机 0)
python eval_so101.py --task tissue

# 自定义端口与手眼摄像头 (例: 机械臂在 COM5, 摄像头为 1 号)
python eval_so101.py --task tissue --port COM5 --camera-index 1

# Linux / Jetson 开发板启动
python3 eval_so101.py --task tissue --port /dev/ttyACM0 --camera-index 0

# SSH 远程终端无界面模式 (在无显示器的 Linux / Jetson 终端运行，实时输出 FPS 与状态)
python3 eval_so101.py --task tissue --port /dev/ttyACM0 --no-display
```

#### 2. 抓眼罩任务 (Eye Mask Handover)
```powershell
# Windows 本地快速启动
python eval_so101.py --task eyemask

# 自定义端口与摄像头
python eval_so101.py --task eyemask --port COM5 --camera-index 0

# Linux / Jetson 开发板启动
python3 eval_so101.py --task eyemask --port /dev/ttyACM0 --camera-index 0
```

---

### 13.2 现场极限工况参数动态微调 (Cheat Sheet)

若现场测试时纸巾或眼罩摆放位置有偏差、桌面高度不同，无需重新训练模型，直接在启动命令后追加微调参数：

| 参数 | 默认值 | 推荐微调值 | 作用与适用场景 |
| :--- | :---: | :---: | :--- |
| `--task` | `tissue` | `tissue` / `eyemask` | 选择任务模型权重 (`act_tissue` 或 `act_eyemask`) |
| `--port` | `COM5` / `/dev/ttyACM0` | 对应串口号 | 机械臂从臂串口连接号 (Windows 为 `COMx`，Linux 为 `/dev/ttyACMx` 或 `/dev/ttyUSBx`) |
| `--camera-index` | `0` | `0` 或 `1` | 手眼摄像头序号 (若插入多个摄像头时可快速对调) |
| `--pan-gain` | `1.0` | `1.20` ~ `1.35` | **左转幅度放大系数**：纸巾摆在偏左前方时，按比例放大左转下潜幅度 |
| `--pan-offset` | `0.0` | `-5.0` ~ `-8.0` | **底座静态航向偏置**：负值整体向左修正角度，补足左侧转向不足 |
| `--lift-offset` | `0.0` | `-3.0` 或 `+3.0` | **肩部俯仰高度补偿**：负值抬升接近高度（防撞盒壁），正值下潜更深（防抓空） |
| `--smooth-alpha`| `0.65`| `0.75` ~ `0.85` | **平滑系数**：0.65 为超平滑消除点头；调高至 0.85 可提升机械臂转向敏捷度 |
| `--n-action-steps`| `60`/`30` | `100` | **重规划步长**：原生 100 步 chunk 动作连贯；30 步对准精细 |
| `--no-display` | `False` | 命令行直接加 | 无窗口模式（适合 SSH 远程终端运行） |

#### 针对左前方长尾位置的抓纸巾黄金组合命令：
```powershell
python eval_so101.py --task tissue --pan-gain 1.25 --pan-offset -5.0 --smooth-alpha 0.80
```

---

### 13.3 运行交互快捷键
- **`[Q]` 或 `[Esc]` 或 `Ctrl+C`**：安全退出程序，机械臂立即安全断电释放扭矩；
- **`[R]` 键**：立即重置策略记忆与平滑滤波器，就地开启新一轮自主抓取。

### 13.4 启动前重要注意事项（必看避坑）
1. **初始休息位对齐**：敲回车启动脚本前，**务必手动把机械臂轻轻扶回常规居中朝前、夹爪微收的标准休息姿态**。若机械臂初始姿势偏差过大，首帧动作可能会发生突跳。
2. **12V 独立供电**：从臂控制板必须接通 **12V 独立电源**（仅插 USB 线舵机不会通电动作）。

---

## 14. 进阶人机交互：ACT 具身抓取 + YOLO 3秒静止确认智能递送系统 (`eval_so101_hand_follow.py`)

### 14.1 核心交互设计（先动态跟随，手静止停住 3 秒再松爪）
彻底避免“一看到手就盲目松爪”，真正实现人性化服务机器人交互：

1. **自主抓取升空**：ACT 策略网络自主下潜抓取纸巾，升空到达递送就绪位后，底层自动锁定夹爪为 **100% 紧咬**，升空全程绝不松爪；
2. **先动态跟随 (Continuous Follow)**：
   - 机械臂夹着纸巾跟随人手移动（底座偏航+大臂俯仰）；
   - **无论手怎么移动，夹爪始终紧紧咬住纸巾，绝不提前松开**！
3. **静止停下满 3 秒才松爪交付 (3s Still Confirmation)**：
   - 当用户把手移动到心仪位置并**停下保持静止**：
   - 系统检测到手部静止，屏幕亮起黄色 3 秒倒计时进度条；
   - 若中途手又动了，计时自动归零，机械臂继续跟手；
   - **只有手部连续静止保持满 3.0 秒**（确认用户就位准备接取），夹爪才平稳松开至 50% 递交纸巾！
   - （同时支持物理轻拽纸巾立即顺应松爪作为备选）。
4. **优雅后撤与自动循环**：
   - 交付后机械臂自动后仰 15° 避让出空间；
   - 倒计时 3 秒后自动开启下一轮抓取，循环往复，全程无需碰键盘！

### 14.2 一键启动命令

#### 模式一：全流程自主运行（抓取升空 -> 随手而动 -> 停下3秒自动递送）
```powershell
conda activate lerobot
cd "D:\group project"
python eval_so101_hand_follow.py
```

#### 模式二：直接启动手部跟随模式（跳过抓取，直接在空中测试跟手与3秒递送）
```powershell
python eval_so101_hand_follow.py --follow-only
```
> **自定义静止时间**：如果想改为静止 2 秒或 4 秒，可加参数：`--still-time 2.0`。
> **实时按键**：随时按 **`[F]`** 切换模式，按 **`[R]`** 立即重置，按 **`[Q]`** 安全退出。

> **实时按键说明**：
> - 运行中随时按 **`[F]`** 键：强制切换【手部跟随】与【ACT 抓取】模式；
> - 运行中随时按 **`[R]`** 键：复位重新开始一轮；
> - 运行中随时按 **`[Q]`** 键：安全退出。

### 14.3 独立相机画面与 YOLO 手部检测测试（无需连接机械臂）
如果只想在屏幕上纯看 YOLO 手部绿框识别效果与 FPS：
```powershell
python test_hand_camera_live.py
```
> 在弹出的窗口中可按 **`[C]`** 键快速在手眼相机（0）与电脑自带相机（1）之间切换。



