#pragma once

#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    AUDIO_SESSION_IDLE = 0,
    AUDIO_SESSION_SLEEP_AUDIO,
    AUDIO_SESSION_WAKE_DETECTED,
    AUDIO_SESSION_VOICE_PROMPT,
    AUDIO_SESSION_COMMAND_CAPTURE,
    AUDIO_SESSION_ONLINE_ASR,
    AUDIO_SESSION_WAITING_CHAT,
    AUDIO_SESSION_CHAT_TTS,
    AUDIO_SESSION_RESUME_GUARD,
} audio_session_owner_t;

typedef struct {
    audio_session_owner_t owner;
    audio_session_owner_t previous_owner;
    uint32_t transition_count;
    uint32_t acquire_timeout_count;
    esp_err_t last_error;
    int64_t last_transition_us;
} audio_session_status_t;

void audio_session_init(void);
esp_err_t audio_session_acquire(audio_session_owner_t owner, uint32_t timeout_ms);
esp_err_t audio_session_transition(audio_session_owner_t owner);
void audio_session_release(audio_session_owner_t owner);
void audio_session_force_idle(esp_err_t reason);
audio_session_owner_t audio_session_current_owner(void);
void audio_session_get_status(audio_session_status_t *status);
const char *audio_session_owner_name(audio_session_owner_t owner);

#ifdef __cplusplus
}
#endif
