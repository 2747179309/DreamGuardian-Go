#include "audio_session.h"

#include <stdbool.h>
#include <string.h>

#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

typedef struct {
    audio_session_status_t status;
    portMUX_TYPE lock;
} audio_session_context_t;

static audio_session_context_t s_session = {
    .lock = portMUX_INITIALIZER_UNLOCKED,
};

static uint8_t owner_priority(audio_session_owner_t owner)
{
    switch (owner) {
    case AUDIO_SESSION_COMMAND_CAPTURE: return 6;
    case AUDIO_SESSION_CHAT_TTS: return 5;
    case AUDIO_SESSION_VOICE_PROMPT: return 4;
    case AUDIO_SESSION_WAKE_DETECTED:
    case AUDIO_SESSION_ONLINE_ASR:
    case AUDIO_SESSION_WAITING_CHAT: return 3;
    case AUDIO_SESSION_RESUME_GUARD: return 2;
    case AUDIO_SESSION_SLEEP_AUDIO: return 1;
    case AUDIO_SESSION_IDLE:
    default: return 0;
    }
}

static void set_owner_locked(audio_session_owner_t owner, esp_err_t result)
{
    if (s_session.status.owner != owner) {
        s_session.status.previous_owner = s_session.status.owner;
        s_session.status.owner = owner;
        s_session.status.transition_count++;
        s_session.status.last_transition_us = esp_timer_get_time();
    }
    s_session.status.last_error = result;
}

void audio_session_init(void)
{
    portENTER_CRITICAL(&s_session.lock);
    memset(&s_session.status, 0, sizeof(s_session.status));
    s_session.status.owner = AUDIO_SESSION_IDLE;
    s_session.status.previous_owner = AUDIO_SESSION_IDLE;
    s_session.status.last_error = ESP_OK;
    s_session.status.last_transition_us = esp_timer_get_time();
    portEXIT_CRITICAL(&s_session.lock);
}

esp_err_t audio_session_acquire(audio_session_owner_t owner, uint32_t timeout_ms)
{
    if (owner <= AUDIO_SESSION_IDLE || owner > AUDIO_SESSION_RESUME_GUARD) {
        return ESP_ERR_INVALID_ARG;
    }
    int64_t deadline_us = esp_timer_get_time() + (int64_t)timeout_ms * 1000LL;
    for (;;) {
        bool acquired = false;
        portENTER_CRITICAL(&s_session.lock);
        audio_session_owner_t current = s_session.status.owner;
        if (current == AUDIO_SESSION_IDLE || current == owner ||
            owner_priority(owner) >= owner_priority(current)) {
            set_owner_locked(owner, ESP_OK);
            acquired = true;
        }
        portEXIT_CRITICAL(&s_session.lock);
        if (acquired) {
            return ESP_OK;
        }
        if (timeout_ms == 0 || esp_timer_get_time() >= deadline_us) {
            portENTER_CRITICAL(&s_session.lock);
            s_session.status.acquire_timeout_count++;
            s_session.status.last_error = ESP_ERR_TIMEOUT;
            portEXIT_CRITICAL(&s_session.lock);
            return ESP_ERR_TIMEOUT;
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

esp_err_t audio_session_transition(audio_session_owner_t owner)
{
    if (owner < AUDIO_SESSION_IDLE || owner > AUDIO_SESSION_RESUME_GUARD) {
        return ESP_ERR_INVALID_ARG;
    }

    /*
     * acquire() arbitrates a new requester and therefore enforces priority.
     * transition() is used by the current, already-authorized voice flow to
     * advance its state (for example COMMAND_CAPTURE -> ONLINE_ASR ->
     * WAITING_CHAT). Those transitions intentionally include priority
     * downgrades, so applying the acquire rule here would strand ownership in
     * the previous high-priority state and prevent sleep audio from resuming.
     */
    portENTER_CRITICAL(&s_session.lock);
    set_owner_locked(owner, ESP_OK);
    portEXIT_CRITICAL(&s_session.lock);
    return ESP_OK;
}

void audio_session_release(audio_session_owner_t owner)
{
    portENTER_CRITICAL(&s_session.lock);
    if (s_session.status.owner == owner) {
        set_owner_locked(AUDIO_SESSION_IDLE, ESP_OK);
    }
    portEXIT_CRITICAL(&s_session.lock);
}

void audio_session_force_idle(esp_err_t reason)
{
    portENTER_CRITICAL(&s_session.lock);
    set_owner_locked(AUDIO_SESSION_IDLE, reason);
    portEXIT_CRITICAL(&s_session.lock);
}

audio_session_owner_t audio_session_current_owner(void)
{
    portENTER_CRITICAL(&s_session.lock);
    audio_session_owner_t owner = s_session.status.owner;
    portEXIT_CRITICAL(&s_session.lock);
    return owner;
}

void audio_session_get_status(audio_session_status_t *status)
{
    if (!status) {
        return;
    }
    portENTER_CRITICAL(&s_session.lock);
    *status = s_session.status;
    portEXIT_CRITICAL(&s_session.lock);
}

const char *audio_session_owner_name(audio_session_owner_t owner)
{
    switch (owner) {
    case AUDIO_SESSION_IDLE: return "IDLE";
    case AUDIO_SESSION_SLEEP_AUDIO: return "SLEEP_AUDIO";
    case AUDIO_SESSION_WAKE_DETECTED: return "WAKE_DETECTED";
    case AUDIO_SESSION_VOICE_PROMPT: return "VOICE_PROMPT";
    case AUDIO_SESSION_COMMAND_CAPTURE: return "COMMAND_CAPTURE";
    case AUDIO_SESSION_ONLINE_ASR: return "ONLINE_ASR";
    case AUDIO_SESSION_WAITING_CHAT: return "WAITING_CHAT";
    case AUDIO_SESSION_CHAT_TTS: return "CHAT_TTS";
    case AUDIO_SESSION_RESUME_GUARD: return "RESUME_GUARD";
    default: return "UNKNOWN";
    }
}
