#include "dg_demo.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "lwip/sockets.h"
#include "lwip/inet.h"

static portMUX_TYPE s_lock = portMUX_INITIALIZER_UNLOCKED;
static dg_demo_snapshot_t s_demo;
static char s_token[97];
static bool s_enabled;

static void expire_locked(int64_t now)
{
    int64_t last = s_demo.has_frame ? s_demo.input_us : s_demo.started_us;
    if (s_demo.active && (now - last >= (int64_t)s_demo.ttl_ms * 1000 ||
        now - s_demo.started_us >= (int64_t)s_demo.max_duration_sec * 1000000)) {
        s_demo.active = false;
    }
}

esp_err_t dg_demo_local_control(const char *arg)
{
    if (!arg) return ESP_ERR_INVALID_ARG;
    bool off = strcmp(arg, "off") == 0;
    size_t n = strlen(arg);
    if (!off && (n < 16 || n > 96 || strchr(arg, ' ') || strchr(arg, '\t')))
        return ESP_ERR_INVALID_ARG;
    portENTER_CRITICAL(&s_lock);
    memset(s_token, 0, sizeof(s_token));
    s_enabled = !off;
    s_demo.active = false;
    if (!off) memcpy(s_token, arg, n);
    portEXIT_CRITICAL(&s_lock);
    printf("DG DEMO local gate=%s (RAM only; token not logged)\n", off ? "off" : "on");
    return ESP_OK;
}

void dg_demo_snapshot(dg_demo_snapshot_t *out)
{
    portENTER_CRITICAL(&s_lock);
    expire_locked(esp_timer_get_time());
    *out = s_demo;
    portEXIT_CRITICAL(&s_lock);
}

static esp_err_t reply(httpd_req_t *req, int code, const char *error, const char *id)
{
    const char *status = code == 200 ? "200 OK" : code == 400 ? "400 Bad Request" :
        code == 401 ? "401 Unauthorized" : code == 403 ? "403 Forbidden" : "409 Conflict";
    httpd_resp_set_status(req, status);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    cJSON *json = cJSON_CreateObject();
    cJSON_AddBoolToObject(json, "ok", code == 200);
    cJSON_AddNumberToObject(json, "version", 1);
    if (error) cJSON_AddStringToObject(json, "error", error);
    if (id) cJSON_AddStringToObject(json, "session_id", id);
    if (strcmp(req->uri, "/api/demo/capabilities") == 0 && code == 200) {
        cJSON_AddBoolToObject(json, "physiology", true);
        cJSON_AddStringToObject(json, "firmware_version", "dg-closed-loop-20260929-v1");
        cJSON_AddStringToObject(json, "motion_mapping", "motion_raw=2*motion_norm; phase proxy rate=motion_raw/0.08");
        cJSON_AddStringToObject(json, "stability_mapping", "CSI display input only; bio stability computed by original filter");
        cJSON_AddNumberToObject(json, "max_ttl_ms", 3000);
        cJSON_AddNumberToObject(json, "max_duration_sec", 120);
    }
    char *body = cJSON_PrintUnformatted(json);
    esp_err_t err = body ? httpd_resp_sendstr(req, body) : ESP_ERR_NO_MEM;
    cJSON_free(body);
    cJSON_Delete(json);
    return err;
}

static bool number(const cJSON *obj, const char *name, double lo, double hi, double *out)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(obj, name);
    if (!cJSON_IsNumber(v) || !isfinite(v->valuedouble) || v->valuedouble < lo || v->valuedouble > hi)
        return false;
    *out = v->valuedouble;
    return true;
}

static bool same_frame(const dg_demo_snapshot_t *a, const dg_demo_snapshot_t *b)
{
    return a->presence == b->presence && a->bio_valid == b->bio_valid &&
        a->heart_bpm == b->heart_bpm && a->breath_bpm == b->breath_bpm &&
        a->motion_norm == b->motion_norm && a->stability == b->stability;
}

static esp_err_t handler(httpd_req_t *req)
{
    /* Local private IPv4 peers only; never trust forwarded headers. */
    struct sockaddr_storage peer;
    socklen_t len = sizeof(peer);
    if (getpeername(httpd_req_to_sockfd(req), (struct sockaddr *)&peer, &len) != 0 || peer.ss_family != AF_INET)
        return reply(req, 403, "local_ipv4_required", NULL);
    uint32_t ip = ntohl(((struct sockaddr_in *)&peer)->sin_addr.s_addr);
    if (!((ip >> 24) == 10 || (ip >> 20) == 0xac1 || (ip >> 16) == 0xc0a8 || (ip >> 24) == 127))
        return reply(req, 403, "local_network_required", NULL);
    char auth[105] = {0}, expected[105] = {0};
    httpd_req_get_hdr_value_str(req, "Authorization", auth, sizeof(auth));
    portENTER_CRITICAL(&s_lock);
    bool enabled = s_enabled;
    snprintf(expected, sizeof(expected), "Bearer %s", s_token);
    portEXIT_CRITICAL(&s_lock);
    if (!enabled) return reply(req, 403, "demo_disabled_use_local_console", NULL);
    if (strcmp(auth, expected) != 0) return reply(req, 401, "invalid_bearer_token", NULL);
    if (req->method == HTTP_GET) return reply(req, 200, NULL, NULL);
    if (req->content_len <= 0 || req->content_len > 1024) return reply(req, 400, "body_size", NULL);
    char body[1025];
    int used = 0;
    while (used < req->content_len) {
        int n = httpd_req_recv(req, body + used, req->content_len - used);
        if (n <= 0) return reply(req, 400, "incomplete_body", NULL);
        used += n;
    }
    body[used] = 0;
    cJSON *json = cJSON_ParseWithOpts(body, NULL, true);
    double version = 0;
    const cJSON *sid = cJSON_GetObjectItemCaseSensitive(json, "session_id");
    if (!json || !number(json, "version", 1, 1, &version) || !cJSON_IsString(sid) ||
        !sid->valuestring[0] || strlen(sid->valuestring) > 64) {
        cJSON_Delete(json);
        return reply(req, 400, "invalid_version_or_session", NULL);
    }
    dg_demo_snapshot_t incoming = {0};
    snprintf(incoming.session_id, sizeof(incoming.session_id), "%s", sid->valuestring);
    int code = 200;
    const char *error = NULL;
    bool start = strcmp(req->uri, "/api/demo/start") == 0;
    bool stop = strcmp(req->uri, "/api/demo/stop") == 0;
    double x = 0, y = 0;
    if (start) {
        const cJSON *allow = cJSON_GetObjectItemCaseSensitive(json, "allow_outputs");
        if (!cJSON_IsBool(allow) || !number(json, "ttl_ms", 1, 3000, &x) || floor(x) != x ||
            !number(json, "max_duration_sec", 1, 120, &y) || floor(y) != y) error = "invalid_lease";
        incoming.ttl_ms = (uint32_t)x;
        incoming.max_duration_sec = (uint32_t)y;
        incoming.allow_outputs = cJSON_IsTrue(allow);
    } else if (!stop) {
        const cJSON *sensors = cJSON_GetObjectItemCaseSensitive(json, "sensors");
        const cJSON *presence = cJSON_GetObjectItemCaseSensitive(sensors, "presence");
        const cJSON *valid = cJSON_GetObjectItemCaseSensitive(sensors, "bio_valid");
        if (!number(json, "seq", 1, UINT32_MAX, &x) || floor(x) != x ||
            !cJSON_IsObject(sensors) || !cJSON_IsBool(presence) || !cJSON_IsBool(valid)) error = "invalid_frame";
        incoming.seq = (uint32_t)x;
        incoming.presence = cJSON_IsTrue(presence);
        incoming.bio_valid = cJSON_IsTrue(valid);
        if (!number(sensors, "motion_norm", 0, 1, &x)) error = "invalid_motion_norm";
        incoming.motion_norm = x;
        if (!number(sensors, "stability", 0, 1, &x)) error = "invalid_stability";
        incoming.stability = x;
        const cJSON *hr = cJSON_GetObjectItemCaseSensitive(sensors, "heart_bpm");
        const cJSON *br = cJSON_GetObjectItemCaseSensitive(sensors, "breath_bpm");
        if (!incoming.bio_valid && cJSON_IsNull(hr)) incoming.heart_bpm = 0;
        else if (number(sensors, "heart_bpm", 20, 250, &x)) incoming.heart_bpm = x;
        else error = "invalid_heart_bpm";
        if (!incoming.bio_valid && cJSON_IsNull(br)) incoming.breath_bpm = 0;
        else if (number(sensors, "breath_bpm", 2, 80, &x)) incoming.breath_bpm = x;
        else error = "invalid_breath_bpm";
    }
    if (error) code = 400;
    if (!error) {
        int64_t now = esp_timer_get_time();
        portENTER_CRITICAL(&s_lock);
        expire_locked(now);
        /* Recheck authorization after body receipt; local disable wins. */
        if (!s_enabled || strcmp(expected + 7, s_token) != 0) { code = 403; error = "demo_disabled"; }
        else if (start) {
            if (s_demo.active) {
                if (strcmp(s_demo.session_id, incoming.session_id) || s_demo.ttl_ms != incoming.ttl_ms ||
                    s_demo.max_duration_sec != incoming.max_duration_sec || s_demo.allow_outputs != incoming.allow_outputs) {
                    code = 409; error = "session_conflict";
                }
                /* Exact retry never extends either clock. */
            } else if (!strcmp(s_demo.session_id, incoming.session_id)) {
                code = 409; error = "session_expired_use_new_id";
            } else {
                s_demo = incoming;
                s_demo.active = true;
                s_demo.started_us = now;
            }
        } else if (strcmp(s_demo.session_id, incoming.session_id)) { code = 409; error = "session_mismatch"; }
        else if (stop) s_demo.active = false;
        else if (!s_demo.active) { code = 409; error = "session_expired"; }
        else if (incoming.seq < s_demo.seq || (incoming.seq == s_demo.seq && !same_frame(&incoming, &s_demo))) {
            code = 409; error = "sequence_conflict";
        } else if (incoming.seq > s_demo.seq) {
            incoming.active = incoming.has_frame = true;
            incoming.allow_outputs = s_demo.allow_outputs;
            incoming.started_us = s_demo.started_us;
            incoming.ttl_ms = s_demo.ttl_ms;
            incoming.max_duration_sec = s_demo.max_duration_sec;
            incoming.input_us = now;
            s_demo = incoming;
        }
        portEXIT_CRITICAL(&s_lock);
    }
    cJSON_Delete(json);
    return reply(req, code, error, code == 200 ? incoming.session_id : NULL);
}

esp_err_t dg_demo_register(httpd_handle_t server)
{
    const char *paths[] = {"/api/demo/capabilities", "/api/demo/start", "/api/demo/physiology", "/api/demo/stop"};
    for (int i = 0; i < 4; ++i) {
        httpd_uri_t uri = {.uri = paths[i], .method = i == 0 ? HTTP_GET : HTTP_POST, .handler = handler};
        esp_err_t err = httpd_register_uri_handler(server, &uri);
        if (err != ESP_OK) return err;
    }
    return ESP_OK;
}

void dg_demo_add_json(cJSON *root, const dg_demo_snapshot_t *sample, bool report_simulated)
{
    cJSON *sim = cJSON_AddObjectToObject(root, "simulation");
    /* Publish the source actually consumed by this telemetry sample, not a
     * newer HTTP lease that the control loop has not processed yet. */
    cJSON_AddBoolToObject(sim, "active", sample->active && sample->has_frame);
    cJSON_AddStringToObject(sim, "session_id", sample->session_id);
    cJSON_AddNumberToObject(sim, "input_seq", sample->seq);
    cJSON_AddNumberToObject(sim, "input_age_ms", sample->input_us ? (esp_timer_get_time() - sample->input_us) / 1000 : -1);
    cJSON_AddBoolToObject(sim, "allow_outputs", sample->active && sample->allow_outputs);
    cJSON_AddBoolToObject(sim, "report_contains_simulation", report_simulated);
}
