# DreamGuardian Go 固件复刻指南

本目录是 2026-10-10 从本地 dreamguardian2 整理出的独立固件快照。主程序为 main/app_main.c。项目仍使用 dreamguardian2 作为 ESP-IDF 工程名，因此构建结果名为 dreamguardian2.bin。

## 范围和硬件

本次提交覆盖床头 DG 固件：LD6002 雷达、睡眠状态估计、助眠和干预、屏幕、唤醒、在线 ASR、NX 对话接口及配置页面。枕头采集 ESP、NX 模型服务、网页数字孪生和机械臂程序不包含在这份源码中，不应把此工程刷到枕头 ESP 上。

当前 BSP 为 ESP32-S3-BOX-3，配置为 16 MB Flash、八线 PSRAM。接线、雷达供电和外接 I2S 扬声器见 HARDWARE_WIRING.md。普通 ESP32-S3 开发板不能仅凭芯片型号相同直接替换 BOX-3。

## 环境和编译

安装 Espressif 官方 ESP-IDF v5.5.4，执行其 export 脚本激活环境。Windows 可在 ESP-IDF PowerShell 中运行；Linux/macOS 可运行 `. /path/to/esp-idf/export.sh`。

```powershell
cd "D:\your-path\DreamGuardian Go"
idf.py --version
idf.py -B build reconfigure
idf.py -B build build
```

保留本仓库的 sdkconfig，避免 set-target 清除已验证配置。sdkconfig.defaults 是基础配置，sdkconfig 是本次完整配置快照。dependencies.lock 固定组件版本；managed_components 保留当前实际使用的依赖和本地修正，避免自动下载的新副本丢失行为差异。第三方许可保留在各组件目录中。

路径含空格时须加引号。如工具链无法处理路径，可将仓库克隆到 D:\DreamGuardian-Go 等无空格路径。

## 首次烧录

先使用设备管理器或 `python -m serial.tools.list_ports -v` 确认目标板端口。以下 COMx 必须替换为实际端口，不能照抄历史 COM 编号。

```powershell
idf.py -B build -p COMx flash monitor
```

首次复刻必须完整 flash，包含应用、分区表、SPIFFS 音频和语音模型分区；只写应用无法建立完整运行环境。Ctrl+] 退出监视。

## 配网与 NX

连接设备热点 DreamGuardian-Control（默认密码 dream1234），打开 http://192.168.4.1/provision，填写自己的 Wi-Fi。取得局域网地址后访问设备 /claw 配置页，设置自己的兼容 OpenAI 的 NX 网关地址、模型和认证信息；ASR 服务也需要独立配置。NX 服务和外部 ASR 并不包含在本工程中。

实际 Wi-Fi、云服务密钥和运行令牌保存在设备 NVS，不包含在仓库中。飞书桥接可选，依赖见 tools/requirements.txt；将示例 JSON 复制为 tools/feishu_bridge_config.json 后填写个人配置，该文件被 Git 忽略。

## 本次离床修正

有效无人报告持续 30 秒才确认离床；数据过期会中断确认计时。此前确认在床的用户在信号丢失期间保留占用状态，评估显示 unknown，并提示信号恢复。新鲜的心率或呼吸可维持在床判断。起夜触发还经过约 1 秒下游确认。此逻辑不是医疗诊断。

## 资源与验证

spiffs/ 包含构建实际使用的 WAV 和唤醒模板。当前配置使用 ESP-SR 内置 WakeNet；custom_wakenet/ 中只有说明，没有“Hi 小梦”专用训练模型，不能声称该模型已随仓库提供。

建议依次检查启动、配网、雷达数据、助眠播放、语音往返、翻身不误触发离床、真实离床约 30 秒触发起夜以及回床恢复，最后做整夜测试。睡眠流程参考 SLEEP_FLOW.md。

本地来源固件已完成增量编译、应用分区容量检查和 COM9 烧录校验；独立整理目录的验证见提交说明，不将语法检查等同于整夜实测。

## 第三方与音频

组件自带许可证保留原文。仓库未额外为全部内容授予统一开源许可证；音频及 wake_xm.tmpl 的原创性、来源和再分发许可需由维护者补充确认，商业复用前应分别核对。当前整理保留这些运行必需资源以复现设备行为。
