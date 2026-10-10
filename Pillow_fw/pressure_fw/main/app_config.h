#pragma once
/* ============================================================
 * DreamGuardian 智能枕头 —— 集中配置（配置头文件方案）
 * 改这里然后重编译即可，不用进 menuconfig。
 * 注意：本文件含 WiFi 凭据，别提交到公开仓库。
 * ============================================================ */

/* ---- NX 服务地址（现场联调改这里，NX_HOST / NX_PORT 可配置）---- */
#define CONFIG_NX_HOST "10.34.179.161"
#define CONFIG_NX_PORT "8000"
#define CONFIG_NX_BASE_URL "http://" CONFIG_NX_HOST ":" CONFIG_NX_PORT

/* ---- WiFi ---- */
#define CONFIG_WIFI_SSID   "REDMI K90"
#define CONFIG_WIFI_PASS   "7951712Wy"

/* ---- 设备编号（稳定唯一，不随重启变化）---- */
#define CONFIG_DEVICE_ID   "pillow-esp-01"

/* ---- 脑电上传开关（/api/esp/telemetry 未上线时设 0）---- */
#define CONFIG_ENABLE_EEG_UPLOAD 1
