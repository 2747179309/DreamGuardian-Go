# 当前网页接口契约

所有路径均与网页同源，生产页面不写死 NX IP。

## 实时汇总

- `GET /api/live`：返回最新汇总快照。
- `WS /ws/live`：推送与 `/api/live` 相同的结构。

主要顶层字段：

- `sample`：GD 心率、呼吸、体动、睡眠阶段、守护与干预。
- `model`：NX 异常觉醒风险模型。
- `voice_state`、`voice_event`：小梦语音状态。
- `pillow`：六点压力、温湿度、IMU 和震动反馈。
- `esp`：EEG 原始波形、五频段和 ESP 扩展指标。
- `snore`：NX 鼾声检测。
- `sleep_guide`：自动引导状态和本次睡眠计时。

页面认为 `pillow`/`esp` 在 `stale=true` 或超过5秒未更新时已过期，不能当作实时数据。

## 智能枕头上报

`POST /api/pillow/telemetry`

```json
{
  "device_id": "pillow-esp-01",
  "seq": 123,
  "pressure_zones": [12, 35, 18, 8, 42, 20],
  "pressure_contact": 0.45,
  "pressure_change": 0.03,
  "imu_motion": null,
  "temperature_c": null,
  "humidity_pct": null,
  "vibration_feedback": 0
}
```

`pressure_zones` 顺序为上排 P1～P3、下排 P4～P6。网页期望0～100；当前绘图层会将
超出范围的数值截断，但接口/设备应完成正确标定。

## ESP EEG 上报

`POST /api/esp/telemetry`

```json
{
  "device_id": "pillow-esp-01",
  "seq": 456,
  "uptime_ms": 380000,
  "eeg": {
    "sample_rate_hz": 100,
    "raw_samples": [3.2, 4.1, 2.8, -0.5],
    "unit": "uV",
    "signal_quality": 91,
    "contact": true,
    "bands": {
      "delta": 0.42,
      "theta": 0.24,
      "alpha": 0.18,
      "beta": 0.12,
      "gamma": 0.04
    }
  },
  "metrics": {
    "vibration_enabled": 0,
    "vibration_level_pct": 0,
    "electrode_ble_connected": 1,
    "electrode_enabled": 0,
    "electrode_intensity_level": 0,
    "eeg_scale_uv_per_count": 0.488
  }
}
```

`raw_samples` 是最多512点的一维数组。`signal_quality` 为0～100。贴片无效时允许
`contact=false`、质量和五频段为 `null`；网页仍可标记原始数据状态，但不能把无效波形
解释为有效脑电结果。

## 自动睡前引导

- `GET /api/sleep-guide/auto`
- `POST /api/sleep-guide/auto`，请求体：`{"enabled":true}`

## 历史和系统

- `GET /api/history?minutes=480`
- `GET /api/events`
- `GET /api/sleep/latest`
- `GET /api/nx/telemetry`
- `GET /health`

## 当前尚未实现的网页预留接口

以下接口在当前 NX 后端返回404，页面必须保持禁用/等待状态，不能假装执行成功：

- `/api/control/state`、`/api/control`
- `/api/ai/capabilities`、`/api/ai/query`
- `/api/sleep/sessions`、`/api/sleep/reports/{id}`

NX 已有 `/api/device/command` 用于白名单转发 GD 命令，但它不是 ESP 震动/电极控制接口。
目前 ESP 的 `metrics` 仅为状态上报，网页没有反向控制 ESP 的能力。
