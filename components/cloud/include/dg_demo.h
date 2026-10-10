#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_http_server.h"
#include "cJSON.h"

/* RAM-only lease. HTTP never touches a driver or the sleep state machine. */
typedef struct {
    bool active, has_frame, allow_outputs, presence, bio_valid;
    char session_id[65];
    uint32_t seq;
    double heart_bpm, breath_bpm, motion_norm, stability;
    int64_t input_us, started_us;
    uint32_t ttl_ms, max_duration_sec;
} dg_demo_snapshot_t;
esp_err_t dg_demo_local_control(const char *arg);
void dg_demo_snapshot(dg_demo_snapshot_t *out);
esp_err_t dg_demo_register(httpd_handle_t server);
void dg_demo_add_json(cJSON *root, const dg_demo_snapshot_t *sample, bool report_simulated);
