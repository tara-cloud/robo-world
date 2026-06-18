#pragma once
#include "IDisplay.h"
#include <U8g2lib.h>

/**
 * U8g2Display — IDisplay adapter for any U8g2 display driver.
 *
 * Pass the already-initialised U8g2 instance (any variant).
 * Color: white=true draws with draw color 1, white=false with draw color 0.
 */
template<typename U8G2>
class U8g2Display : public IDisplay {
public:
    explicit U8g2Display(U8G2* u) : _u(u) {}

    bool begin() override { return _u->begin(); }
    void clear()  override { _u->clearBuffer(); }
    void show()   override { _u->sendBuffer(); }

    int width()  const override { return _u->getWidth(); }
    int height() const override { return _u->getHeight(); }

    void fillScreen(bool w) override {
        _u->setDrawColor(w ? 1 : 0);
        _u->drawBox(0, 0, _u->getWidth(), _u->getHeight());
        _u->setDrawColor(1);
    }
    void drawPixel(int x, int y, bool w) override {
        _u->setDrawColor(w ? 1 : 0);
        _u->drawPixel(x, y);
        _u->setDrawColor(1);
    }
    void drawHLine(int x, int y, int len, bool w) override {
        _u->setDrawColor(w ? 1 : 0);
        _u->drawHLine(x, y, len);
        _u->setDrawColor(1);
    }
    void drawVLine(int x, int y, int len, bool w) override {
        _u->setDrawColor(w ? 1 : 0);
        _u->drawVLine(x, y, len);
        _u->setDrawColor(1);
    }
    void drawRect(int x, int y, int pw, int ph, bool w) override {
        _u->setDrawColor(w ? 1 : 0);
        _u->drawFrame(x, y, pw, ph);
        _u->setDrawColor(1);
    }
    void fillRect(int x, int y, int pw, int ph, bool w) override {
        _u->setDrawColor(w ? 1 : 0);
        _u->drawBox(x, y, pw, ph);
        _u->setDrawColor(1);
    }
    void drawRoundRect(int x, int y, int pw, int ph, int r, bool w) override {
        _u->setDrawColor(w ? 1 : 0);
        _u->drawRFrame(x, y, pw, ph, r);
        _u->setDrawColor(1);
    }
    void fillRoundRect(int x, int y, int pw, int ph, int r, bool w) override {
        _u->setDrawColor(w ? 1 : 0);
        _u->drawRBox(x, y, pw, ph, r);
        _u->setDrawColor(1);
    }
    void drawCircle(int x, int y, int r, bool w) override {
        _u->setDrawColor(w ? 1 : 0);
        _u->drawCircle(x, y, r);
        _u->setDrawColor(1);
    }
    void fillCircle(int x, int y, int r, bool w) override {
        _u->setDrawColor(w ? 1 : 0);
        _u->drawDisc(x, y, r);
        _u->setDrawColor(1);
    }
    void drawTriangle(int x0, int y0, int x1, int y1, int x2, int y2, bool w) override {
        _u->setDrawColor(w ? 1 : 0);
        _u->drawLine(x0, y0, x1, y1);
        _u->drawLine(x1, y1, x2, y2);
        _u->drawLine(x2, y2, x0, y0);
        _u->setDrawColor(1);
    }
    void fillTriangle(int x0, int y0, int x1, int y1, int x2, int y2, bool w) override {
        // U8g2 has no filled triangle — approximate with horizontal scanlines
        _u->setDrawColor(w ? 1 : 0);
        int yMin = min({y0, y1, y2});
        int yMax = max({y0, y1, y2});
        for (int sy = yMin; sy <= yMax; sy++) {
            int left = 200, right = -1;
            auto edge = [&](int ax, int ay, int bx, int by) {
                if ((ay <= sy && sy < by) || (by <= sy && sy < ay)) {
                    int x = ax + (bx - ax) * (sy - ay) / (by - ay);
                    left  = min(left,  x);
                    right = max(right, x);
                }
            };
            edge(x0, y0, x1, y1); edge(x1, y1, x2, y2); edge(x2, y2, x0, y0);
            if (right >= left) _u->drawHLine(left, sy, right - left + 1);
        }
        _u->setDrawColor(1);
    }
    void setTextSize(uint8_t s) override {
        // U8g2 doesn't scale like Adafruit — use small font for s=1, large for s>=2
        if (s >= 2) _u->setFont(u8g2_font_ncenB14_tr);
        else        _u->setFont(u8g2_font_6x10_tf);
    }
    void setTextColor(bool /*w*/) override { /* U8g2 uses drawColor, set per-draw */ }
    void setCursor(int x, int y) override { _cx = x; _cy = y + 8; /* U8g2 y is baseline */ }
    void print(const char* t) override {
        _u->setDrawColor(1);
        _u->drawStr(_cx, _cy, t);
    }
    void setContrast(uint8_t c) override { _u->setContrast(c); }

private:
    U8G2* _u;
    int   _cx = 0, _cy = 0;
};
