#!/usr/bin/env bash
# ==============================================================================
# SO-ARM101 Jetson 环境一键自动配置脚本
# 适用平台: NVIDIA Jetson (Orin Nano / Orin NX / AGX Orin / Xavier 等, Ubuntu 20.04 / 22.04)
# ==============================================================================

set -e

echo "=================================================================="
echo "🚀 开始配置 SO-ARM101 机械臂在 Jetson 上的运行环境..."
echo "=================================================================="

# 1. 检查 Python 版本
PYTHON_CMD="python3"
if ! command -v $PYTHON_CMD &> /dev/null; then
    echo "❌ 未检测到 python3，请先安装 Python: sudo apt update && sudo apt install -y python3 python3-pip"
    exit 1
fi
echo "✓ Python 命令: $(which $PYTHON_CMD) (版本: $($PYTHON_CMD --version))"

# 2. 串口权限与 udev 规则配置
echo ""
echo "[1/5] 正在配置从臂 USB 串口访问权限..."
sudo usermod -a -G dialout $USER

# 创建 udev 规则，确保热插拔后 /dev/ttyACM* 和 /dev/ttyUSB* 默认拥有 0666 读写权限
RULE_FILE="/etc/udev/rules.d/99-so101-serial.rules"
if [ ! -f "$RULE_FILE" ]; then
    echo 'KERNEL=="ttyACM*", MODE="0666", GROUP="dialout"' | sudo tee $RULE_FILE > /dev/null
    echo 'KERNEL=="ttyUSB*", MODE="0666", GROUP="dialout"' | sudo tee -a $RULE_FILE > /dev/null
    sudo udevadm control --reload-rules
    sudo udevadm trigger
    echo "✓ 已创建 udev 串口免权规则: $RULE_FILE"
else
    echo "✓ udev 串口规则已存在。"
fi

# 3. 部署机械臂零点标定缓存
echo ""
echo "[2/5] 正在部署机械臂标定参数缓存..."
CALIB_TARGET="$HOME/.cache/huggingface/lerobot/calibration/robots/so101_follower"
mkdir -p "$CALIB_TARGET"
if [ -f "calibration/follower.json" ]; then
    cp -f "calibration/follower.json" "$CALIB_TARGET/follower.json"
    echo "✓ 已成功导入 6 轴舵机标定缓存至: $CALIB_TARGET/follower.json"
else
    echo "⚠️ 未在当前目录找到 calibration/follower.json，后续可通过 python3 save_calibration.py 自动生成。"
fi

# 4. 安装 Python 核心依赖与本地 LeRobot
echo ""
echo "[3/5] 正在安装 Python 依赖与 LeRobot 机械臂驱动..."
$PYTHON_CMD -m pip install --upgrade pip
$PYTHON_CMD -m pip install -r requirements-jetson.txt

# 本地安装 LeRobot (保留对 SO-101 舵机协议支持)
if [ -d "lerobot" ]; then
    echo "正在以开发模式安装定制版 LeRobot 源码..."
    $PYTHON_CMD -m pip install -e ./lerobot --no-deps
    echo "✓ LeRobot 源码安装完成！"
fi

# 5. 检查 PyTorch CUDA 硬件加速
echo ""
echo "[4/5] 正在检查 Jetson GPU CUDA 加速状态..."
$PYTHON_CMD -c "
import torch
print('PyTorch 版本:', torch.__version__)
if torch.cuda.is_available():
    print('✓ CUDA 加速已启用! 设备名称:', torch.cuda.get_device_name(0))
else:
    print('⚠️ 警告: PyTorch 当前处于 CPU 模式！')
    print('   在 Jetson 上直接运行 pip install torch 可能会安装 CPU 版。')
    print('   若需发挥 Jetson GPU 性能，请参考 DEPLOY_GUIDE_JETSON.md 安装 NVIDIA 官方 Jetson PyTorch Wheel。')
"

# 6. Jetson 功耗与性能提升 (若处于 Jetson 环境)
echo ""
echo "[5/5] 正在优化 Jetson 时钟频率..."
if command -v jetson_clocks &> /dev/null; then
    sudo jetson_clocks || true
    echo "✓ 已锁定 Jetson 满血频率运行 (jetson_clocks)"
else
    echo "提示: 当前未运行在原生 Jetson 操作系统或未找到 jetson_clocks，跳过此步。"
fi

echo ""
echo "=================================================================="
echo "🎉 环境配置全部就绪！"
echo ""
echo "👉 硬件诊断步骤:"
echo "   1. 检查串口与舵机连通性:   python3 test_arm_port.py"
echo "   2. 检查手眼摄像头分辨率:   python3 test_camera.py"
echo ""
echo "👉 开始执行自主抓取:"
echo "   抓纸巾:  python3 eval_so101.py --task tissue --port /dev/ttyACM0 --camera-index 0"
echo "   抓眼罩:  python3 eval_so101.py --task eyemask --port /dev/ttyACM0 --camera-index 0"
echo "   无界面:  加上 --no-display 参数"
echo "=================================================================="
