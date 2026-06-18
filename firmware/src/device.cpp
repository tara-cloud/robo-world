// Tara Robot — device logic
// Display: SH1106 128x64 via U8g2 SW_I2C (SDA=21, SCL=22)
//
// Faces are runtime JSON received via MQTT — no hardcoded graphics.
// Idle animation is handled by TaraExpressions via the U8g2Display adapter.

#include "TaraCore.h"
#include <ArduinoJson.h>
#include <U8g2lib.h>
#include <HTTPUpdate.h>
#include <WiFiClient.h>
#include "U8g2Display.h"
#include "TaraExpressions.h"

// ─── Display + TaraExpressions ───────────────────────────────────────────────
static const int I2C_SCL = 22;
static const int I2C_SDA = 21;

static U8G2_SH1106_128X64_NONAME_F_SW_I2C
    u8g2(U8G2_R0, I2C_SCL, I2C_SDA, U8X8_PIN_NONE);

// Adapter wraps u8g2 into IDisplay so TaraExpressions stays display-agnostic
static U8g2Display<U8G2_SH1106_128X64_NONAME_F_SW_I2C> displayAdapter(&u8g2);
static TaraExpressions taraFace(&displayAdapter);

// ─── Config ───────────────────────────────────────────────────────────────────
static int  displayBrightness = 128;
static int  volume            = 70;
static int  idleTimeout       = 300;

// ─── Emotion state ────────────────────────────────────────────────────────────
struct RobotEmotionState { String state = "idle"; int energy = 50; unsigned long since = 0; };
static RobotEmotionState emotion;

// ─── Cached face JSON per state (loaded from server at boot via config) ────────
// Keys match RobotState names; stored as compact JSON strings
static String cachedFaces[10]; // indexed by RobotState enum

static const char* STATE_NAMES[] = {
    "booting", "connecting", "registering", "configuring",
    "idle", "listening", "thinking", "speaking", "sleeping", "error"
};

// ─── JSON draw engine ─────────────────────────────────────────────────────────

static void execCmd(const JsonObject& cmd) {
    const char* t = cmd["t"] | "";

    if      (strcmp(t, "disc")   == 0) u8g2.drawDisc  (cmd["x"], cmd["y"], cmd["r"]);
    else if (strcmp(t, "circle") == 0) u8g2.drawCircle(cmd["x"], cmd["y"], cmd["r"]);
    else if (strcmp(t, "hline")  == 0) u8g2.drawHLine (cmd["x"], cmd["y"], cmd["w"]);
    else if (strcmp(t, "vline")  == 0) u8g2.drawVLine (cmd["x"], cmd["y"], cmd["h"]);
    else if (strcmp(t, "pixel")  == 0) u8g2.drawPixel (cmd["x"], cmd["y"]);
    else if (strcmp(t, "rbox")   == 0) u8g2.drawRBox  (cmd["x"], cmd["y"], cmd["w"], cmd["h"], cmd["r"] | 0);
    else if (strcmp(t, "rect")   == 0) u8g2.drawFrame (cmd["x"], cmd["y"], cmd["w"], cmd["h"]);
    else if (strcmp(t, "text")   == 0) {
        const char* font = cmd["font"] | "small";
        if (strcmp(font, "large") == 0)  u8g2.setFont(u8g2_font_ncenB14_tr);
        else                             u8g2.setFont(u8g2_font_6x10_tf);
        u8g2.drawStr(cmd["x"], cmd["y"], cmd["s"] | "");
    }
}

static void renderCmds(const String& json) {
    JsonDocument doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return;

    u8g2.clearBuffer();
    JsonArray cmds = doc["cmds"].as<JsonArray>();
    for (JsonObject cmd : cmds) execCmd(cmd);
    u8g2.sendBuffer();
}

static void renderState(RobotState s) {
    const String& json = cachedFaces[(int)s];
    if (json.length() > 0) {
        renderCmds(json);
    } else {
        // Minimal fallback — two dots + line (no hardcoded faces)
        u8g2.clearBuffer();
        u8g2.drawDisc(38, 26, 8);
        u8g2.drawDisc(90, 26, 8);
        u8g2.drawHLine(50, 46, 28);
        u8g2.sendBuffer();
    }
}

// ─── Boot log ─────────────────────────────────────────────────────────────────
static const int LOG_Y_START = 20;
static const int LOG_LINE_H  = 11;
static const int LOG_MAX     = 4;

static String logLines[LOG_MAX];
static int    logCount = 0;

static void redrawBootScreen() {
    u8g2.clearBuffer();
    u8g2.setFont(u8g2_font_ncenB14_tr);
    int logoW = u8g2.getStrWidth("TARA");
    u8g2.drawStr((128 - logoW) / 2, 15, "TARA");
    u8g2.drawHLine(0, 18, 128);
    u8g2.setFont(u8g2_font_6x10_tf);
    int start = (logCount > LOG_MAX) ? logCount - LOG_MAX : 0;
    for (int i = start; i < logCount; i++) {
        int row = i - start;
        u8g2.drawStr(0, LOG_Y_START + row * LOG_LINE_H + 8, logLines[i % LOG_MAX].c_str());
    }
    u8g2.sendBuffer();
}

void tlog(const String& msg) {
    Serial.printf("[tlog] %s\n", msg.c_str());
    logLines[logCount % LOG_MAX] = msg;
    logCount++;
    redrawBootScreen();
}

// ─── Public API ───────────────────────────────────────────────────────────────

void setupDeviceHardware() {
    u8g2.begin();
    u8g2.setContrast((uint8_t)displayBrightness);
    redrawBootScreen();
    Serial.println("[Robot] Hardware ready — SH1106 128x64");
}

void setState(RobotState s) {
    currentState = s;
    renderState(s);
}

void renderIdleFace() {
    taraFace.animateIdle();
}

void applyRobotConfig(const JsonDocument& doc) {
    displayBrightness = doc["displayBrightness"] | displayBrightness;
    volume            = doc["volume"]            | volume;
    idleTimeout       = doc["idleTimeout"]       | idleTimeout;
    u8g2.setContrast((uint8_t)displayBrightness);

    // Load cached face JSON for each state from config
    // Server pushes: { "faces": { "idle": "{cmds:[...]}", "happy": "...", ... } }
    JsonObjectConst faces = doc["faces"].as<JsonObjectConst>();
    if (faces) {
        for (int i = 0; i < 10; i++) {
            const char* name = STATE_NAMES[i];
            if (faces[name].is<const char*>()) {
                cachedFaces[i] = faces[name].as<String>();
            }
        }
        Serial.println("[Robot] Face cache updated from config");
    }
}

void handleDisplay(const String& json) {
    JsonDocument doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return;

    // If "cmds" array present: render directly
    if (doc["cmds"].is<JsonArray>()) {
        Serial.println("[Robot] Display: inline cmds");
        renderCmds(json);
        return;
    }

    // If "face" name present: look up in cache and render
    String faceName = doc["face"] | String("idle");
    Serial.printf("[Robot] Display: face=%s\n", faceName.c_str());

    // Find matching state index
    for (int i = 0; i < 10; i++) {
        if (faceName == STATE_NAMES[i] && cachedFaces[i].length() > 0) {
            renderCmds(cachedFaces[i]);
            return;
        }
    }
    // Unknown face: fallback to STATE_IDLE
    renderState(STATE_IDLE);
}

void handleEmotion(const String& json) {
    JsonDocument doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return;

    emotion.state  = doc["state"]  | emotion.state;
    emotion.energy = doc["energy"] | emotion.energy;
    emotion.since  = millis();

    Serial.printf("[Robot] Emotion: %s energy=%d\n", emotion.state.c_str(), emotion.energy);

    // Map emotion to robot state and render
    RobotState s = STATE_IDLE;
    if      (emotion.state == "listening") s = STATE_LISTENING;
    else if (emotion.state == "thinking")  s = STATE_THINKING;
    else if (emotion.state == "speaking")  s = STATE_SPEAKING;
    else if (emotion.state == "sleeping")  s = STATE_SLEEPING;
    setState(s);
}

void handleSpeech(const String& json) {
    JsonDocument doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return;
    String text = doc["text"] | String("");

    Serial.printf("[Robot] Speech: %s\n", text.c_str());
    setState(STATE_SPEAKING);
    delay(constrain((int)text.length() * 80, 500, 6000));
    setState(STATE_IDLE);
}

void handleOTA(const String& json) {
    JsonDocument doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return;

    String version = doc["version"] | String("");
    String url     = doc["url"]     | String("");

    if (url.length() == 0) {
        Serial.println("[OTA] No URL in payload");
        return;
    }

    Serial.printf("[OTA] Starting update v%s from %s\n", version.c_str(), url.c_str());
    tlog("OTA: v" + version);
    tlog("Downloading...");

    WiFiClient client;

    // Progress callback — show % on OLED
    httpUpdate.onProgress([](int recv, int total) {
        if (total > 0) {
            int pct = (recv * 100) / total;
            static int lastPct = -1;
            if (pct != lastPct && pct % 10 == 0) {
                lastPct = pct;
                // tlog is not accessible here directly, update display inline
                Serial.printf("[OTA] %d%%\n", pct);
            }
        }
    });

    t_httpUpdate_return ret = httpUpdate.update(client, url);

    switch (ret) {
        case HTTP_UPDATE_FAILED:
            Serial.printf("[OTA] Failed: %s\n", httpUpdate.getLastErrorString().c_str());
            tlog("OTA Failed!");
            setState(STATE_ERROR);
            break;

        case HTTP_UPDATE_NO_UPDATES:
            Serial.println("[OTA] No update needed");
            tlog("OTA: up to date");
            setState(STATE_IDLE);
            break;

        case HTTP_UPDATE_OK:
            // Device reboots automatically after this
            Serial.println("[OTA] Success — rebooting");
            tlog("OTA OK! Rebooting");
            break;
    }
}
