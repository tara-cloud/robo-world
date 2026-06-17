// Tara Robot — device logic
// Display: SH1106 128x64 via U8g2 SW_I2C (SDA=21, SCL=22)

#include "TaraCore.h"
#include <ArduinoJson.h>
#include <U8g2lib.h>

// ─── Display ──────────────────────────────────────────────────────────────────
static const int I2C_SCL = 22;
static const int I2C_SDA = 21;

static U8G2_SH1106_128X64_NONAME_F_SW_I2C
    u8g2(U8G2_R0, I2C_SCL, I2C_SDA, U8X8_PIN_NONE);

// ─── Config ───────────────────────────────────────────────────────────────────
static int  displayBrightness = 128;
static int  volume            = 70;
static int  idleTimeout       = 300;

// ─── Emotion engine ───────────────────────────────────────────────────────────
struct EmotionState {
    String state  = "idle";
    int    energy = 50;
    unsigned long since = 0;
};
static EmotionState emotion;

// ─── Draw helpers ─────────────────────────────────────────────────────────────

static void drawEyes(int lx, int ly, int rx, int ry, int r, bool blink = false) {
    if (blink) {
        u8g2.drawHLine(lx - r, ly, r * 2);
        u8g2.drawHLine(rx - r, ry, r * 2);
    } else {
        u8g2.drawDisc(lx, ly, r);
        u8g2.drawDisc(rx, ry, r);
    }
}

// ─── Face templates ───────────────────────────────────────────────────────────

static void faceIdle() {
    u8g2.clearBuffer();
    drawEyes(38, 26, 90, 26, 9);
    u8g2.drawHLine(52, 46, 24);
    u8g2.sendBuffer();
}

static void faceHappy() {
    u8g2.clearBuffer();
    drawEyes(38, 24, 90, 24, 9);
    u8g2.drawDisc(26, 38, 5);
    u8g2.drawDisc(102, 38, 5);
    u8g2.drawHLine(50, 46, 28);
    u8g2.drawPixel(50, 47);
    u8g2.drawPixel(77, 47);
    u8g2.sendBuffer();
}

static void faceSad() {
    u8g2.clearBuffer();
    drawEyes(38, 28, 90, 28, 8);
    u8g2.drawHLine(52, 48, 24);
    u8g2.drawPixel(52, 47);
    u8g2.drawPixel(75, 47);
    u8g2.sendBuffer();
}

static void faceThinking() {
    u8g2.clearBuffer();
    u8g2.drawDisc(38, 22, 9);
    u8g2.drawDisc(90, 18, 9);
    for (int i = 0; i < 3; i++)
        u8g2.drawDisc(54 + i * 10, 50, 2);
    u8g2.sendBuffer();
}

static void faceSleeping() {
    u8g2.clearBuffer();
    drawEyes(38, 26, 90, 26, 9, true);
    u8g2.setFont(u8g2_font_6x10_tf);
    u8g2.drawStr(96, 18, "z");
    u8g2.drawStr(104, 12, "z");
    u8g2.drawStr(112, 6,  "z");
    u8g2.sendBuffer();
}

static void faceListening() {
    u8g2.clearBuffer();
    drawEyes(38, 26, 90, 26, 11);
    u8g2.drawCircle(64, 48, 6);
    u8g2.sendBuffer();
}

static void faceSpeaking() {
    u8g2.clearBuffer();
    drawEyes(38, 26, 90, 26, 9);
    u8g2.drawRBox(50, 42, 28, 12, 4);
    u8g2.sendBuffer();
}

static void faceError() {
    u8g2.clearBuffer();
    for (int d = -6; d <= 6; d++) {
        u8g2.drawPixel(38 + d, 26 + d);
        u8g2.drawPixel(38 + d, 26 - d);
        u8g2.drawPixel(90 + d, 26 + d);
        u8g2.drawPixel(90 + d, 26 - d);
    }
    u8g2.drawHLine(54, 46, 20);
    u8g2.sendBuffer();
}

static void renderFace(const String& face) {
    if      (face == "happy")     faceHappy();
    else if (face == "sad")       faceSad();
    else if (face == "thinking")  faceThinking();
    else if (face == "sleeping")  faceSleeping();
    else if (face == "listening") faceListening();
    else if (face == "speaking")  faceSpeaking();
    else if (face == "error")     faceError();
    else                          faceIdle();
}

// ─── Boot log ─────────────────────────────────────────────────────────────────
// Layout: "TARA" logo (top 18px) + divider + 4 scrolling log lines

static const int LOG_Y_START = 20;
static const int LOG_LINE_H  = 11;
static const int LOG_MAX     = 4;

static String logLines[LOG_MAX];
static int    logCount = 0;

static void redrawBootScreen() {
    u8g2.clearBuffer();

    // Logo
    u8g2.setFont(u8g2_font_ncenB14_tr);
    int logoW = u8g2.getStrWidth("TARA");
    u8g2.drawStr((128 - logoW) / 2, 15, "TARA");

    // Divider
    u8g2.drawHLine(0, 18, 128);

    // Log lines (font ascent ~8px, y is baseline)
    u8g2.setFont(u8g2_font_6x10_tf);
    int start = (logCount > LOG_MAX) ? logCount - LOG_MAX : 0;
    for (int i = start; i < logCount; i++) {
        int row = i - start;
        u8g2.drawStr(0, LOG_Y_START + row * LOG_LINE_H + 8,
                     logLines[i % LOG_MAX].c_str());
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
    switch (s) {
        case STATE_BOOTING:
        case STATE_SLEEPING:    faceSleeping();  break;
        case STATE_CONNECTING:
        case STATE_REGISTERING:
        case STATE_CONFIGURING:
        case STATE_THINKING:    faceThinking();  break;
        case STATE_IDLE:        faceIdle();      break;
        case STATE_LISTENING:   faceListening(); break;
        case STATE_SPEAKING:    faceSpeaking();  break;
        case STATE_ERROR:       faceError();     break;
    }
}

void renderIdleFace() {
    static unsigned long lastBlink = 0;
    static bool isBlinking = false;
    unsigned long now = millis();

    if (!isBlinking && now - lastBlink > 4000) {
        isBlinking = true;
        lastBlink  = now;
        u8g2.clearBuffer();
        drawEyes(38, 26, 90, 26, 9, true);
        u8g2.drawHLine(52, 46, 24);
        u8g2.sendBuffer();
    } else if (isBlinking && now - lastBlink > 120) {
        isBlinking = false;
        faceIdle();
    }
}

void applyRobotConfig(const JsonDocument& doc) {
    displayBrightness = doc["displayBrightness"] | displayBrightness;
    volume            = doc["volume"]            | volume;
    idleTimeout       = doc["idleTimeout"]       | idleTimeout;
    u8g2.setContrast((uint8_t)displayBrightness);
}

void handleDisplay(const String& json) {
    JsonDocument doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return;
    String face = doc["face"] | String("idle");
    Serial.printf("[Robot] Display: %s\n", face.c_str());
    renderFace(face);
}

void handleEmotion(const String& json) {
    JsonDocument doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return;

    emotion.state  = doc["state"]  | emotion.state;
    emotion.energy = doc["energy"] | emotion.energy;
    emotion.since  = millis();

    Serial.printf("[Robot] Emotion: %s energy=%d\n",
        emotion.state.c_str(), emotion.energy);

    renderFace(emotion.state);

    if      (emotion.state == "listening") setState(STATE_LISTENING);
    else if (emotion.state == "thinking")  setState(STATE_THINKING);
    else if (emotion.state == "speaking")  setState(STATE_SPEAKING);
    else if (emotion.state == "sleeping")  setState(STATE_SLEEPING);
    else                                   setState(STATE_IDLE);
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
    Serial.printf("[Robot] OTA: v%s\n", (const char*)doc["version"]);
    // TODO: esp_https_ota()
}
