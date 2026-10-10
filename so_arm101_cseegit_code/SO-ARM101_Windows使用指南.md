# SO-ARM101 开源 6 轴机械臂 Windows 全流程操作指南（含散件组装与上位机）

本指南专为 **Windows 11** 系统编写，完整涵盖从 **散件组装、舵机标号/对齐、图形化上位机调试、主从校准、遥操作控制、数据采集到模型训练与推理** 的全流程。所有环境均配置在 **D 盘**（`D:\Anaconda\envs\lerobot` 和 `D:\分组项目\lerobot`）。

---

## 目录
- [0. 散件组装、舵机标号与上位机调试 (散件必读)](#0-散件组装舵机标号与上位机调试-散件必读)
  - [0.1 舵机型号与关节分配 (严禁混淆)](#01-舵机型号与关节分配-严禁混淆)
  - [0.2 舵机标号核心避坑原则](#02-舵机标号核心避坑原则)
  - [0.3 舵机标号方式一：LeRobot 交互向导 (强烈推荐)](#03-舵机标号方式一lerobot-交互向导-强烈推荐)
  - [0.4 舵机标号方式二：图形化上位机 ServoStudio](#04-舵机标号方式二图形化上位机-servostudio)
  - [0.5 舵机中位对齐与装配参考视频](#05-舵机中位对齐与装配参考视频)
  - [0.6 3D 打印件与图纸参数 (如需自行打印)](#06-3d-打印件与图纸参数-如需自行打印)
- [1. 虚拟环境激活与工作目录](#1-虚拟环境激活与工作目录)
- [2. 整体电路连接与 COM 端口确认](#2-整体电路连接与-com-端口确认)
- [3. 机械臂全关节校准 (初次组装后必须执行)](#3-机械臂全关节校准-初次组装后必须执行)
- [4. 机械臂遥操作控制 (Teleoperation)](#4-机械臂遥操作控制-teleoperation)
- [5. 动作数据采集 (Record Dataset)](#5-动作数据采集-record-dataset)
- [6. 模型训练与自主推理 (Train & Inference)](#6-模型训练与自主推理-train--inference)
- [7. 常见问题与快速排查](#7-常见问题与快速排查)

---

## 0. 散件组装、舵机标号与上位机调试 (散件必读)

### 0.1 舵机型号与关节分配 (严禁混淆)
散件包中配有两种不同性能的飞特总线舵机，组装前必须严格分类：

| 机械臂类型 | 舵机型号 | 减速比 | 特点 | 数量 |
| :--- | :--- | :--- | :--- | :---: |
| **主臂 (Leader 遥操作示教臂)** | **HX-10HM** | 1:147 | 低阻力、拖动手感顺滑、轻便 | 6 个 |
| **从臂 (Follower 执行抓取臂)** | **HX-30HM** | 1:345 | 大减速比、堵转扭矩 30kg·cm、负载力强 | 6 个 |

**机械臂 6 个关节与舵机 ID 对应关系（从底座往上到夹爪）：**
- **ID 1**：`shoulder_pan`（底座旋转 / 肩部偏航）
- **ID 2**：`shoulder_lift`（肩部俯仰 / 大臂升降）
- **ID 3**：`elbow_flex`（肘部俯仰 / 小臂弯曲）
- **ID 4**：`wrist_flex`（手腕俯仰）
- **ID 5**：`wrist_roll`（手腕旋转）
- **ID 6**：`gripper`（末端夹爪开合）

---

### 0.2 舵机标号核心避坑原则
> ⚠️ **高危提醒**：新出厂的飞特舵机出厂默认 ID 通常都是 `1`。在给舵机设置新 ID 时，**驱动板上每次只能单独插 1 个舵机**！绝对不能把多个舵机串联在一起通电设置，否则会把连在总线上的所有舵机同时误写成同一个 ID！

---

### 0.3 舵机标号方式一：LeRobot 交互向导 (强烈推荐)
环境内自带了官方编写的自动化交互式标号脚本，防呆且绝不易出错：

1. 将驱动板通过 USB 接入电脑，**驱动板上只插 1 个待设置的舵机**。
2. 打开终端，进入虚拟环境：
   ```powershell
   conda activate lerobot
   cd D:\分组项目\lerobot
   ```
3. 执行标号命令：
   - **如果是主臂舵机（HX-10HM）**：
     ```powershell
     lerobot-setup-motors --teleop.type=so101_leader --teleop.port=COM22
     ```
   - **如果是从臂舵机（HX-30HM）**：
     ```powershell
     lerobot-setup-motors --robot.type=so101_follower --robot.port=COM24
     ```
4. 终端会按顺序逐个提示：
   - 提示 `Connect gripper (ID 6)` -> 接入夹爪舵机，按 **回车**，系统自动完成烧录并校验。
   - 提示 `Connect wrist_roll (ID 5)` -> 拔下上一个，换上新舵机，按 **回车**...
   - 依次完成 ID 6 -> 5 -> 4 -> 3 -> 2 -> 1 的标号。
   - **建议**：每设置好一个，用记号笔或贴纸在舵机外壳上标明 `ID 1` ~ `ID 6`。

---

### 0.4 舵机标号方式二：图形化上位机 ServoStudio
如果需要可视化查看舵机参数、读取电压/温度或单独测试某个舵机，可使用资料包内自带的绿色免安装上位机：

- **上位机程序路径**：`d:\分组项目\SO-ARM101开源6轴机械臂\4.附件\上位机软件\ServoStudio_v0.1.5.exe`
- **使用步骤**：
  1. 双击打开 `ServoStudio_v0.1.5.exe`（绿色免安装）。
  2. 驱动板上**只连接 1 个舵机**。
  3. 选择对应的 **COM 端口**，波特率选择 **1000000**（1M），点击「连接」。
  4. 点击「扫描/搜索舵机」，界面会识别出当前舵机（默认 ID 通常为 1）。
  5. 在 ID 设置框中输入目标编号（例如 `2`），点击「写入/修改 ID」并保存。
  6. 可以拖动滑块测试转动，也可以点击「回中」将舵机转到中位（2048 角度）。

---

### 0.5 舵机中位对齐与装配参考视频
- **中位对齐要点**：安装舵盘与结构件固定螺丝前，舵机必须处于电气中位（2048 / 180°），保证各关节左右/俯仰有对称活动行程。
- **官方手把手高清视频教程（直接在本地打开即可观看）**：
  - **从臂硬件装配**：`d:\分组项目\SO-ARM101开源6轴机械臂\1.课程资料\视频教程\3.1.1 从臂硬件组装.mp4`
  - **主臂硬件装配**：`d:\分组项目\SO-ARM101开源6轴机械臂\1.课程资料\视频教程\3.1.2 主臂硬件组装.mp4`
  - **从臂 ID 设置演示**：`d:\分组项目\SO-ARM101开源6轴机械臂\1.课程资料\视频教程\3.5.1 从臂ID设置.mp4`
  - **主臂 ID 设置演示**：`d:\分组项目\SO-ARM101开源6轴机械臂\1.课程资料\视频教程\3.5.2 主臂ID设置.mp4`
  - **电路接线教程**：`d:\分组项目\SO-ARM101开源6轴机械臂\1.课程资料\视频教程\3.3 电路连接教程.mp4`
  - **相机安装教程**：`d:\分组项目\SO-ARM101开源6轴机械臂\1.课程资料\视频教程\3.2 相机安装教程.mp4`

---

### 0.6 3D 打印件与图纸参数 (如需自行打印)
如果您手头的散件不含 3D 打印外壳，可使用工程自带图纸送去**嘉立创 3D 打印（三维猴）**下单：
- **3D 模型文件路径**：`d:\分组项目\SO-ARM101开源6轴机械臂\3.技术参数&图纸\3D图纸\`
  - `白lerobot.3mf`（从臂白件）
  - `黑lerobot.3mf`（主臂黑件）
- **嘉立创下单参数建议**：
  - **材料**：`PLA` 或 `PETG`（高韧性抗断裂）
  - **层高**：`0.20 mm`
  - **填充率**：`15% ~ 20%`
  - **支撑**：自动生成树状支撑即可。

---

## 1. 虚拟环境激活与工作目录

打开 Windows 终端（PowerShell 或 CMD），运行以下命令进入环境：

```powershell
# 1. 激活机械臂虚拟环境
conda activate lerobot

# 2. 切换到机械臂工程根目录
cd D:\分组项目\lerobot
```

---

## 2. 整体电路连接与 COM 端口确认

1. **接线顺序**：
   - 舵机总线数据线依次串联（ID 1 -> 2 -> 3 -> 4 -> 5 -> 6） -> 连接驱动板总线接口 -> USB 集线器/电脑 USB 接口 -> 插上 **12V 5A 电源适配器**。
2. **确认与固定 COM 端口号**：
   - 先插入 **从臂（Follower）** USB，打开「设备管理器」->「端口 (COM 和 LPT)」查看端口（例如 `COM24`）。
   - 再插入 **主臂（Leader）** USB，查看新增端口（例如 `COM22`）。
   > 💡 **建议**：右键设备属性 -> 端口设置 -> 高级，将端口号手动固定为 `COM22`（主臂）和 `COM24`（从臂），后续所有命令即可直接粘贴运行！

---

## 3. 机械臂全关节校准 (初次组装后必须执行)

> ⚠️ **校准说明**：校准是为了建立主从臂各舵机编码器的零位基准与最大行程对应关系。校准前先将机械臂摆到初始平齐参考姿态。

### 3.1 主臂校准 (Leader)
```powershell
lerobot-calibrate --teleop.type=so101_leader --teleop.port=COM22 --teleop.id=my_awesome_leader_arm
```
*按终端提示用手缓慢转动主臂的每一个关节，转动到极限位置后再回位，完成后按回车保存。*

### 3.2 从臂校准 (Follower)
```powershell
lerobot-calibrate --robot.type=so101_follower --robot.port=COM24 --robot.id=my_awesome_follower_arm
```
*按终端提示缓慢转动从臂的每一个关节，完成后按回车保存。*

---

## 4. 机械臂遥操作控制 (Teleoperation)

### 4.1 无视觉遥操作（纯舵机主从跟随测试）
```powershell
python -m lerobot.teleoperate --robot.type=so101_follower --robot.port=COM24 --robot.id=my_awesome_follower_arm --teleop.type=so101_leader --teleop.port=COM22 --teleop.id=my_awesome_leader_arm
```
- 手动拖动主臂，从臂会实时、精准跟随主臂姿态同步运动！
- 退出程序：按键盘快捷键 `Ctrl + C`。

### 4.2 查找与确认 USB 摄像头索引
接上两个 USB 摄像头（固定环境视角 + 机械臂末端夹爪视角），运行：
```powershell
lerobot-find-cameras opencv
```
程序会在 `outputs/captured_images` 下生成测试照片，根据画面确认 `opencv_0` 和 `opencv_1` 分别对应的镜头位置。

### 4.3 带视觉画面回传的遥操作
```powershell
python -m lerobot.teleoperate --robot.type=so101_follower --robot.port=COM24 --robot.id=my_awesome_follower_arm --robot.cameras="{ fixed: {type: opencv, index_or_path: 1, width: 640, height: 480, fps: 30}, handeye: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}}" --teleop.type=so101_leader --teleop.port=COM22 --teleop.id=my_awesome_leader_arm --display_data=true
```

---

## 5. 动作数据采集 (Record Dataset)

通过主臂遥操作控制从臂抓取物体（如螺丝刀/小方块），录制 20 轮示教数据集：

```powershell
python -m lerobot.record --robot.type=so101_follower --robot.port=COM24 --robot.id=my_awesome_follower_arm --robot.cameras="{ handeye: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}, front: {type: opencv, index_or_path: 1, width: 640, height: 480, fps: 30}}" --teleop.type=so101_leader --teleop.port=COM22 --teleop.id=my_awesome_leader_arm --display_data=true --dataset.repo_id=user/demo --dataset.num_episodes=20 --dataset.single_task="Grab the screwdriver" --dataset.push_to_hub=false
```
- **录制操作流程**：
  1. 终端提示开始录制 -> 手动操作主臂完成一次完整的抓取动作。
  2. 动作完成后按键盘 **`→` (右方向键)**，环境复位并保存该轮数据。
  3. 若抓取失误想重录，按 **`←` (左方向键)** 放弃本轮重新录制。
  4. 采集满 20 轮后系统会自动提示完成，按 **`Esc`** 退出。

---

## 6. 模型训练与自主推理 (Train & Inference)

### 6.1 云端 GPU 极速训练流程（针对轻薄本/核显电脑的最佳方案）
1. 打开您电脑上现成的 **MobaXterm**（通过 SFTP 模式）。
2. 将本地录制好的数据集文件夹（默认在用户目录 `.cache/huggingface/lerobot/` 或 `outputs/`）和 `lerobot.zip` 拖动上传到租用的 GPU 云主机（如智星云 RTX 4090，按小时租用，几元钱即可在 1~2 小时内完成 10 万步训练）。
3. 在云端 SSH 终端中进入环境执行训练命令：
   ```bash
   python lerobot/scripts/train.py --dataset.repo_id=demo --policy.type=act --output_dir=outputs/train/act_so101_test --job_name=act_so101_test --policy.device=cuda --wandb.enable=false --policy.push_to_hub=false
   ```
4. 训练完成后，使用 MobaXterm 将生成的模型权重文件 `pretrained_model` 下载回本地电脑的 `outputs/train/act_so101_test/checkpoints/last/` 目录。

### 6.2 本地模型自主推理测试（机械臂全自动抓取）
训练好的模型下载回本地后，电脑只需连接**从臂（Follower）与摄像头**（主臂无需通电）：
```powershell
python -m lerobot.record --robot.type=so101_follower --robot.port=COM24 --robot.id=my_awesome_follower_arm --robot.cameras="{ handeye: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}, front: {type: opencv, index_or_path: 1, width: 640, height: 480, fps: 30}}" --display_data=true --dataset.repo_id=user/eval_so101 --dataset.single_task="Grab the screwdriver" --policy.path=outputs/train/act_so101_test/checkpoints/last/pretrained_model --dataset.episode_time_s=60
```
- 机械臂将直接读取摄像头视觉，并自主执行 AI 学到的抓取动作！

---

## 7. 常见问题与快速排查

1. **终端输入 conda 提示未识别**：
   - 运行 `D:\Anaconda\Scripts\activate` 激活 base 环境后，再执行 `conda activate lerobot`。
2. **串口通信拒绝访问或找不到 COM 端口**：
   - 检查驱动板电源指示灯与 12V 供电是否正常；重新插拔 USB 数据线并在设备管理器确认端口号是否变化。
3. **摄像头画面顺序颠倒或黑屏**：
   - 运行 `lerobot-find-cameras opencv` 重新查看照片确认 ID，将命令中的 `index_or_path: 0` 和 `1` 对调即可。
4. **遥操作时主从臂旋转方向相反**：
   - 说明某个关节校准零点摆反了，重新运行 `lerobot-calibrate`，按提示重新转动校准即可。
