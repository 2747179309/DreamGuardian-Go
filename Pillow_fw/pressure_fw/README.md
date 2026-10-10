# DreamGuardian 智能枕头 —— ESP 固件（pressure_fw）

ESP32-S3 端固件：采集 6 路压力 + 1 路脑电波，通过 WiFi 上报到 Jetson NX，
并作为 BLE Central 直连电极按摩贴片、GPIO 驱动震动模块。

---

## 1. 硬件与工具链

| 项 | 值 |
|---|---|
| 开发板 | ESP32-S3（16MB flash，USB-Serial/JTAG，串口 COM3） |
| ESP-IDF | v5.5.4（`D:\Downloads\Espressif\esp-idf-v5.5.4`） |
| 压力传感器 | FSR406B × 6，接 ADC1（12bit，0~4095） |
| 脑电芯片 | ADS1120（16-bit Δ-Σ ADC），SPI 接口，差分输入 128 倍增益 |
| 震动模块 | 直流电机，PNP 三极管 C9012 驱动，GPIO17 |
| 电极按摩贴片 | BLE 从机，MAC `EC:23:09:15:EB:BE` |

---

## 2. 引脚表

### 压力（ADC1，避开 boot / strapping / USB）

| 传感器 | GPIO | ADC 通道 |
|---|---|---|
| 传感器 1（右下） | GPIO1 | ADC1_CH0 |
| 传感器 2（中下） | GPIO2 | ADC1_CH1 |
| 传感器 3（左下） | GPIO4 | ADC1_CH3 |
| 传感器 4（右上） | GPIO5 | ADC1_CH4 |
| 传感器 5（左上） | GPIO6 | ADC1_CH5 |
| 传感器 6（中上） | GPIO7 | ADC1_CH6 |
| 脑电波（GPIO8 单线） | GPIO8 | ADC1_CH7 |

### ADS1120（SPI，FSPI 主机）

| 信号 | GPIO |
|---|---|
| CS | GPIO10（FSPICS0） |
| MOSI（DIN） | GPIO11 |
| SCLK（CLK） | GPIO12 |
| MISO（DOUT/DRDY） | GPIO13 |

### 震动模块

| 信号 | GPIO |
|---|---|
| 控制脚（PNP 基极，经 1kΩ） | GPIO17 |

PNP 三极管接线：E 接 3.3V，C 接电机红线（电机黑线接 GND），B 经 1kΩ 接 GPIO17。
**低电平导通**（GPIO17=0 → 震动），高电平截止（默认关）。

---

## 3. 压力点顺序（重要）

实机布局（2026-10-10 调整后）：

|      | 左  | 中  | 右  |
|------|-----|-----|-----|
| 上排（头部区） | P5 | P6 | P4 |
| 下排（颈部区） | P3 | P2 | P1 |

固件内部 `s_values[]` 下标 = 传感器号 − 1（见上表）。
上报到 NX 的 `pressure_zones` 数组顺序由 `s_zone_idx[6] = {4,5,3,2,1,0}` 决定，
即数组下标 0..5 依次对应：**P5、P6、P4、P3、P2、P1**。

> PC 网页 `pressure_monitor/index.html` 里的 `POS` / `PILLOW_ORDER` / `estimatePose`
> 必须和上表一致，否则热力图和睡姿判断会错位。

> 这是为了把散落的物理走线按“上排左中右、下排左中右”整理成 NX 期望的固定顺序。
> 数值是 ADC 原始码（去噪后），非 0~100 归一化，见「单位换算」。

---

## 4. 脑电采样

- 芯片：ADS1120，差分 MUX=AIN0/AIN1，GAIN=128（PGA 自动启用）。
- 内部基准：2.048V；满量程 ±16mV。
- 固件实际采样率：**100 Hz**（`EEG_SAMPLE_DELAY_MS = 10`，芯片内部转换速率 330SPS，固件每 10ms 读一次）。
- 通道名：`Fp1`（单通道差分）。

### 单位换算

- 上报 `unit = "adc_count"`（ADC 原始 16-bit 补码），不伪装成 uV。
- `scale_uv_per_count = 0.488`：`1 LSB = 2.048V / 2^15 / 128 ≈ 0.488 µV`。
- NX 若需 µV：`uv = adc_count × 0.488`。

### FFT 五频段算法（ESP 端固定算法）

- 采样率 100Hz，FFT 256 点，Hann 窗，步进 128 点（50% 重叠）。
- 分辨率 `100/256 ≈ 0.390625 Hz`，每 128 点（约 1.28s）更新一次 bands。
- 流程：先去直流（减均值）→ 乘 Hann 窗 → radix-2 FFT → 累加幅值平方得功率谱。
- 频段半开区间：`delta [0.5,4)`、`theta [4,8)`、`alpha [8,13)`、`beta [13,30)`、`gamma [30,45]` Hz。
- 相对功率 = 各频段功率 / (0.5~45Hz 总功率)，五者之和 ≈ 1。
- 总功率过低（<1e-6）判定无有效脑电，`bands` 五个全传 `null`，不伪造。

---

## 5. BLE 电极按摩贴片

| 项 | 值 |
|---|---|
| MAC | `EC:23:09:15:EB:BE`（Public） |
| 服务 | `FFF0` |
| 写控制 | `FFF2`（Write，帧 `5A CMD P1 P2 P3 A5`） |
| 收 ACK/状态 | `FFF1`（Notify） |
| 强度档位 | 1 ~ 5（厂商原始档，不换算医疗剂量） |

强度档 → 协议值映射 `s_level_map[6] = {0, 0x01, 0x01, 0x03, 0x05, 0x06}`。
固件**只复现已实机验证的命令**，不枚举未知强度，不突破 1~5 档。

---

## 6. 上报协议（NX，最终定稿：只两条 POST）

> `/api/pillow/waveform` 方案**已作废**，本固件不实现该路由。

### A. 枕头低频状态 `POST {NX}/api/pillow/telemetry`（每 500ms，2Hz）

```json
{
  "device_id": "pillow-esp-01",
  "seq": 12345,
  "pressure_zones": [21, 46, 30, 18, 42, 25],
  "pressure_contact": 0.73,
  "pressure_change": 0.04,
  "imu_motion": null,
  "temperature_c": null,
  "humidity_pct": null,
  "vibration_feedback": 0.0
}
```

- `pressure_zones`：6 点固定顺序（上排 P1/P2/P3、下排 P4/P5/P6，由 `s_zone_idx` 整理），
  ADC 原始码去噪后，非 0~100 归一化（见下「单位换算」）。非空、有限数字，否则 NX 返 422。
- `vibration_feedback`：实际输出（`s_vib_enabled` 真实电平），不是期望命令；开=1.0 关=0.0。
- `imu_motion` / `temperature_c` / `humidity_pct`：未接对应硬件，固定 `null`。

### B. 脑电接口 `POST {NX}/api/esp/telemetry`（每 500ms，2Hz）

```json
{
  "device_id": "pillow-esp-01",
  "seq": 8801,
  "uptime_ms": 123456,
  "eeg": {
    "sample_rate_hz": 100,
    "raw_samples": [12, -34, 56, ...],      /* 50 点，最新连续 50 点 */
    "unit": "adc_count",
    "signal_quality": 0.0,                   /* 0~100，无接触时 null */
    "contact": true,
    "bands": { "delta":0.42, "theta":0.24, "alpha":0.18, "beta":0.12, "gamma":0.04 }
  },
  "metrics": {
    "vibration_enabled": 0,
    "vibration_level_pct": 0,
    "electrode_ble_connected": 0,
    "electrode_enabled": 0,
    "electrode_intensity_level": 0,
    "eeg_scale_uv_per_count": 0.488
  }
}
```

- `raw_samples`：ADC 原始 16-bit 补码（`unit="adc_count"`），不伪装成 µV。50 点 = 100Hz 下 500ms。
- `bands`：ESP 端计算的**五频段相对功率**（0~1，五者之和 ≈ 1）。无可靠值（接触丢失/总功率过低）时五个全传 `null`。
- `metrics`：震动/电极贴片的真实连接与工作状态（BLE 连接、贴片使能、强度档、实际电平）。

### 发送周期与缓冲

- 两个接口都每 500ms 一包。脑电每包取环形缓冲最新连续 50 点。
- EEG 环形缓冲 256 点（100Hz 下约 2.56s），离线保留最近 2 秒，满后丢最旧并累计丢样。
- 状态帧离线只留最新一帧，不积压旧状态；恢复后不补发整段陈旧波形。
- HTTP 超时连接 1s / 总 2s；失败指数退避 1→2→4→8→10s，成功即恢复正常周期。
- 任一接口失败不影响采样与其他模块；不因 404/断网重启、不阻塞 ADC/EEG。

### 真实状态 vs 命令回显

`enabled`/`level`/`last_ack`/`vibration_feedback` 全部来自设备真实回执（BLE ACK / GPIO 实际电平），
不是“最后发送的命令”。按摩贴片断联时强制 `enabled=false`、`last_ack="ble_disconnected"`。

---

## 7. 尚未接通 / 只能传 null 的字段

不伪造数据，以下字段固定传 `null`：

| 字段 | 原因 |
|---|---|
| `imu_motion` | 未接 IMU |
| `temperature_c` / `humidity_pct` | 未接温湿度传感器 |
| `eeg.signal_quality`（接触丢失时） | 未贴/悬空，无法评估 |
| `eeg.bands.*`（无有效脑电时） | 总功率过低或接触丢失，五个全 null |

### contact / signal_quality 算法

对每批 16 点（160ms）算峰峰值 `pp`（adc_count）：

- `pp >= 40000` → `contact=false`、`signal_quality=0`（悬空/未贴，满偏乱跳）。
- 否则 `contact=true`，`signal_quality = clamp(1 − pp/40000, 0.3, 1.0) × 100`（0~100）。

`contact` 依赖 `ads_ready`（ADS1120 寄存器回读正常）。

---

## 8. 配置方法

所有可配置项集中在 **`main/app_config.h`**（改完重编译即可，无需 menuconfig）：

```c
#define CONFIG_NX_HOST       "10.34.179.161"
#define CONFIG_NX_PORT       "8000"
#define CONFIG_WIFI_SSID     "REDMI K90"
#define CONFIG_WIFI_PASS     "7951712Wy"
#define CONFIG_DEVICE_ID     "pillow-esp-01"
#define CONFIG_ENABLE_EEG_UPLOAD 1   /* /api/esp/telemetry 未上线时可设 0 */
```

> `NX_HOST` / `NX_PORT` 拆开可配置。现场同一局域网后确认最新地址再改这里重编译。
> 不要因 ping 不通自行改 API 路径；接口路径固定为 `/api/pillow/telemetry` 和 `/api/esp/telemetry`。

> 注意：本文件含 WiFi 凭据，**不要提交到公开仓库**。仓库里不写死密码/令牌。

---

## 9. 编译与烧录

### 编译

```bat
D:\Downloads\Espressif\build_pressure.bat
```

（脚本内部：`set-target esp32s3` + `build`，产物在 `D:\Downloads\Espressif\build\pressure_fw`）

### 烧录（COM3）

```bat
cd /d D:\Downloads\Espressif\esp-idf-v5.5.4
call export.bat
python tools\idf.py -B D:\Downloads\Espressif\build\pressure_fw -p COM3 flash
```

或指定下载串口监视日志：

```bat
python tools\idf.py -B D:\Downloads\Espressif\build\pressure_fw -p COM3 monitor
```

### 分区表

默认 ESP-IDF 单应用分区表（`partition_singleapp.csv`，16MB flash），未自定义分区。

---

## 10. 串口命令（USB Serial/JTAG，115200）

```
level <1-5>   调按摩贴片档位
start         按摩贴片开始
stop          按摩贴片停止
connect       手动重连贴片
status        查看 BLE 状态
vib on        震动开
vib off       震动关
help          帮助
```

压力原始数据由 `sample_task` 以 10Hz 打印（6 路压力 + 3 列占位）；
脑电批以 `E` 前缀每 160ms 打印一批（16 点，供 PC 网页 FFT），不逐点刷屏。

---

## 11. 串口日志

- 启动：固件版本、device_id、NX 地址（HOST:PORT）、ADS1120 就绪状态、真实 EEG 采样率与通道名。
- 每 10 秒汇总：`pillow_ok/fail`、`esp_ok/fail`、最后 HTTP 码、EEG 缓冲累计点数、丢样数、BLE 重连次数、剩余堆。
- 状态变化即时记录：WiFi 连接/断开、贴片连接/断开/接触丢失、按摩贴片回执、故障码。
- 不打印 WiFi 密码/令牌。
