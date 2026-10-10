#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "intervention_policy.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int i2s_port;
    int bclk_gpio;
    int ws_gpio;
    int dout_gpio;
    uint32_t sample_rate_hz;
} stereo_audio_config_t;

typedef struct {
    bool initialized;
    bool output_enabled;
    int mode;
    uint8_t volume_percent;
    uint32_t sample_rate_hz;
    uint32_t wav_request_id;
    uint32_t output_generation;
    uint32_t wav_open_request_id;
    uint32_t wav_data_remaining;
    uint32_t write_calls;
    uint32_t write_errors;
    esp_err_t last_error;
    char wav_path[96];
    char last_result[64];
} stereo_audio_status_t;

esp_err_t stereo_audio_init(const stereo_audio_config_t *config);
void stereo_audio_get_status(stereo_audio_status_t *status);
/* Deadline applies only to this producer identity, never to later voice WAVs. */
void stereo_audio_limit_request_until(int mode, uint32_t output_generation, int64_t deadline_us);
esp_err_t stereo_audio_self_test(void);
esp_err_t stereo_audio_apply_decision(const intervention_decision_t *decision);
esp_err_t stereo_audio_mute(void);
bool stereo_audio_is_quiescent(void);
esp_err_t stereo_audio_wait_quiescent(uint32_t timeout_ms);
esp_err_t stereo_audio_sleep_assist_set(float volume, float target_breath_bpm, float pan_depth, bool rhythm_enabled);
esp_err_t stereo_audio_set_sleep_music_preset(const char *preset);
esp_err_t stereo_audio_play_music(uint8_t volume_percent, uint16_t duration_sec);
esp_err_t stereo_audio_play_pink_noise(uint8_t volume_percent, uint16_t duration_sec);
esp_err_t stereo_audio_play_breathing(uint8_t volume_percent, uint16_t duration_sec);
esp_err_t stereo_audio_play_wake_ack(uint8_t volume_percent, uint16_t duration_sec);
esp_err_t stereo_audio_play_wav(const char *path, uint8_t volume_percent, uint16_t duration_sec);
esp_err_t stereo_audio_play_wav_loop(const char *path, uint8_t volume_percent, uint16_t duration_sec);
esp_err_t stereo_audio_set_current_volume(uint8_t volume_percent);

#ifdef __cplusplus
}
#endif
