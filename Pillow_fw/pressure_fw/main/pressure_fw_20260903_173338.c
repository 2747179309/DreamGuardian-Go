/*
 * pressure_fw - ESP32-S3 6 路压力传感器 + WiFi + 上传到 Jetson NX
 *
 * 功能：
 *   1. 6 路 ADC1 读压力传感器（FSR 分压），每 100ms 采样，EMA 去噪。
 *   2. 上电自动连 WiFi（REDMI K90）。
 *   3. 独立上传任务：每 500ms 把 6 路压力打包成 JSON，HTTP POST 到
 *      Jetson NX 的枕头遥测接口。
 *   4. 串口同步打印一行原始数据（USB 调试用）。
 *
 * NX 接口：POST http://10.192.244.161:8000/api/pillow/telemetry
 * 请求体：
 *   device_id         "pillow-esp"
 *   seq               递增帧号
 *   pressure_zones    [6 路滤波值]，顺序 上排5,4,6 / 下排2,1,3
 *   pressure_contact  6 路总和归一化 0~1
 *   pressure_change   短时变化归一化 0~1
 *   imu_motion        null（无 IMU）
 *   temperature_c     null（无温湿度）
 *   humidity_pct      null
 *   vibration_feedback null
 *
 * 引脚分配（ADC1，避开 boot/strapping/USB）：
 *   GPIO1 -> ADC1_CH0（传感器1 中下）  GPIO5 -> ADC1_CH4（传感器4 中上）
 *   GPIO2 -> ADC1_CH1（传感器2 左下）  GPIO6 -> ADC1_CH5（传感器5 左上）
 *   GPIO4 -> ADC1_CH3（传感器3 右下）  GPIO7 -> ADC1_CH6（传感器6 右上）
 *   GPIO8 -> ADC1_CH7（脑电波 EEG，单模拟信号线）
 */

#include <stdio.h>
#include <string.h>
#include <math.h>
#include <stdbool.h>
#include <inttypes.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_err.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "cJSON.h"
#include "nvs_flash.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_ota_ops.h"
#include "esp_system.h"

#define N_CH 6
#define EEG_CH ADC_CHANNEL_7     /* 脑电波 -> GPIO8 */

#define SAMPLE_INTERVAL_MS 100   /* ADC 采样周期（10Hz） */
#define UPLOAD_INTERVAL_MS 500   /* 上传周期（2Hz） */

#define WIFI_SSID "REDMI K90"
#define WIFI_PASS "7951712Wy"

#define NX_URL "http://10.192.244.161:8000/api/pillow/telemetry"
#define DEVICE_ID "pillow-esp"

/* ---- 归一化满量程（接好传感器后按真实数据调） ---- */
#define NOISE               250.0f   /* 低于此值视为无压力（悬空噪声约 200） */
#define CONTACT_FULL_SCALE  12000.0f /* 6 路去噪总和"强接触"的满量程 */
#define CHANGE_FULL_SCALE   4000.0f  /* 短时变化量"剧烈"的满量程 */

static const char *TAG = "pillow";

/* ADC1 通道（对应 GPIO1/2/4/5/6/7，即传感器 1~6） */
static const adc_channel_t s_chans[N_CH] = {
    ADC_CHANNEL_0, /* 传感器1 GPIO1 中下 */
    ADC_CHANNEL_1, /* 传感器2 GPIO2 左下 */
    ADC_CHANNEL_3, /* 传感器3 GPIO4 右下 */
    ADC_CHANNEL_4, /* 传感器4 GPIO5 中上 */
    ADC_CHANNEL_5, /* 传感器5 GPIO6 左上 */
    ADC_CHANNEL_6, /* 传感器6 GPIO7 右上 */
};

/* pressure_zones 输出顺序：上排 5,4,6 / 下排 2,1,3（v[] 下标 = 传感器号-1） */
static const int s_zone_idx[N_CH] = { 4, 3, 5, 1, 0, 2 };

static adc_oneshot_unit_handle_t s_adc1 = NULL;
static volatile bool s_wifi_connected = false;
static esp_http_client_handle_t s_client = NULL;
static uint32_t s_seq = 0;

/* 采样结果（去噪后），被上传任务读取 */
static int s_values[N_CH] = {0};
/* EMA 基线（用于算 pressure_change） */
static float s_ema[N_CH] = {0};
static bool s_ema_init = false;
/* 脑电波（GPIO8） */
static int s_eeg = 0;
static float s_eeg_ema = 0;

/* ---------------- HTTP ---------------- */

static void http_reset(void)
{
    if (s_client) {
        esp_http_client_cleanup(s_client);
        s_client = NULL;
    }
}

static bool http_post_json(const char *body)
{
    if (!s_client) {
        esp_http_client_config_t cfg = {
            .url = NX_URL,
            .method = HTTP_METHOD_POST,
            .timeout_ms = 2000,
        };
        s_client = esp_http_client_init(&cfg);
        if (!s_client) {
            ESP_LOGE(TAG, "http client init failed");
            return false;
        }
        esp_http_client_set_header(s_client, "Content-Type", "application/json");
    }

    esp_err_t err = esp_http_client_set_post_field(s_client, body, strlen(body));
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "set_post_field failed: %s", esp_err_to_name(err));
        http_reset();
        return false;
    }

    err = esp_http_client_perform(s_client);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "POST fail: %s", esp_err_to_name(err));
        http_reset();
        return false;
    }

    int code = esp_http_client_get_status_code(s_client);
    if (code < 200 || code >= 300) {
        ESP_LOGW(TAG, "POST HTTP %d", code);
        http_reset();
        return false;
    }
    return true;
}

/* ---------------- 上传任务（2Hz） ---------------- */

static void upload_task(void *arg)
{
    uint32_t backoff_ms = UPLOAD_INTERVAL_MS;

    while (1) {
        if (s_wifi_connected) {
            int total = 0;
            float change = 0;
            for (int i = 0; i < N_CH; i++) {
                total += s_values[i];
                change += fabsf((float)s_values[i] - s_ema[i]);
            }
            float contact = (float)total / CONTACT_FULL_SCALE;
            if (contact > 1.0f) contact = 1.0f;
            change /= CHANGE_FULL_SCALE;
            if (change > 1.0f) change = 1.0f;

            cJSON *root = cJSON_CreateObject();
            cJSON_AddStringToObject(root, "device_id", DEVICE_ID);
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
            cJSON_AddNullToObject(root, "vibration_feedback");

            char *body = cJSON_PrintUnformatted(root);
            if (body) {
                bool ok = http_post_json(body);
                if (ok) {
                    backoff_ms = UPLOAD_INTERVAL_MS; /* 成功恢复 500ms */
                } else {
                    if (backoff_ms < 10000) backoff_ms *= 2; /* 失败退避，最大 10s */
                }
                ESP_LOGD(TAG, "%s", body);
                cJSON_free(body);
            }
            cJSON_Delete(root);
        }

        vTaskDelay(pdMS_TO_TICKS(backoff_ms));
    }
}

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

        char line[128] = {0};
        int off = 0;
        for (int i = 0; i < N_CH; i++) {
            /* EMA 去噪 */
            if (!s_ema_init) s_ema[i] = (float)raw[i];
            else s_ema[i] = s_ema[i] * 0.8f + (float)raw[i] * 0.2f;
            int v = (int)lroundf(s_ema[i]);
            if (v < (int)NOISE) v = 0; /* 去悬空噪声 */
            s_values[i] = v;
            off += snprintf(line + off, sizeof(line) - off, "%d ", v);
        }
        /* 脑电波：轻平滑（0.5 保留波动），不去噪声（有直流偏置） */
        if (!s_ema_init) s_eeg_ema = (float)raw_eeg;
        else s_eeg_ema = s_eeg_ema * 0.5f + (float)raw_eeg * 0.5f;
        s_eeg = (int)lroundf(s_eeg_ema);
        s_ema_init = true;
        off += snprintf(line + off, sizeof(line) - off, "%d\n", s_eeg);

        printf("%s", line);
        fflush(stdout);

        vTaskDelay(pdMS_TO_TICKS(SAMPLE_INTERVAL_MS));
    }
}

/* ---------------- WiFi ---------------- */

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        s_wifi_connected = false;
        ESP_LOGW(TAG, "wifi 断开，重连 %s", WIFI_SSID);
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
    strncpy((char *)wc.sta.ssid, WIFI_SSID, sizeof(wc.sta.ssid));
    strncpy((char *)wc.sta.password, WIFI_PASS, sizeof(wc.sta.password));
    wc.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI(TAG, "正在连接 %s ...", WIFI_SSID);
}

static void boot_to_massage(void)
{
    const esp_partition_t *p = esp_partition_find_first(
        ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_OTA_0, NULL);
    if (!p) {
        printf("[BOOT] ota_0 partition not found\n");
        fflush(stdout);
        return;
    }
    esp_err_t err = esp_ota_set_boot_partition(p);
    if (err != ESP_OK) {
        printf("[BOOT] set boot partition failed: %s\n", esp_err_to_name(err));
        fflush(stdout);
        return;
    }
    printf("[BOOT] switch to ota_0 (massage), rebooting...\n");
    fflush(stdout);
    vTaskDelay(pdMS_TO_TICKS(100));
    esp_restart();
}

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

    /* WiFi */
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    wifi_init_sta();

    ESP_LOGI(TAG, "PRESSURE ready: 6ch ADC 10Hz, upload 2Hz -> %s", NX_URL);

    xTaskCreate(sample_task, "sample", 4096, NULL, 5, NULL);
    xTaskCreate(upload_task, "upload", 8192, NULL, 4, NULL);

    /* 串口命令：boot_massage 切到按摩仪固件（ota_0） */
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
                    if (strcmp(line, "boot_massage") == 0) {
                        boot_to_massage();
                    } else {
                        printf("unknown: %s (cmd: boot_massage)\n", line);
                        fflush(stdout);
                    }
                    line_len = 0;
                }
            } else if (line_len < (int)sizeof(line) - 1) {
                line[line_len++] = (char)ch;
            }
        }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
