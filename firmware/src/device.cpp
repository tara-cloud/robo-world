// Tara Robot — device logic
// OLED display, emotion engine, speech stub (Phase 1)

#include "TaraCore.h"
#include <ArduinoJson.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>

// ─── OLED ─────────────────────────────────────────────────────────────────────
static const int OLED_W    = 128;
static const int OLED_H    = 64;
static const int OLED_RST  = -1;
static const int I2C_SDA   = 21;
static const int I2C_SCL   = 22;
static Adafruit_SSD1306 display(OLED_W, OLED_H, &Wire, OLED_RST);

// ─── Config ───────────────────────────────────────────────────────────────────
static int  displayBrightness = 80;
static int  volume            = 70;
static int  idleTimeout       = 300;

// ─── Emotion engine ───────────────────────────────────────────────────────────
struct EmotionState {
    String state  = "idle";
    int    energy = 50;
    unsigned long since = 0;
};
static EmotionState emotion;

// ─── Helpers ──────────────────────────────────────────────────────────────────

static void drawEyes(int lx, int ly, int rx, int ry, int r, bool blink = false) {
    if (blink) {
        display.drawFastHLine(lx - r, ly, r * 2, SSD1306_WHITE);
        display.drawFastHLine(rx - r, ry, r * 2, SSD1306_WHITE);
    } else {
        display.fillCircle(lx, ly, r, SSD1306_WHITE);
        display.fillCircle(rx, ry, r, SSD1306_WHITE);
    }
}

static void drawMouth(int cx, int cy, int w, int h, bool smile) {
    if (smile) {
        // arc approximation: draw three downward segments
        display.drawFastHLine(cx - w/2, cy,     w,     SSD1306_WHITE);
        display.drawPixel(cx - w/2, cy + 1,                SSD1306_WHITE);
        display.drawPixel(cx + w/2 - 1, cy + 1,            SSD1306_WHITE);
    } else {
        display.drawFastHLine(cx - w/2, cy, w, SSD1306_WHITE);
    }
}

// ─── Face templates ───────────────────────────────────────────────────────────

static void faceClear() {
    display.clearDisplay();
}

static void faceIdle() {
    faceClear();
    drawEyes(38, 26, 90, 26, 9);
    drawMouth(64, 46, 24, 4, false);
    display.display();
}

static void faceHappy() {
    faceClear();
    drawEyes(38, 24, 90, 24, 9);
    // raised cheeks
    display.fillCircle(26, 38, 5, SSD1306_WHITE);
    display.fillCircle(102, 38, 5, SSD1306_WHITE);
    drawMouth(64, 46, 28, 6, true);
    display.display();
}

static void faceSad() {
    faceClear();
    // drooping inner corners
    display.fillCircle(38, 28, 8, SSD1306_WHITE);
    display.fillCircle(90, 28, 8, SSD1306_WHITE);
    // frown
    display.drawFastHLine(64 - 12, 48, 24, SSD1306_WHITE);
    display.drawPixel(64 - 12, 47, SSD1306_WHITE);
    display.drawPixel(64 + 11, 47, SSD1306_WHITE);
    display.display();
}

static void faceThinking() {
    faceClear();
    // one eye looking up-right
    display.fillCircle(38, 22, 9, SSD1306_WHITE);
    display.fillCircle(90, 18, 9, SSD1306_WHITE);
    // dots ...
    for (int i = 0; i < 3; i++)
        display.fillCircle(54 + i * 10, 50, 2, SSD1306_WHITE);
    display.display();
}

static void faceSleeping() {
    faceClear();
    drawEyes(38, 26, 90, 26, 9, true); // blink = closed lines
    // "z z z"
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(96, 10); display.print("z");
    display.setCursor(104, 4); display.print("z");
    display.setCursor(112, 0); display.print("z");
    display.display();
}

static void faceListening() {
    faceClear();
    // wider eyes
    drawEyes(38, 26, 90, 26, 11);
    // open mouth
    display.drawCircle(64, 48, 6, SSD1306_WHITE);
    display.display();
}

static void faceSpeaking() {
    faceClear();
    drawEyes(38, 26, 90, 26, 9);
    // animated open mouth (static frame)
    display.fillRoundRect(50, 42, 28, 12, 4, SSD1306_WHITE);
    display.display();
}

static void faceError() {
    faceClear();
    // X eyes
    for (int d = -6; d <= 6; d++) {
        display.drawPixel(38 + d, 26 + d,  SSD1306_WHITE);
        display.drawPixel(38 + d, 26 - d,  SSD1306_WHITE);
        display.drawPixel(90 + d, 26 + d,  SSD1306_WHITE);
        display.drawPixel(90 + d, 26 - d,  SSD1306_WHITE);
    }
    // flat mouth
    drawMouth(64, 46, 20, 0, false);
    display.display();
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

// ─── Public API ───────────────────────────────────────────────────────────────

// ─── Boot log ─────────────────────────────────────────────────────────────────
// Layout: logo banner (top 20 px) + divider + up to 4 scrolling log lines below.

static const int LOG_Y_START = 22;  // y below divider
static const int LOG_LINE_H  = 10;  // px per log line (textSize 1 = 8px + 2 gap)
static const int LOG_MAX     = 4;   // lines visible

static String logLines[LOG_MAX];
static int    logCount = 0;

static void redrawBootScreen() {
    display.clearDisplay();

    // ── Logo banner ──────────────────────────────────────────────────────────
    display.setTextSize(2);
    display.setTextColor(SSD1306_WHITE);
    // "TARA" centred
    int16_t bx, by; uint16_t bw, bh;
    display.getTextBounds("TARA", 0, 0, &bx, &by, &bw, &bh);
    display.setCursor((OLED_W - bw) / 2, 2);
    display.print("TARA");

    // Thin divider under logo
    display.drawFastHLine(0, 19, OLED_W, SSD1306_WHITE);

    // ── Log lines ────────────────────────────────────────────────────────────
    display.setTextSize(1);
    int start = max(0, logCount - LOG_MAX);
    for (int i = start; i < logCount; i++) {
        int row = i - start;
        display.setCursor(0, LOG_Y_START + row * LOG_LINE_H);
        display.print(logLines[i % LOG_MAX]);
    }

    display.display();
}

void tlog(const String& msg) {
    Serial.printf("[tlog] %s\n", msg.c_str());
    logLines[logCount % LOG_MAX] = msg;
    logCount++;
    redrawBootScreen();
}

void setupDeviceHardware() {
    Wire.begin(I2C_SDA, I2C_SCL);

    // Try 0x3C first, fall back to 0x3D
    bool ok = display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
    if (!ok) ok = display.begin(SSD1306_SWITCHCAPVCC, 0x3D);
    if (!ok) {
        Serial.println("[Robot] OLED not found");
        return;
    }
    display.ssd1306_command(SSD1306_SETCONTRAST);
    display.ssd1306_command((uint8_t)map(displayBrightness, 0, 100, 0, 255));
    redrawBootScreen();
    Serial.println("[Robot] Hardware ready");
}

void setState(RobotState s) {
    currentState = s;
    // Mirror state onto OLED immediately
    switch (s) {
        case STATE_BOOTING:     faceSleeping();  break;
        case STATE_CONNECTING:
        case STATE_REGISTERING:
        case STATE_CONFIGURING: faceThinking();  break;
        case STATE_IDLE:        faceIdle();      break;
        case STATE_LISTENING:   faceListening(); break;
        case STATE_THINKING:    faceThinking();  break;
        case STATE_SPEAKING:    faceSpeaking();  break;
        case STATE_SLEEPING:    faceSleeping();  break;
        case STATE_ERROR:       faceError();     break;
    }
}

void renderIdleFace() {
    // Blink every ~4 s
    static unsigned long lastBlink = 0;
    static bool isBlinking = false;
    unsigned long now = millis();

    if (!isBlinking && now - lastBlink > 4000) {
        isBlinking = true;
        lastBlink  = now;
        faceClear();
        drawEyes(38, 26, 90, 26, 9, true);
        drawMouth(64, 46, 24, 4, false);
        display.display();
    } else if (isBlinking && now - lastBlink > 120) {
        isBlinking = false;
        faceIdle();
    }
}

void applyRobotConfig(const JsonDocument& doc) {
    displayBrightness = doc["displayBrightness"] | displayBrightness;
    volume            = doc["volume"]            | volume;
    idleTimeout       = doc["idleTimeout"]       | idleTimeout;
    display.ssd1306_command(SSD1306_SETCONTRAST);
    display.ssd1306_command((uint8_t)map(displayBrightness, 0, 100, 0, 255));
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

    // Map emotion state → face
    renderFace(emotion.state);

    // Map emotion → robot state
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

    // TODO: I2S / DAC audio playback
    // For now just show the speaking face for the text duration (~100ms/char)
    delay(constrain((int)text.length() * 80, 500, 6000));

    setState(STATE_IDLE);
}

void handleOTA(const String& json) {
    JsonDocument doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return;
    String version = doc["version"] | String("");
    String url     = doc["url"]     | String("");

    Serial.printf("[Robot] OTA: v%s from %s\n", version.c_str(), url.c_str());
    // TODO: esp_https_ota()
}
