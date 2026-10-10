# SO-ARM101 纯净 ACT 策略 Jetson 部署包 (速查手册)

本包已完整打包 **抓纸巾 (`act_tissue`)** 与 **抓眼罩 (`act_eyemask`)** 的模型权重、机械臂底层通信驱动、诊断工具及自动配置脚本。

---

## ⚡ 3 步极速运行 (Quick Start)

### 步骤 1：解压并运行一键环境配置
```bash
cd so101_jetson_deploy
chmod +x setup_jetson_env.sh
./setup_jetson_env.sh
```

### 步骤 2：运行硬件健康诊断 (可选但强烈建议)
```bash
# 测试 6 轴舵机通信与 12V 供电
python3 test_arm_port.py --port /dev/ttyACM0

# 测试手眼摄像头画面采样
python3 test_camera.py --index 0 --no-display
```

### 步骤 3：启动 AI 自主抓取闭环推理
```bash
# 任务一：抓纸巾 (Tissue)
python3 eval_so101.py --task tissue --port /dev/ttyACM0 --camera-index 0

# 任务二：抓眼罩 (Eye Mask)
python3 eval_so101.py --task eyemask --port /dev/ttyACM0 --camera-index 0
```
> **若通过 SSH 远程无界面调试**，请在命令末尾加上 `--no-display` 参数。

---

## 📌 核心参数微调速查表
若现场纸巾放置靠左或有高度偏差，可在启动命令后直接追加参数：
- `--pan-gain 1.25`：当向左抓取时放大转向幅度 25%（解决左前方目标转动不足）
- `--pan-offset -5.0`：底座静态向左修正 5 度
- `--lift-offset -3.0`：接近高度抬升 3 度（防止磕碰纸盒）
- `--smooth-alpha 0.80`：提高转向响应敏捷度（0.65 为超顺滑，0.80 更跟手）

完整系统配置要求、CUDA PyTorch 安装及常见问题，请详细阅读 [DEPLOY_GUIDE_JETSON.md](./DEPLOY_GUIDE_JETSON.md)。
