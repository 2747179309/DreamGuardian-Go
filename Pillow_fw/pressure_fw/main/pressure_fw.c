/*
 * pressure_fw - ESP32-S3 合并版固件（DreamGuardian 智能枕头）
 *
 * 同时干四件事（不再需要双分区切换）：
 *   1. 6 路压力 + 1 路脑电波 ADC 采样 10Hz，串口打印原始数据。
 *   2. 压力：每 500ms 打包 JSON POST 到 NX 的 /api/pillow/telemetry。
 *   3. 脑电：ADS1120 差分 100Hz 连续采样，环形缓冲 + 256 点 FFT 五频段，
 *      每 500ms 打包 POST 到 NX 的 /api/esp/telemetry（含 50 点原始波形 + bands）。
 *   4. BLE Central 直连按摩贴片 + GPIO 驱动震动模块。
 *
 * 串口命令（USB Serial/JTAG）：
 *   level <1-5>   调档
 *   start         开始
 *   stop          停止
 *   connect       手动重连按摩贴片
 *   status        查看 BLE 连接状态
 *   vib on/off    震动开关
 *   help          帮助
 *
 * 引脚分配：
 *   压力 ADC1：GPIO1(CH0) GPIO2(CH1) GPIO4(CH3) GPIO5(CH4) GPIO6(CH5) GPIO7(CH6)
 *   脑电：GPIO8(CH7) 单模拟线（供旧网页）；高精度脑电走 ADS1120 差分
 *   ADS1120 SPI：CS=GPIO10 MOSI=GPIO11 SCLK=GPIO12 MISO=GPIO13
 *   震动：GPIO17（PNP 三极管，低电平导通）
 */

#include <stdio.h>
#include <string.h>
#include <math.h>
#include <stdbool.h>
#include <inttypes.h>
#include <stdlib.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_err.h"
#include "esp_http_client.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "cJSON.h"
#include "nvs_flash.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_gap_ble_api.h"
#include "esp_gattc_api.h"
#include "esp_gatt_defs.h"
#include "esp_gatt_common_api.h"
#include "driver/spi_master.h"
#include "driver/gpio.h"
#include "app_config.h"
#include "esp_timer.h"
#include "esp_system.h"

/* ================= 压力采样 ================= */
#define N_CH 6
#define EEG_CH ADC_CHANNEL_7     /* 脑电波 -> GPIO8 */

#define SAMPLE_INTERVAL_MS 100   /* ADC 采样周期（10Hz） */
#define UPLOAD_INTERVAL_MS 500   /* 上传周期（2Hz） */

#define NX_PILLOW_URL CONFIG_NX_BASE_URL "/api/pillow/telemetry"
#define NX_ESP_URL    CONFIG_NX_BASE_URL "/api/esp/telemetry"

#define NOISE               250.0f   /* 低于此值视为无压力（悬空噪声约 200） */
#define CONTACT_FULL_SCALE  12000.0f /* 6 路去噪总和"强接触"满量程 */
#define CHANGE_FULL_SCALE   4000.0f  /* 短时变化量"剧烈"满量程 */

/* ================= 按摩仪 BLE ================= */
#define MASSAGE_TARGET_MAC    "EC:23:09:15:EB:BE"
#define MASSAGE_ADDR_TYPE     BLE_ADDR_TYPE_PUBLIC

#define SRV_UUID16            0xFFF0
#define CHAR_TX_UUID16        0xFFF2   /* 写控制命令 */
#define CHAR_RX_UUID16        0xFFF1   /* Notify 收 ACK/状态 */

#define FRAME_HEAD            0x5A
#define FRAME_TAIL            0xA5
#define CMD_INTENSITY         0x40
#define CMD_START             0x3A
#define CMD_STOP              0x38
#define CMD_ACK               0xC0

#define ACK_BIT               (1 << 0)
#define ACK_TIMEOUT_MS        2000

/* ================= ADS1120 SPI ADC ================= */
#define ADS1120_CS     10   /* FSPICS0 */
#define ADS1120_MOSI   11   /* FSPID  (DIN) */
#define ADS1120_SCLK   12   /* FSPICLK */
#define ADS1120_MISO   13   /* FSPIQ  (DOUT/DRDY) */

#define ADS1120_MUX_DIFF   0x00  /* 差分 AINP=AIN0, AINN=AIN1 */
#define ADS1120_GAIN_32    0x05  /* GAIN[2:0]=101 -> 32 倍（EEG 用，防工频饱和） */

#define EEG_BATCH 16           /* 串口每批点数：100Hz 下 160ms 发一批（网页 FFT） */
#define EEG_SAMPLE_DELAY_MS 10 /* ADS1120 采样间隔 -> 100Hz */

#define VIB_GPIO  17           /* 震动模块1控制脚（PNP 三极管：低电平导通） */
#define VIB_GPIO2 40           /* 震动模块2控制脚（PNP 三极管：低电平导通） */

/* ================= 震动触发引擎（梦魇/睡眠不佳 -> 交替震动） ================= */
#define TRIGGER_HIST_SIZE   120     /* 保存 60s 的 pressure_change（2Hz） */
#define TRIGGER_ACT_THRESH  0.30f   /* 明显动作：change >= 0.30 */
#define TRIGGER_VIOL_THRESH 0.50f   /* 剧烈动作：change >= 0.50 */
#define TRIGGER_POOR_ACTS   15      /* 60s 内明显动作 >= 15 次 -> 不佳 */
#define TRIGGER_POOR_AVG    0.15f   /* 或 60s 平均 change >= 0.15 */
#define TRIGGER_NIGHT_VIOL  4       /* 10s 内剧烈动作 >= 4 次 */
#define TRIGGER_NIGHT_PEAK  0.50f   /* 且峰值 >= 0.50 */
#define TRIGGER_POOR_LIMIT  3       /* 睡眠不佳累计 3 次触发震动 */
#define TRIGGER_DURATION_MS 10000   /* 交替震动总时长 10s */
#define TRIGGER_ALT_MS      500     /* 17/40 交替 0.5s */
#define TRIGGER_COOLDOWN_MS 30000   /* 触发后冷却 30s */
#define TRIGGER_HTTP_PORT   8001    /* NX 控制 ESP 的 HTTP 服务端口 */

/* ================= EEG 环形缓冲 + FFT ================= */
#define EEG_RING_SIZE 256      /* 环形缓冲点数：100Hz 下约 2.56s（离线保留 2 秒） */
#define ESP_BATCH     50       /* 每包原始波形点数：100Hz 下 500ms */
#define FFT_N         256      /* FFT 点数 */
#define FFT_HOP       128      /* 步进（50% 重叠），约 1.28s 更新一次 bands */
#define LEAD_OFF_PP   40000    /* 峰峰值阈值（adc_count）：超过视为悬空/未贴 */
#define UV_PER_COUNT  1.953f   /* 1 LSB ≈ 1.953uV（内部 2.048V 基准 / 32 倍） */

static const char *TAG = "pillow";
static const char *TAG_MASSAGE = "MASSAGE";

/* ---------- 压力状态 ---------- */
static const adc_channel_t s_chans[N_CH] = {
    ADC_CHANNEL_0, /* 传感器1 GPIO1 右下 */
    ADC_CHANNEL_1, /* 传感器2 GPIO2 中下 */
    ADC_CHANNEL_3, /* 传感器3 GPIO4 左下 */
    ADC_CHANNEL_4, /* 传感器4 GPIO5 右上 */
    ADC_CHANNEL_5, /* 传感器5 GPIO6 左上 */
    ADC_CHANNEL_6, /* 传感器6 GPIO7 中上 */
};

/* pressure_zones 输出顺序：上排 5,6,4 / 下排 3,2,1（v[] 下标 = 传感器号-1） */
static const int s_zone_idx[N_CH] = { 4, 5, 3, 2, 1, 0 };

static adc_oneshot_unit_handle_t s_adc1 = NULL;
static volatile bool s_wifi_connected = false;
static uint32_t s_seq = 0;
static int s_values[N_CH] = {0};   /* 去噪后的压力值（上传/接触判断用） */
static int s_raw[N_CH] = {0};      /* 原始 ADC 读数（触发引擎算 change 用） */
static float s_ema[N_CH] = {0};
static bool s_ema_init = false;
static int s_eeg = 0;
static float s_eeg_ema = 0;

/* ---------- EEG 环形缓冲 + FFT 状态 ---------- */
static int16_t s_eeg_ring[EEG_RING_SIZE];
static volatile uint32_t s_eeg_ring_count = 0;  /* 累计写入点数（取模定位） */
static volatile uint32_t s_eeg_dropped = 0;     /* 缓冲覆盖导致的丢样累计 */
static volatile bool s_ads_ready = false;
static volatile bool s_eeg_contact = false;
static volatile float s_eeg_signal_quality = 0; /* 0~100 */
static int16_t s_fft_buf[FFT_N];                /* FFT 滚动窗口（256 点） */
static int s_fft_filled = 0;                    /* 已填充点数 */
static volatile bool s_bands_valid = false;
static volatile float s_band_delta = 0;
static volatile float s_band_theta = 0;
static volatile float s_band_alpha = 0;
static volatile float s_band_beta = 0;
static volatile float s_band_gamma = 0;

/* ---------- 震动 / 按摩贴片真实状态 ---------- */
static volatile bool s_vib_enabled = false;   /* 震动1 (GPIO17) */
static volatile bool s_vib_enabled2 = false;  /* 震动2 (GPIO40) */
static volatile bool s_massage_on = false;
static volatile uint8_t s_cur_level = 0;
static volatile const char *s_last_ack = "idle";

/* ---------- 震动触发引擎状态 ---------- */
static float s_change_hist[TRIGGER_HIST_SIZE];
static int s_change_idx = 0;
static int s_change_cnt = 0;
static int64_t s_cooldown_until = 0;         /* esp_timer 微秒 */
static int s_poor_trigger_cnt = 0;           /* 睡眠不佳累计触发次数 */
static bool s_prev_poor = false;
static volatile bool s_trigger_auto = true;  /* 自动触发开关（NX 可关） */
static volatile bool s_trigger_vibrating = false;
static volatile const char *s_trigger_event = "none"; /* 最近触发事件 */
static volatile uint32_t s_trigger_count = 0;         /* 累计触发次数（日志用） */

/* ---------- 上传统计（10 秒汇总用） ---------- */
static volatile uint32_t s_pillow_ok = 0;
static volatile uint32_t s_pillow_fail = 0;
static volatile uint32_t s_esp_ok = 0;
static volatile uint32_t s_esp_fail = 0;
static volatile int s_last_http_code = 0;
static volatile uint32_t s_ble_reconnects = 0;

/* ---------- 按摩贴片 BLE 状态 ---------- */
static esp_gatt_if_t s_gattc_if = ESP_GATT_IF_NONE;
static uint16_t s_conn_id = 0;
static uint16_t s_svc_start = 0;
static uint16_t s_svc_end = 0;
static uint16_t s_fff1_handle = 0;   /* notify */
static uint16_t s_fff2_handle = 0;   /* write  */
static volatile bool s_connected = false;
static volatile bool s_ready = false;
static uint8_t s_pending_cmd = 0;
static EventGroupHandle_t s_ack_evt = NULL;

/* 1~5 档 -> 协议值（整体降一档：原映射 1,3,5,6,7 → 1,1,3,5,6，最高档从 7 降到 6） */
static const uint8_t s_level_map[6] = {0, 0x01, 0x01, 0x03, 0x05, 0x06};

static esp_bt_uuid_t s_srv_uuid = {
    .len = ESP_UUID_LEN_16,
    .uuid = {.uuid16 = SRV_UUID16},
};

/* ---------- ADS1120 状态 ---------- */
static spi_device_handle_t s_ads_spi = NULL;

/* ---------------- ADS1120 SPI ADC ---------------- */

static void ads1120_transfer(const uint8_t *tx, uint8_t *rx, size_t len)
{
    spi_transaction_t t = {0};
    t.length = len * 8;
    t.tx_buffer = tx;
    t.rx_buffer = rx;
    esp_err_t err = spi_device_transmit(s_ads_spi, &t);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "ads1120 spi err: %s", esp_err_to_name(err));
    }
}

static void ads1120_write_reg(uint8_t reg, uint8_t val)
{
    uint8_t tx[2] = {0x40 | (reg << 2), val};
    ads1120_transfer(tx, NULL, 2);
}

static void ads1120_send_cmd(uint8_t cmd)
{
    uint8_t tx[1] = {cmd};
    ads1120_transfer(tx, NULL, 1);
}

static uint8_t ads1120_read_reg(uint8_t reg)
{
    uint8_t tx[2] = {0x20 | (reg << 2), 0x00}; /* RREG + 1 dummy */
    uint8_t rx[2] = {0};
    ads1120_transfer(tx, rx, 2);
    return rx[1];
}

static int16_t ads1120_read_data(void)
{
    uint8_t tx[3] = {0x10, 0x00, 0x00}; /* RDATA + 2 dummy */
    uint8_t rx[3] = {0};
    ads1120_transfer(tx, rx, 3);
    return (int16_t)((rx[1] << 8) | rx[2]);
}

static int16_t ads1120_read_channel(uint8_t mux, uint8_t gain)
{
    /* MUX[3:0] | GAIN[2:0]<<1 | PGA_BYPASS(0)。增益>=8 时 PGA 自动启用 */
    uint8_t cfg = (uint8_t)((mux << 4) | ((gain & 0x07) << 1));
    ads1120_write_reg(0x00, cfg);
    ads1120_send_cmd(0x08);        /* START/SYNC，单次转换 */
    vTaskDelay(pdMS_TO_TICKS(EEG_SAMPLE_DELAY_MS));  /* 100Hz 采样 */
    return ads1120_read_data();
}

static void ads1120_init(void)
{
    spi_bus_config_t bus = {
        .mosi_io_num = ADS1120_MOSI,
        .miso_io_num = ADS1120_MISO,
        .sclk_io_num = ADS1120_SCLK,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 32,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_DISABLED));

    spi_device_interface_config_t dev = {
        .clock_speed_hz = 1000000,  /* 1 MHz */
        .mode = 1,                  /* CPOL=0, CPHA=1 */
        .spics_io_num = ADS1120_CS,
        .queue_size = 1,
    };
    ESP_ERROR_CHECK(spi_bus_add_device(SPI2_HOST, &dev, &s_ads_spi));

    /* 复位 + 配置 */
    ads1120_send_cmd(0x06);        /* RESET */
    vTaskDelay(pdMS_TO_TICKS(20));
    ads1120_write_reg(0x01, 0x80); /* DR=330SPS(100), MODE=Normal(00), CM=单次 */
    ads1120_write_reg(0x02, 0x00); /* 内部 2.048V 基准 */
    ads1120_write_reg(0x03, 0x00); /* IDAC 不用，默认 */

    /* 回读寄存器，确认芯片响应（接错线/供电不足时读回 00） */
    uint8_t r0 = ads1120_read_reg(0x00);
    uint8_t r1 = ads1120_read_reg(0x01);
    s_ads_ready = (r0 != 0x00 || r1 != 0x00);
    ESP_LOGI(TAG, "ADS1120 ready=%d, reg0=%02X reg1=%02X (期望 81 80)", s_ads_ready, r0, r1);
}

/* ---------------- HTTP ---------------- */

static int http_post_json(const char *url, const char *body)
{
    esp_http_client_config_t cfg = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 2000,
    };
    esp_http_client_handle_t client = esp_http_client_init(&cfg);
    if (!client) {
        ESP_LOGE(TAG, "http client init failed");
        return 0;
    }
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_err_t err = esp_http_client_set_post_field(client, body, strlen(body));
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "set_post_field failed: %s", esp_err_to_name(err));
        esp_http_client_cleanup(client);
        return 0;
    }
    err = esp_http_client_perform(client);
    int code = esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "POST fail: %s", esp_err_to_name(err));
        return 0;   /* 0 = 网络错误 */
    }
    if (code < 200 || code >= 300) {
        ESP_LOGW(TAG, "POST HTTP %d", code);
        return code;
    }
    return code;
}

/* ---------------- FFT（radix-2，实数输入） ---------------- */

#define FFT_PI 3.14159265358979f

static void fft_radix2(float *re, float *im, int n)
{
    for (int i = 1, j = 0; i < n; i++) {
        int bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            float tr = re[i], ti = im[i];
            re[i] = re[j]; im[i] = im[j];
            re[j] = tr; im[j] = ti;
        }
    }
    for (int len = 2; len <= n; len <<= 1) {
        float ang = -2.0f * FFT_PI / len;
        float wr = cosf(ang), wi = sinf(ang);
        for (int i = 0; i < n; i += len) {
            float cr = 1.0f, ci = 0.0f;
            for (int k = 0; k < len / 2; k++) {
                float ur = re[i + k], ui = im[i + k];
                float vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
                float vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
                re[i + k] = ur + vr; im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
                float ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
    }
}

/* 256 点去直流 + Hann 窗 + 功率谱，输出五频段相对功率（0~1）。
 * 频段半开区间：delta[0.5,4) theta[4,8) alpha[8,13) beta[13,30) gamma[30,45]。
 * 总功率过低返回 false（无效，bands 应传 null）。 */
static bool compute_bands(const int16_t *x, float out[5])
{
    static float re[FFT_N], im[FFT_N];
    static float win[FFT_N];
    static bool win_init = false;

    if (!win_init) {
        for (int i = 0; i < FFT_N; i++) {
            win[i] = 0.5f * (1.0f - cosf(2.0f * FFT_PI * i / (FFT_N - 1)));
        }
        win_init = true;
    }

    float mean = 0;
    for (int i = 0; i < FFT_N; i++) mean += x[i];
    mean /= FFT_N;
    for (int i = 0; i < FFT_N; i++) {
        re[i] = (x[i] - mean) * win[i];
        im[i] = 0;
    }
    fft_radix2(re, im, FFT_N);

    float p[5] = {0};
    float total = 0;
    for (int i = 0; i < FFT_N / 2; i++) {
        float freq = i * 100.0f / FFT_N;   /* 采样率 100Hz */
        if (freq < 0.5f) continue;
        if (freq > 45.0f) break;           /* 50Hz 及以上是混叠，不算 */
        float pw = re[i] * re[i] + im[i] * im[i];
        total += pw;
        if (freq < 4.0f) p[0] += pw;       /* delta [0.5,4) */
        else if (freq < 8.0f) p[1] += pw;  /* theta [4,8) */
        else if (freq < 13.0f) p[2] += pw; /* alpha [8,13) */
        else if (freq < 30.0f) p[3] += pw; /* beta  [13,30) */
        else p[4] += pw;                   /* gamma [30,45] */
    }
    if (total < 1e-6f) return false;
    for (int i = 0; i < 5; i++) out[i] = p[i] / total;
    return true;
}

/* ---------------- 震动触发引擎（梦魇/睡眠不佳 -> 17/40 交替震动） ---------------- */

/* 当前 60s 窗内是否"睡眠不佳"：明显动作帧数过多或平均 change 偏高 */
static bool trigger_is_poor(void)
{
    int win = (s_change_cnt < TRIGGER_HIST_SIZE) ? s_change_cnt : TRIGGER_HIST_SIZE;
    if (win < 20) return false;
    int acts = 0;
    float sum = 0;
    for (int i = 0; i < win; i++) {
        int idx = (s_change_idx - 1 - i + TRIGGER_HIST_SIZE * 2) % TRIGGER_HIST_SIZE;
        float c = s_change_hist[idx];
        sum += c;
        if (c >= TRIGGER_ACT_THRESH) acts++;
    }
    float avg = sum / (float)win;
    return (acts >= TRIGGER_POOR_ACTS) || (avg >= TRIGGER_POOR_AVG);
}

/* 当前 10s 窗内是否"梦魇"：剧烈动作帧数足够且峰值够高 */
static bool trigger_is_night(void)
{
    if (s_change_cnt < 20) return false;
    int violent = 0;
    float peak = 0;
    for (int i = 0; i < 20; i++) {   /* 10s @ 2Hz */
        int idx = (s_change_idx - 1 - i + TRIGGER_HIST_SIZE * 2) % TRIGGER_HIST_SIZE;
        float c = s_change_hist[idx];
        if (c >= TRIGGER_VIOL_THRESH) violent++;
        if (c > peak) peak = c;
    }
    return (peak >= TRIGGER_NIGHT_PEAK) && (violent >= TRIGGER_NIGHT_VIOL);
}

/* 交替震动任务：17/40 各 0.5s，共 10s，结束自动关闭并复位状态 */
static void vibrate_alt_task(void *arg)
{
    int steps = TRIGGER_DURATION_MS / TRIGGER_ALT_MS;
    for (int i = 0; i < steps; i++) {
        bool on17 = (i % 2 == 0);
        gpio_set_level(VIB_GPIO,  on17 ? 0 : 1);   /* 低电平导通 */
        gpio_set_level(VIB_GPIO2, on17 ? 1 : 0);
        vTaskDelay(pdMS_TO_TICKS(TRIGGER_ALT_MS));
    }
    gpio_set_level(VIB_GPIO, 1);
    gpio_set_level(VIB_GPIO2, 1);
    s_trigger_vibrating = false;
    ESP_LOGI(TAG, "触发震动结束");
    vTaskDelete(NULL);
}

/* 触发一次交替震动（只碰震动马达 17/40，绝不碰电极贴片） */
static void trigger_fire(const char *reason)
{
    if (s_trigger_vibrating) return;
    s_trigger_vibrating = true;
    s_trigger_event = reason;
    s_trigger_count++;
    ESP_LOGW(TAG, "触发震动: %s（累计第 %" PRIu32 " 次）", reason, s_trigger_count);
    xTaskCreate(vibrate_alt_task, "vib_alt", 2048, NULL, 7, NULL);
}

/* 每 500ms 调一次（upload_task 算完 change 后） */
static void trigger_process(float change)
{
    s_change_hist[s_change_idx] = change;
    s_change_idx = (s_change_idx + 1) % TRIGGER_HIST_SIZE;
    if (s_change_cnt < TRIGGER_HIST_SIZE) s_change_cnt++;

    int64_t now = esp_timer_get_time();
    if (now < s_cooldown_until) return;   /* 冷却中 */
    if (!s_trigger_auto) return;          /* NX 已关闭自动触发 */
    if (s_trigger_vibrating) return;      /* 正在震动 */
    if (s_change_cnt < 20) return;        /* 数据不足（<10s） */

    bool poor = trigger_is_poor();
    bool night = trigger_is_night();

    if (night) {
        trigger_fire("nightmare");
        s_cooldown_until = now + (int64_t)TRIGGER_COOLDOWN_MS * 1000;
        s_poor_trigger_cnt = 0;
    } else if (poor && !s_prev_poor) {
        /* 正常 -> 不佳 的跳变才算 1 次，累计 3 次触发 + 清零 */
        s_poor_trigger_cnt++;
        ESP_LOGI(TAG, "睡眠不佳第 %d/%d 次", s_poor_trigger_cnt, TRIGGER_POOR_LIMIT);
        if (s_poor_trigger_cnt >= TRIGGER_POOR_LIMIT) {
            trigger_fire("poor_sleep_x3");
            s_cooldown_until = now + (int64_t)TRIGGER_COOLDOWN_MS * 1000;
            s_poor_trigger_cnt = 0;
        }
    }
    s_prev_poor = poor;
}

/* ---------------- NX 控制 HTTP 服务（端口 8001） ---------------- */

static esp_err_t trigger_http_handler(httpd_req_t *req)
{
    char buf[128] = {0};
    int len = httpd_req_recv(req, buf, sizeof(buf) - 1);
    if (len < 0) len = 0;
    buf[len] = '\0';

    bool do_now = false;
    cJSON *root = (len > 0) ? cJSON_Parse(buf) : NULL;
    if (root) {
        cJSON *now = cJSON_GetObjectItem(root, "now");
        cJSON *auto_item = cJSON_GetObjectItem(root, "auto");
        if (now && cJSON_IsBool(now) && cJSON_IsTrue(now)) do_now = true;
        if (auto_item && cJSON_IsBool(auto_item)) {
            s_trigger_auto = cJSON_IsTrue(auto_item);
            ESP_LOGI(TAG, "自动触发已%s", s_trigger_auto ? "开启" : "关闭");
        }
        cJSON_Delete(root);
    }

    if (do_now) {
        s_cooldown_until = esp_timer_get_time() + (int64_t)TRIGGER_COOLDOWN_MS * 1000;
        trigger_fire("manual");
    }

    httpd_resp_set_type(req, "application/json");
    httpd_resp_sendstr(req, "{\"ok\":true}");
    return ESP_OK;
}

static httpd_handle_t s_httpd = NULL;

static void trigger_http_start(void)
{
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.server_port = TRIGGER_HTTP_PORT;
    cfg.max_uri_handlers = 4;

    if (httpd_start(&s_httpd, &cfg) != ESP_OK) {
        ESP_LOGE(TAG, "NX 控制服务启动失败（端口 %d）", TRIGGER_HTTP_PORT);
        return;
    }
    httpd_uri_t uri = {
        .uri = "/api/trigger",
        .method = HTTP_POST,
        .handler = trigger_http_handler,
        .user_ctx = NULL,
    };
    httpd_register_uri_handler(s_httpd, &uri);
    ESP_LOGI(TAG, "NX 控制服务已启动 :%d/api/trigger", TRIGGER_HTTP_PORT);
}

/* ---------------- 压力上传任务（2Hz） ---------------- */

static void upload_task(void *arg)
{
    uint32_t backoff_ms = UPLOAD_INTERVAL_MS;

    while (1) {
        /* 触发引擎独立于 WiFi：每 500ms 算一次压力变化，断网也能自动触发震动 */
        int total = 0;
        float change = 0;
        for (int i = 0; i < N_CH; i++) {
            total += s_values[i];
            change += fabsf((float)s_raw[i] - s_ema[i]);
        }
        float contact = (float)total / CONTACT_FULL_SCALE;
        if (contact > 1.0f) contact = 1.0f;
        change /= CHANGE_FULL_SCALE;
        if (change > 1.0f) change = 1.0f;

        trigger_process(change);

        if (s_wifi_connected) {
            cJSON *root = cJSON_CreateObject();
            cJSON_AddStringToObject(root, "device_id", CONFIG_DEVICE_ID);
            cJSON_AddNumberToObject(root, "seq", (double)(s_seq++));
            cJSON *zones = cJSON_AddArrayToObject(root, "pressure_zones");
            for (int i = 0; i < N_CH; i++) {
                cJSON_AddItemToArray(zones, cJSON_CreateNumber(s_values[s_zone_idx[i]]));
            }
            cJSON_AddNumberToObject(root, "pressure_contact", (double)(roundf(contact * 100) / 100));
            cJSON_AddNumberToObject(root, "pressure_change", (double)(roundf(change * 100) / 100));
            cJSON_AddNullToObject(root, "imu_motion");
            cJSON_AddNullToObject(root, "temperature_c");
            cJSON_AddNullToObject(root, "humidity_pct");
            cJSON_AddNumberToObject(root, "vibration_feedback", s_vib_enabled ? 1.0 : 0.0);
            cJSON_AddNumberToObject(root, "vibration2_feedback", s_vib_enabled2 ? 1.0 : 0.0);
            cJSON_AddStringToObject(root, "trigger_event", s_trigger_event);
            cJSON_AddBoolToObject(root, "trigger_auto_enabled", s_trigger_auto);
            cJSON_AddNumberToObject(root, "trigger_count", (double)s_trigger_count);

            char *body = cJSON_PrintUnformatted(root);
            if (body) {
                int code = http_post_json(NX_PILLOW_URL, body);
                s_last_http_code = code;
                if (code >= 200 && code < 300) {
                    backoff_ms = UPLOAD_INTERVAL_MS;
                    s_pillow_ok++;
                } else {
                    if (backoff_ms < 10000) backoff_ms *= 2;
                    s_pillow_fail++;
                }
                cJSON_free(body);
            }
            cJSON_Delete(root);
        }

        vTaskDelay(pdMS_TO_TICKS(backoff_ms));
    }
}

/* ---------------- 脑电上传任务（2Hz，/api/esp/telemetry） ---------------- */

#if CONFIG_ENABLE_EEG_UPLOAD
static void esp_upload_task(void *arg)
{
    uint32_t backoff_ms = UPLOAD_INTERVAL_MS;
    uint32_t esp_seq = 0;
    uint32_t last_count = 0;

    while (1) {
        if (s_wifi_connected) {
            int16_t samples[ESP_BATCH];
            uint32_t count = s_eeg_ring_count;   /* 原子快照 */
            bool ready = (count >= ESP_BATCH);
            if (ready) {
                uint32_t start = count - ESP_BATCH;
                for (int i = 0; i < ESP_BATCH; i++) {
                    samples[i] = s_eeg_ring[(start + i) % EEG_RING_SIZE];
                }
                /* 两次上传间隔里新产生的点超过一批，被覆盖的计入丢样 */
                uint32_t produced = count - last_count;
                if (last_count && produced > ESP_BATCH) {
                    s_eeg_dropped += produced - ESP_BATCH;
                }
                last_count = count;
            }

            cJSON *root = cJSON_CreateObject();
            cJSON_AddStringToObject(root, "device_id", CONFIG_DEVICE_ID);
            cJSON_AddNumberToObject(root, "seq", (double)(esp_seq++));
            cJSON_AddNumberToObject(root, "uptime_ms", (double)(esp_timer_get_time() / 1000));

            cJSON *eeg = cJSON_AddObjectToObject(root, "eeg");
            cJSON_AddNumberToObject(eeg, "sample_rate_hz", 100);
            cJSON *samples_arr = cJSON_AddArrayToObject(eeg, "raw_samples");
            for (int i = 0; i < ESP_BATCH; i++) {
                cJSON_AddItemToArray(samples_arr, cJSON_CreateNumber(ready ? samples[i] : 0));
            }
            cJSON_AddStringToObject(eeg, "unit", "adc_count");

            if (s_eeg_contact) {
                cJSON_AddNumberToObject(eeg, "signal_quality", (double)s_eeg_signal_quality);
            } else {
                cJSON_AddNullToObject(eeg, "signal_quality");
            }
            cJSON_AddBoolToObject(eeg, "contact", s_eeg_contact);

            cJSON *bands = cJSON_AddObjectToObject(eeg, "bands");
            bool bands_ok = s_bands_valid && s_eeg_contact;
            if (bands_ok) {
                cJSON_AddNumberToObject(bands, "delta", (double)s_band_delta);
                cJSON_AddNumberToObject(bands, "theta", (double)s_band_theta);
                cJSON_AddNumberToObject(bands, "alpha", (double)s_band_alpha);
                cJSON_AddNumberToObject(bands, "beta", (double)s_band_beta);
                cJSON_AddNumberToObject(bands, "gamma", (double)s_band_gamma);
            } else {
                cJSON_AddNullToObject(bands, "delta");
                cJSON_AddNullToObject(bands, "theta");
                cJSON_AddNullToObject(bands, "alpha");
                cJSON_AddNullToObject(bands, "beta");
                cJSON_AddNullToObject(bands, "gamma");
            }

            cJSON *metrics = cJSON_AddObjectToObject(root, "metrics");
            cJSON_AddNumberToObject(metrics, "vibration_enabled", s_vib_enabled ? 1 : 0);
            cJSON_AddNumberToObject(metrics, "vibration_level_pct", s_vib_enabled ? 100 : 0);
            cJSON_AddNumberToObject(metrics, "vibration2_enabled", s_vib_enabled2 ? 1 : 0);
            cJSON_AddNumberToObject(metrics, "electrode_ble_connected", s_connected ? 1 : 0);
            cJSON_AddNumberToObject(metrics, "electrode_enabled", s_massage_on ? 1 : 0);
            cJSON_AddNumberToObject(metrics, "electrode_intensity_level", s_cur_level);
            cJSON_AddNumberToObject(metrics, "eeg_scale_uv_per_count", UV_PER_COUNT);

            char *body = cJSON_PrintUnformatted(root);
            if (body) {
                int code = http_post_json(NX_ESP_URL, body);
                s_last_http_code = code;
                if (code >= 200 && code < 300) {
                    backoff_ms = UPLOAD_INTERVAL_MS;
                    s_esp_ok++;
                } else {
                    if (backoff_ms < 10000) backoff_ms *= 2;
                    s_esp_fail++;
                }
                cJSON_free(body);
            }
            cJSON_Delete(root);
        }

        vTaskDelay(pdMS_TO_TICKS(backoff_ms));
    }
}
#endif

/* ---------------- 采样任务（10Hz） ---------------- */

static void sample_task(void *arg)
{
    while (1) {
        int raw[N_CH] = {0};
        for (int i = 0; i < N_CH; i++) {
            adc_oneshot_read(s_adc1, s_chans[i], &raw[i]);
        }
        int raw_eeg = 0;
        adc_oneshot_read(s_adc1, EEG_CH, &raw_eeg);

        /* ADS1120 改由 eeg_task 高速独立采样（网页 FFT），这里占位 0 */
        int16_t eeg2 = 0;
        int16_t eeg3 = 0;

        char line[128] = {0};
        int off = 0;
        for (int i = 0; i < N_CH; i++) {
            s_raw[i] = raw[i];   /* 原始值，触发引擎算变化用 */
            if (!s_ema_init) s_ema[i] = (float)raw[i];
            else s_ema[i] = s_ema[i] * 0.8f + (float)raw[i] * 0.2f;
            int v = (int)lroundf(s_ema[i]);
            if (v < (int)NOISE) v = 0;
            s_values[i] = v;
            off += snprintf(line + off, sizeof(line) - off, "%d ", v);
        }
        if (!s_ema_init) s_eeg_ema = (float)raw_eeg;
        else s_eeg_ema = s_eeg_ema * 0.5f + (float)raw_eeg * 0.5f;
        s_eeg = (int)lroundf(s_eeg_ema);
        s_ema_init = true;
        off += snprintf(line + off, sizeof(line) - off, "%d %d %d\n", s_eeg, eeg2, eeg3);

        printf("%s", line);
        fflush(stdout);

        vTaskDelay(pdMS_TO_TICKS(SAMPLE_INTERVAL_MS));
    }
}

/* 脑电高速采样：ADS1120 差分 100Hz。
 * 1) 写入环形缓冲供 /api/esp/telemetry 上传；
 * 2) 写入 FFT 滚动窗口（256 点，128 点步进）算五频段；
 * 3) 攒批 "E" 前缀发串口供 PC 网页 FFT，并算峰峰值更新接触状态。 */
static void eeg_task(void *arg)
{
    int16_t buf[EEG_BATCH];
    int n = 0;
    while (1) {
        int16_t v = ads1120_read_channel(ADS1120_MUX_DIFF, ADS1120_GAIN_32);

        /* 写环形缓冲：count 为 32 位原子递增，读取端做快照，无需锁 */
        s_eeg_ring[s_eeg_ring_count % EEG_RING_SIZE] = v;
        s_eeg_ring_count++;

        /* FFT 滚动窗口 */
        s_fft_buf[s_fft_filled++] = v;
        if (s_fft_filled >= FFT_N) {
            float b[5];
            if (compute_bands(s_fft_buf, b)) {
                s_band_delta = b[0]; s_band_theta = b[1]; s_band_alpha = b[2];
                s_band_beta = b[3]; s_band_gamma = b[4];
                s_bands_valid = true;
            } else {
                s_bands_valid = false;
            }
            /* 保留后 128 点实现 50% 重叠 */
            memmove(s_fft_buf, s_fft_buf + FFT_HOP, (FFT_N - FFT_HOP) * sizeof(int16_t));
            s_fft_filled = FFT_N - FFT_HOP;
        }

        buf[n++] = v;
        if (n >= EEG_BATCH) {
            printf("E");
            for (int i = 0; i < EEG_BATCH; i++) {
                printf(" %d", buf[i]);
            }
            printf("\n");
            fflush(stdout);

            /* 本批 16 点峰峰值 -> 接触状态 / 信号质量（0~100） */
            int16_t mn = buf[0], mx = buf[0];
            for (int i = 0; i < EEG_BATCH; i++) {
                if (buf[i] < mn) mn = buf[i];
                if (buf[i] > mx) mx = buf[i];
            }
            int32_t pp = (int32_t)mx - mn;
            s_eeg_contact = s_ads_ready && pp <= LEAD_OFF_PP;
            if (s_eeg_contact) {
                float q = (1.0f - (float)pp / LEAD_OFF_PP) * 100.0f;
                if (q < 30.0f) q = 30.0f;
                if (q > 100.0f) q = 100.0f;
                s_eeg_signal_quality = q;
            } else {
                s_eeg_signal_quality = 0;
            }
            n = 0;
        }
    }
}

/* ---------------- WiFi ---------------- */

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        s_wifi_connected = false;
        ESP_LOGW(TAG, "wifi 断开，重连 %s", CONFIG_WIFI_SSID);
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *evt = (ip_event_got_ip_t *)data;
        s_wifi_connected = true;
        ESP_LOGI(TAG, "WIFI_CONNECTED ip=" IPSTR, IP2STR(&evt->ip_info.ip));
    }
}

static void wifi_init_sta(void)
{
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL));

    wifi_config_t wc = {0};
    strncpy((char *)wc.sta.ssid, CONFIG_WIFI_SSID, sizeof(wc.sta.ssid));
    strncpy((char *)wc.sta.password, CONFIG_WIFI_PASS, sizeof(wc.sta.password));
    wc.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI(TAG, "正在连接 %s ...", CONFIG_WIFI_SSID);
}

/* ---------------- 按摩贴片 BLE ---------------- */

static void mac_str_to_bytes(const char *str, uint8_t out[6])
{
    unsigned int v[6] = {0};
    sscanf(str, "%x:%x:%x:%x:%x:%x", &v[0], &v[1], &v[2], &v[3], &v[4], &v[5]);
    for (int i = 0; i < 6; i++) {
        out[i] = (uint8_t)v[i];
    }
}

static void dump_hex(const char *tag, const uint8_t *data, uint16_t len)
{
    printf("%s: ", tag);
    for (int i = 0; i < len; i++) {
        printf("%02X ", data[i]);
    }
    printf("\n");
}

static void massage_connect(void);

static esp_err_t massage_send_frame(uint8_t cmd, uint8_t p3)
{
    if (!s_connected || s_fff2_handle == 0) {
        ESP_LOGW(TAG_MASSAGE, "not ready (connected=%d fff2=0x%x)", s_connected, s_fff2_handle);
        s_last_ack = "error";
        return ESP_ERR_INVALID_STATE;
    }

    uint8_t frame[6] = {FRAME_HEAD, cmd, 0x00, 0x00, p3, FRAME_TAIL};
    dump_hex("[MASSAGE TX]", frame, sizeof(frame));

    s_pending_cmd = cmd;
    xEventGroupClearBits(s_ack_evt, ACK_BIT);

    esp_err_t ret = esp_ble_gattc_write_char(s_gattc_if, s_conn_id, s_fff2_handle,
                                             sizeof(frame), frame,
                                             ESP_GATT_WRITE_TYPE_RSP,
                                             ESP_GATT_AUTH_REQ_NONE);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG_MASSAGE, "write char failed 0x%x", ret);
        s_last_ack = "error";
        return ret;
    }

    EventBits_t bits = xEventGroupWaitBits(s_ack_evt, ACK_BIT, pdTRUE, pdFALSE,
                                           pdMS_TO_TICKS(ACK_TIMEOUT_MS));
    if (bits & ACK_BIT) {
        ESP_LOGI(TAG_MASSAGE, "ACK received");
        s_last_ack = "ok";
        return ESP_OK;
    }
    ESP_LOGW(TAG_MASSAGE, "ACK timeout");
    s_last_ack = "timeout";
    return ESP_ERR_TIMEOUT;
}

static esp_err_t massage_set_intensity(uint8_t level)
{
    if (level < 1 || level > 5) {
        ESP_LOGE(TAG_MASSAGE, "level out of range (1-5)");
        return ESP_ERR_INVALID_ARG;
    }
    esp_err_t r = massage_send_frame(CMD_INTENSITY, s_level_map[level]);
    if (r == ESP_OK) s_cur_level = level;   /* 真实回执成功才更新 */
    return r;
}

static esp_err_t massage_start(void)
{
    esp_err_t r = massage_send_frame(CMD_START, 0x00);
    if (r == ESP_OK) s_massage_on = true;
    return r;
}

static esp_err_t massage_stop(void)
{
    esp_err_t r = massage_send_frame(CMD_STOP, 0x00);
    if (r == ESP_OK) s_massage_on = false;
    return r;
}

static void massage_connect(void)
{
    if (s_connected || s_gattc_if == ESP_GATT_IF_NONE) {
        return;
    }
    esp_ble_gatt_creat_conn_params_t p = {0};
    mac_str_to_bytes(MASSAGE_TARGET_MAC, p.remote_bda);
    p.remote_addr_type = MASSAGE_ADDR_TYPE;
    p.own_addr_type = BLE_ADDR_TYPE_PUBLIC;
    p.is_direct = true;
    p.is_aux = false;
    p.phy_mask = 0x0;
    ESP_LOGI(TAG_MASSAGE, "connecting to " MASSAGE_TARGET_MAC " ...");
    esp_err_t ret = esp_ble_gattc_enh_open(s_gattc_if, &p);
    if (ret) {
        ESP_LOGE(TAG_MASSAGE, "enh_open failed 0x%x", ret);
    }
}

static void massage_connect_delayed(void *arg)
{
    vTaskDelay(pdMS_TO_TICKS(2000));
    massage_connect();
    vTaskDelete(NULL);
}

static void gattc_profile_event_handler(esp_gattc_cb_event_t event, esp_gatt_if_t gattc_if,
                                        esp_ble_gattc_cb_param_t *param)
{
    switch (event) {
    case ESP_GATTC_REG_EVT:
        ESP_LOGI(TAG_MASSAGE, "GATT client registered, gattc_if %d", gattc_if);
        massage_connect();
        break;

    case ESP_GATTC_CONNECT_EVT:
        s_conn_id = param->connect.conn_id;
        ESP_LOGI(TAG_MASSAGE, "Connected, conn_id %d", s_conn_id);
        esp_ble_gattc_send_mtu_req(gattc_if, s_conn_id);
        break;

    case ESP_GATTC_OPEN_EVT:
        if (param->open.status != ESP_GATT_OK) {
            ESP_LOGE(TAG_MASSAGE, "Open failed, status %d", param->open.status);
            break;
        }
        s_connected = true;
        ESP_LOGI(TAG_MASSAGE, "BLE link open, MTU %u", param->open.mtu);
        esp_ble_gattc_search_service(gattc_if, s_conn_id, &s_srv_uuid);
        break;

    case ESP_GATTC_SEARCH_RES_EVT:
        if (param->search_res.srvc_id.uuid.len == ESP_UUID_LEN_16 &&
            param->search_res.srvc_id.uuid.uuid.uuid16 == SRV_UUID16) {
            s_svc_start = param->search_res.start_handle;
            s_svc_end = param->search_res.end_handle;
            ESP_LOGI(TAG_MASSAGE, "FFF0 service found, handle [%d, %d]", s_svc_start, s_svc_end);
        }
        break;

    case ESP_GATTC_SEARCH_CMPL_EVT: {
        if (param->search_cmpl.status != ESP_GATT_OK) {
            ESP_LOGE(TAG_MASSAGE, "Service search failed %d", param->search_cmpl.status);
            break;
        }
        /* 找 FFF2（写） */
        do {
            uint16_t count = 0;
            esp_gatt_status_t st = esp_ble_gattc_get_attr_count(
                gattc_if, s_conn_id, ESP_GATT_DB_CHARACTERISTIC,
                s_svc_start, s_svc_end, 0, &count);
            if (st != ESP_GATT_OK || count == 0) break;
            esp_gattc_char_elem_t *elems = calloc(count, sizeof(*elems));
            if (!elems) break;
            esp_bt_uuid_t uuid = {.len = ESP_UUID_LEN_16, .uuid = {.uuid16 = CHAR_TX_UUID16}};
            st = esp_ble_gattc_get_char_by_uuid(gattc_if, s_conn_id,
                                                s_svc_start, s_svc_end, uuid, elems, &count);
            if (st == ESP_GATT_OK && count > 0) {
                s_fff2_handle = elems[0].char_handle;
                ESP_LOGI(TAG_MASSAGE, "FFF2 (write) handle 0x%x", s_fff2_handle);
            }
            free(elems);
        } while (0);

        /* 找 FFF1（notify）并注册 */
        do {
            uint16_t count = 0;
            esp_gatt_status_t st = esp_ble_gattc_get_attr_count(
                gattc_if, s_conn_id, ESP_GATT_DB_CHARACTERISTIC,
                s_svc_start, s_svc_end, 0, &count);
            if (st != ESP_GATT_OK || count == 0) break;
            esp_gattc_char_elem_t *elems = calloc(count, sizeof(*elems));
            if (!elems) break;
            esp_bt_uuid_t uuid = {.len = ESP_UUID_LEN_16, .uuid = {.uuid16 = CHAR_RX_UUID16}};
            st = esp_ble_gattc_get_char_by_uuid(gattc_if, s_conn_id,
                                                s_svc_start, s_svc_end, uuid, elems, &count);
            if (st == ESP_GATT_OK && count > 0 &&
                (elems[0].properties & ESP_GATT_CHAR_PROP_BIT_NOTIFY)) {
                s_fff1_handle = elems[0].char_handle;
                ESP_LOGI(TAG_MASSAGE, "FFF1 (notify) handle 0x%x", s_fff1_handle);
                uint8_t remote_bda[6];
                mac_str_to_bytes(MASSAGE_TARGET_MAC, remote_bda);
                esp_ble_gattc_register_for_notify(gattc_if, remote_bda, s_fff1_handle);
            }
            free(elems);
        } while (0);
        break;
    }

    case ESP_GATTC_REG_FOR_NOTIFY_EVT: {
        if (param->reg_for_notify.status != ESP_GATT_OK) {
            ESP_LOGE(TAG_MASSAGE, "Notify register failed %d", param->reg_for_notify.status);
            break;
        }
        uint16_t count = 0;
        esp_bt_uuid_t descr_uuid = {.len = ESP_UUID_LEN_16,
                                    .uuid = {.uuid16 = ESP_GATT_UUID_CHAR_CLIENT_CONFIG}};
        esp_ble_gattc_get_attr_count(gattc_if, s_conn_id, ESP_GATT_DB_DESCRIPTOR,
                                     s_svc_start, s_svc_end, s_fff1_handle, &count);
        if (count > 0) {
            esp_gattc_descr_elem_t *descr = calloc(count, sizeof(*descr));
            if (descr) {
                esp_gatt_status_t st = esp_ble_gattc_get_descr_by_char_handle(
                    gattc_if, s_conn_id, s_fff1_handle, descr_uuid, descr, &count);
                if (st == ESP_GATT_OK && count > 0) {
                    uint16_t notify_en = 1;
                    esp_ble_gattc_write_char_descr(gattc_if, s_conn_id, descr[0].handle,
                                                   sizeof(notify_en), (uint8_t *)&notify_en,
                                                   ESP_GATT_WRITE_TYPE_RSP, ESP_GATT_AUTH_REQ_NONE);
                }
                free(descr);
            }
        }
        break;
    }

    case ESP_GATTC_WRITE_DESCR_EVT:
        s_ready = true;
        ESP_LOGI(TAG_MASSAGE, "FFF1 Notify enabled, ready to control");
        break;

    case ESP_GATTC_NOTIFY_EVT: {
        uint8_t *data = param->notify.value;
        uint16_t len = param->notify.value_len;
        dump_hex("[MASSAGE RX]", data, len);
        if (len == 6 && data[0] == FRAME_HEAD && data[1] == CMD_ACK &&
            data[5] == FRAME_TAIL && data[2] == s_pending_cmd) {
            xEventGroupSetBits(s_ack_evt, ACK_BIT);
        }
        break;
    }

    case ESP_GATTC_WRITE_CHAR_EVT:
        if (param->write.status != ESP_GATT_OK) {
            ESP_LOGE(TAG_MASSAGE, "Write char failed %d", param->write.status);
        }
        break;

    case ESP_GATTC_DISCONNECT_EVT:
        s_connected = false;
        s_ready = false;
        s_fff1_handle = 0;
        s_fff2_handle = 0;
        s_massage_on = false;               /* 断联强制恢复关闭 */
        s_last_ack = "ble_disconnected";
        s_ble_reconnects++;
        ESP_LOGW(TAG_MASSAGE, "Disconnected, reason 0x%02x", param->disconnect.reason);
        xTaskCreate(massage_connect_delayed, "reconnect", 2048, NULL, 5, NULL);
        break;

    default:
        break;
    }
}

static void esp_gattc_cb(esp_gattc_cb_event_t event, esp_gatt_if_t gattc_if,
                         esp_ble_gattc_cb_param_t *param)
{
    if (event == ESP_GATTC_REG_EVT) {
        if (param->reg.status == ESP_GATT_OK) {
            s_gattc_if = gattc_if;
        } else {
            ESP_LOGE(TAG_MASSAGE, "reg app failed, app_id %04x, status %d",
                     param->reg.app_id, param->reg.status);
            return;
        }
    }
    gattc_profile_event_handler(event, gattc_if, param);
}

static void esp_gap_cb(esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param)
{
    switch (event) {
    case ESP_GAP_BLE_UPDATE_CONN_PARAMS_EVT:
        ESP_LOGI(TAG_MASSAGE, "conn params update: int %d lat %d timeout %d",
                 param->update_conn_params.conn_int,
                 param->update_conn_params.latency,
                 param->update_conn_params.timeout);
        break;
    default:
        break;
    }
}

/* ---------------- 串口命令 ---------------- */

static void handle_command(char *line)
{
    while (*line == ' ' || *line == '\t') line++;
    size_t len = strlen(line);
    while (len && (line[len - 1] == '\n' || line[len - 1] == '\r' ||
                   line[len - 1] == ' ' || line[len - 1] == '\t')) {
        line[--len] = 0;
    }
    if (len == 0) return;

    if (strcmp(line, "connect") == 0) {
        massage_connect();
    } else if (strcmp(line, "start") == 0) {
        massage_start();
    } else if (strcmp(line, "stop") == 0) {
        massage_stop();
    } else if (strncmp(line, "level", 5) == 0) {
        int lv = atoi(line + 5);
        massage_set_intensity((uint8_t)lv);
    } else if (strcmp(line, "status") == 0) {
        printf("connected=%d ready=%d fff1=0x%x fff2=0x%x\n",
               s_connected, s_ready, s_fff1_handle, s_fff2_handle);
    } else if (strcmp(line, "vib on") == 0) {
        gpio_set_level(VIB_GPIO, 0);  /* PNP 低电平导通 -> 震动 */
        s_vib_enabled = true;
        printf("vib=on\n");
    } else if (strcmp(line, "vib off") == 0) {
        gpio_set_level(VIB_GPIO, 1);  /* 高电平截止 -> 停 */
        s_vib_enabled = false;
        printf("vib=off\n");
    } else if (strcmp(line, "vib2 on") == 0) {
        gpio_set_level(VIB_GPIO2, 0);  /* PNP 低电平导通 -> 震动 */
        s_vib_enabled2 = true;
        printf("vib2=on\n");
    } else if (strcmp(line, "vib2 off") == 0) {
        gpio_set_level(VIB_GPIO2, 1);  /* 高电平截止 -> 停 */
        s_vib_enabled2 = false;
        printf("vib2=off\n");
    } else if (strcmp(line, "help") == 0) {
        printf("commands: level <1-5> | start | stop | connect | status | vib on/off | vib2 on/off | help\n");
    } else {
        printf("unknown: %s\n", line);
    }
}

/* 每 10 秒输出一次汇总：上传成功/失败、最后 HTTP 码、EEG 缓冲占用、丢样、BLE 重连、堆内存 */
static void log_task(void *arg)
{
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(10000));
        ESP_LOGI(TAG, "SUMMARY pillow_ok=%" PRIu32 "/fail=%" PRIu32
                 " esp_ok=%" PRIu32 "/fail=%" PRIu32 " http=%d"
                 " eeg_cnt=%" PRIu32 " drop=%" PRIu32 " ble_re=%" PRIu32
                 " free_heap=%" PRIu32,
                 s_pillow_ok, s_pillow_fail, s_esp_ok, s_esp_fail,
                 s_last_http_code, s_eeg_ring_count, s_eeg_dropped,
                 s_ble_reconnects, (uint32_t)esp_get_free_heap_size());
    }
}

/* ---------------- main ---------------- */

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    /* ADC */
    adc_oneshot_unit_init_cfg_t unit_cfg = {
        .unit_id = ADC_UNIT_1,
        .ulp_mode = ADC_ULP_MODE_DISABLE,
    };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit_cfg, &s_adc1));

    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12,
    };
    for (int i = 0; i < N_CH; i++) {
        ESP_ERROR_CHECK(adc_oneshot_config_channel(s_adc1, s_chans[i], &chan_cfg));
    }
    ESP_ERROR_CHECK(adc_oneshot_config_channel(s_adc1, EEG_CH, &chan_cfg)); /* 脑电波 GPIO8 */

    /* ADS1120 SPI ADC（高精度脑电） */
    ads1120_init();

    /* 震动模块 GPIO（PNP：低电平导通，默认关=高电平） */
    gpio_config_t vib_cfg = {
        .pin_bit_mask = (1ULL << VIB_GPIO) | (1ULL << VIB_GPIO2),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&vib_cfg));
    gpio_set_level(VIB_GPIO, 1);
    gpio_set_level(VIB_GPIO2, 1);

    s_ack_evt = xEventGroupCreate();
    assert(s_ack_evt);

    /* WiFi */
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    wifi_init_sta();
    trigger_http_start();

    /* BLE controller + bluedroid（WiFi + BLE 共存） */
    ESP_ERROR_CHECK(esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT));
    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_bt_controller_init(&bt_cfg));
    ESP_ERROR_CHECK(esp_bt_controller_enable(ESP_BT_MODE_BLE));
    ESP_ERROR_CHECK(esp_bluedroid_init());
    ESP_ERROR_CHECK(esp_bluedroid_enable());

    ESP_ERROR_CHECK(esp_ble_gap_register_callback(esp_gap_cb));
    ESP_ERROR_CHECK(esp_ble_gattc_register_callback(esp_gattc_cb));
    ESP_ERROR_CHECK(esp_ble_gattc_app_register(0));
    esp_ble_gatt_set_local_mtu(500);

    ESP_LOGI(TAG, "=== DreamGuardian 启动 ===");
    ESP_LOGI(TAG, "  device_id=%s", CONFIG_DEVICE_ID);
    ESP_LOGI(TAG, "  NX_HOST=%s:%s", CONFIG_NX_HOST, CONFIG_NX_PORT);
    ESP_LOGI(TAG, "  EEG: ADS1120 差分 32x, 100Hz, Fp1 (adc_count, 1LSB=%.3fuV, FFT %d 点)", (double)UV_PER_COUNT, FFT_N);
    ESP_LOGI(TAG, "  压力: 6ch ADC 10Hz -> %s", "/api/pillow/telemetry");
    ESP_LOGI(TAG, "  脑电: 100Hz + 五频段 -> %s", "/api/esp/telemetry");

    xTaskCreate(sample_task, "sample", 4096, NULL, 5, NULL);
    xTaskCreate(upload_task, "upload", 8192, NULL, 4, NULL);
    xTaskCreate(eeg_task, "eeg", 4096, NULL, 6, NULL);
#if CONFIG_ENABLE_EEG_UPLOAD
    xTaskCreate(esp_upload_task, "esp_up", 8192, NULL, 4, NULL);
#endif
    xTaskCreate(log_task, "log", 3072, NULL, 3, NULL);

    /* 串口命令：level/start/stop/connect/status/vib（压力数据由 sample_task 打印） */
    usb_serial_jtag_driver_config_t jtag_cfg = {
        .tx_buffer_size = 256,
        .rx_buffer_size = 256,
    };
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&jtag_cfg));
    usb_serial_jtag_vfs_use_driver();

    char line[64];
    int line_len = 0;
    while (1) {
        uint8_t ch;
        int n = usb_serial_jtag_read_bytes(&ch, 1, pdMS_TO_TICKS(20));
        if (n > 0) {
            if (ch == '\n' || ch == '\r') {
                if (line_len > 0) {
                    line[line_len] = '\0';
                    handle_command(line);
                    line_len = 0;
                }
            } else if (line_len < (int)sizeof(line) - 1) {
                line[line_len++] = (char)ch;
            }
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
