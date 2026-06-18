#include "TaraExpressions.h"

// Out-of-line definitions required by C++14 for constexpr static members
constexpr TaraExpressions::Eye TaraExpressions::LEFT;
constexpr TaraExpressions::Eye TaraExpressions::RIGHT;

// ─── Constructor ────────────────────────────────────────────────────────────

TaraExpressions::TaraExpressions(IDisplay* display) : _d(display) {
    _nextBlinkMs = millis() + _nextBlink();
}

// ─── Static expressions ─────────────────────────────────────────────────────

void TaraExpressions::idle() {
    _currentExpr = EXPR_IDLE;
    _d->clear();
    _drawEyes(0.0f, _pupilDX, _pupilDY);
    _render();
}

void TaraExpressions::happy() {
    _currentExpr = EXPR_HAPPY;
    _d->clear();
    // Eyes raised slightly, squinted from below (joy squint)
    _drawEyes(0.0f, 0, -2, false, true, true);
    // Cheek blush dots
    for (int i = 0; i < 3; i++) {
        _d->fillCircle(18 + i * 5, 46, 2, true);
        _d->fillCircle(100 + i * 5, 46, 2, true);
    }
    _drawSmile(64, 54, 32, 5);
    _render();
}

void TaraExpressions::sad() {
    _currentExpr = EXPR_SAD;
    _d->clear();
    // Eyes look down, brows inner-corner low
    _drawEyes(0.15f, 0, 3);
    _drawBrow(LEFT,  -14, -3);
    _drawBrow(RIGHT, -14,  3);
    _drawFrown(64, 56, 26, 4);
    // Tear drops
    _d->fillCircle(LEFT.cx + 8,  LEFT.cy  + 14, 3, true);
    _d->fillCircle(LEFT.cx + 8,  LEFT.cy  + 10, 2, true);
    _render();
}

void TaraExpressions::listening() {
    _currentExpr = EXPR_LISTENING;
    _d->clear();
    // Wide open eyes, pupils centred
    _drawEyes(0.0f, 0, 0, false, false, false);
    // Sound-wave arcs on right side
    for (int r = 6; r <= 14; r += 4) {
        _d->drawCircle(118, 32, r, true);
        // Erase the left half of each arc to make it a half-arc
        _d->fillRect(104, 32 - r - 1, r + 2, r * 2 + 2, false);
    }
    _drawOvalMouth(64, 55, 14, 10);
    _render();
}

void TaraExpressions::thinking() {
    _currentExpr = EXPR_THINKING;
    _d->clear();
    // Eyes drift up-right, one higher
    _drawEye(LEFT,  0.0f, 3, -4, false, false, false);
    _drawEye(RIGHT, 0.0f, 3, -7, false, false, false);
    // Raised right brow
    _drawBrow(RIGHT, -16, 0);
    // Thought dots
    for (int i = 0; i < 3; i++)
        _d->fillCircle(52 + i * 10, 56, 2 + i, true);
    _render();
}

void TaraExpressions::speaking() {
    _currentExpr = EXPR_SPEAKING;
    _d->clear();
    _drawEyes(0.0f, _pupilDX, _pupilDY);
    _drawOvalMouth(64, 54, 28, 14);
    _render();
}

void TaraExpressions::sleeping() {
    _currentExpr = EXPR_SLEEPING;
    _d->clear();
    // Eyes: fully closed = heavy eyelid lines
    for (const auto& e : {LEFT, RIGHT}) {
        // Outer eye shape (dark — erased)
        _d->fillRoundRect(e.cx - e.w/2, e.cy - e.h/2, e.w, e.h, e.r, false);
        // Closed-eye curve: thick arc line
        _d->drawHLine(e.cx - e.w/2 + 2, e.cy, e.w - 4, true);
        _d->drawHLine(e.cx - e.w/2 + 4, e.cy + 1, e.w - 8, true);
    }
    // ZZZ
    _d->setTextSize(1); _d->setTextColor(true);
    _d->setCursor(98, 12); _d->print("z");
    _d->setCursor(104, 6); _d->print("Z");
    _d->setCursor(112, 1); _d->print("Z");
    _render();
}

void TaraExpressions::surprised() {
    _currentExpr = EXPR_SURPRISED;
    _d->clear();
    // Very wide eyes — scale up height
    for (const auto& e : {LEFT, RIGHT}) {
        _d->drawRoundRect(e.cx - e.w/2 - 2, e.cy - e.h/2 - 4,
                          e.w + 4, e.h + 8, e.r, true);
        _d->fillCircle(e.cx, e.cy, 5, true);
        _d->fillCircle(e.cx + 2, e.cy - 2, 2, false); // highlight
    }
    // Raised high brows
    _drawBrow(LEFT,  -20, 0);
    _drawBrow(RIGHT, -20, 0);
    _drawOvalMouth(64, 56, 16, 14);
    _render();
}

void TaraExpressions::angry() {
    _currentExpr = EXPR_ANGRY;
    _d->clear();
    // Eyes squinted, angry inner-corner brows
    _drawEyes(0.35f, 0, 0, true, false, false);
    _drawBrow(LEFT,  -13,  3);
    _drawBrow(RIGHT, -13, -3);
    _drawFrown(64, 56, 28, 5);
    _render();
}

void TaraExpressions::error() {
    _currentExpr = EXPR_ERROR;
    _d->clear();
    // X eyes
    for (const auto& e : {LEFT, RIGHT}) {
        for (int d = -7; d <= 7; d++) {
            _d->drawPixel(e.cx + d, e.cy + d, true);
            _d->drawPixel(e.cx + d, e.cy - d, true);
        }
    }
    _drawFrown(64, 57, 22, 3);
    // Warning lines
    _d->drawHLine(0, 62, 128, true);
    _d->setTextSize(1); _d->setTextColor(true);
    _d->setCursor(45, 2); _d->print("ERROR");
    _render();
}

void TaraExpressions::show(Expression expr) {
    switch (expr) {
        case EXPR_IDLE:      idle();      break;
        case EXPR_HAPPY:     happy();     break;
        case EXPR_SAD:       sad();       break;
        case EXPR_LISTENING: listening(); break;
        case EXPR_THINKING:  thinking();  break;
        case EXPR_SPEAKING:  speaking();  break;
        case EXPR_SLEEPING:  sleeping();  break;
        case EXPR_SURPRISED: surprised(); break;
        case EXPR_ANGRY:     angry();     break;
        case EXPR_ERROR:     error();     break;
    }
}

// ─── Eye movements ────────────────────────────────────────────────────────

void TaraExpressions::blink() {
    // Quick 3-frame blink
    for (float lid : {0.5f, 1.0f, 0.5f}) {
        _d->clear();
        _drawEyes(lid, _pupilDX, _pupilDY);
        _render();
        delay(40);
    }
    // Restore
    show(_currentExpr);
}

void TaraExpressions::lookLeft()  { _pupilDX = -4; _pupilDY = 0; show(_currentExpr); }
void TaraExpressions::lookRight() { _pupilDX =  4; _pupilDY = 0; show(_currentExpr); }
void TaraExpressions::lookUp()    { _pupilDX = 0; _pupilDY = -3; show(_currentExpr); }
void TaraExpressions::lookDown()  { _pupilDX = 0; _pupilDY =  3; show(_currentExpr); }

// ─── Animations ───────────────────────────────────────────────────────────

void TaraExpressions::animateIdle() {
    unsigned long now = millis();

    // Blink on schedule
    if (!_isBlinking && now >= _nextBlinkMs) {
        _isBlinking = true;
        _lastAnimMs = now;
    }
    if (_isBlinking) {
        unsigned long elapsed = now - _lastAnimMs;
        float lid = (elapsed < 60) ? (float)elapsed / 60.0f
                  : (elapsed < 120) ? 1.0f
                  : (elapsed < 180) ? 1.0f - (float)(elapsed - 120) / 60.0f
                  : 0.0f;
        if (elapsed >= 180) {
            _isBlinking  = false;
            _nextBlinkMs = now + _nextBlink();
            lid = 0.0f;
        }
        _d->clear();
        _drawEyes(lid, _pupilDX, _pupilDY);
        _render();
        return;
    }

    // Subtle drift every 3 s
    if (now - _lastAnimMs > 3000) {
        static const int drifts[][2] = {{-2,0},{2,0},{0,-1},{0,1},{0,0}};
        _animStep = (_animStep + 1) % 5;
        _pupilDX  = drifts[_animStep][0];
        _pupilDY  = drifts[_animStep][1];
        _lastAnimMs = now;
        idle();
    }
}

void TaraExpressions::animateThinking() {
    unsigned long now = millis();
    if (now - _lastAnimMs < 400) return;
    _lastAnimMs = now;

    // Scan L → centre → R → centre
    static const int steps[][2] = {{-5,-3},{0,-3},{5,-3},{0,-3}};
    _animStep = (_animStep + 1) % 4;
    _d->clear();
    // Both eyes track together slightly staggered
    _drawEye(LEFT,  0.0f, steps[_animStep][0], steps[_animStep][1], false, false, false);
    _drawEye(RIGHT, 0.0f, steps[_animStep][0], steps[_animStep][1], false, false, false);
    _drawBrow(RIGHT, -16, 0);
    for (int i = 0; i < 3; i++)
        _d->fillCircle(52 + i * 10, 56, 2 + i, true);
    _render();
}

void TaraExpressions::animateSpeaking() {
    unsigned long now = millis();
    if (now - _lastAnimMs < 200) return;
    _lastAnimMs = now;

    _animStep = (_animStep + 1) % 4;
    // Mouth heights for each step: 6, 12, 8, 4
    static const int mh[] = {6, 12, 8, 4};
    static const int ey[] = {0, -2, 0, 1}; // subtle eye bounce

    _d->clear();
    _drawEyes(0.0f, 0, ey[_animStep]);
    _d->fillRoundRect(64 - 14, 48 + ey[_animStep], 28, mh[_animStep], 4, true);
    _render();
}

// ─── Emotion engine ──────────────────────────────────────────────────────

void TaraExpressions::update(const EmotionState& state) {
    Expression expr = EXPR_IDLE;

    if (state.sleepiness > 70)                          expr = EXPR_SLEEPING;
    else if (state.happiness > 70)                      expr = EXPR_HAPPY;
    else if (state.happiness < 25)                      expr = EXPR_SAD;
    else if (state.attention > 75 && state.energy > 60) expr = EXPR_SURPRISED;
    else if (state.energy < 20)                         expr = EXPR_SLEEPING;
    else                                                expr = EXPR_IDLE;

    show(expr);
}

// ─── Private drawing helpers ────────────────────────────────────────────────

void TaraExpressions::_drawEye(const Eye& e,
                                float lidFrac,
                                int   pupilDX, int pupilDY,
                                bool  archTop,
                                bool  squint,
                                bool  excited) {
    int ex = e.cx - e.w / 2;
    int ey = e.cy - e.h / 2;
    int ew = e.w;
    int eh = e.h;

    // Excited = taller eye
    if (excited) { ey -= 3; eh += 6; }

    // Outer eye shape
    _d->drawRoundRect(ex, ey, ew, eh, e.r, true);

    // Squint: fill bottom strip
    if (squint) {
        int sq = eh / 3;
        _d->fillRect(ex + 1, ey + eh - sq, ew - 2, sq + 1, false);
        _d->drawHLine(ex + 1, ey + eh - sq, ew - 2, true);
    }

    // Arch top: fill top-left/right corners to give angled inner-corner
    if (archTop) {
        _d->fillRect(ex,            ey, e.r + 2, e.r + 1, false);
        _d->fillRect(ex + ew - e.r - 2, ey, e.r + 2, e.r + 1, false);
    }

    // Eyelid (fills from top, covering lidFrac of eye height)
    if (lidFrac > 0.0f) {
        int lidH = (int)(eh * lidFrac) + 1;
        _d->fillRect(ex + 1, ey, ew - 2, lidH, false);
        // Lid edge
        _d->drawHLine(ex + 1, ey + lidH, ew - 2, true);
    }

    // Pupil (filled round rect, smaller than eye)
    int pw = 10, ph = 10;
    int px = e.cx - pw / 2 + pupilDX;
    int py = e.cy - ph / 2 + pupilDY;
    // Clamp pupil inside eye
    px = constrain(px, ex + 3, ex + ew - pw - 3);
    py = constrain(py, ey + 3, ey + eh - ph - 3);
    _d->fillRoundRect(px, py, pw, ph, 3, true);

    // Specular highlight dot
    _d->fillCircle(px + pw - 3, py + 2, 2, false);
}

void TaraExpressions::_drawEyes(float lidFrac,
                                 int   pupilDX, int pupilDY,
                                 bool  archTop, bool squint, bool excited) {
    _drawEye(LEFT,  lidFrac, pupilDX, pupilDY, archTop, squint, excited);
    _drawEye(RIGHT, lidFrac, pupilDX, pupilDY, archTop, squint, excited);
}

void TaraExpressions::_drawBrow(const Eye& e, int yOffset, int tilt) {
    // Brow is a short filled rectangle with an optional tilt
    int bx = e.cx - 14;
    int by = e.cy + yOffset;
    int bw = 28;
    int bh = 3;

    if (tilt == 0) {
        _d->fillRoundRect(bx, by, bw, bh, 1, true);
        return;
    }

    // Tilted: draw as two overlapping horizontal lines offset by tilt
    int mid = bw / 2;
    // Inner half
    _d->fillRect(bx,       by + (tilt > 0 ? -tilt : 0), mid, bh, true);
    // Outer half
    _d->fillRect(bx + mid, by + (tilt < 0 ? tilt  : 0), mid, bh, true);
}

void TaraExpressions::_drawSmile(int cx, int cy, int w, int depth) {
    // Approximate smile: flat line + two descending pixels at corners
    _d->drawHLine(cx - w/2, cy, w, true);
    for (int i = 1; i <= depth; i++) {
        _d->drawPixel(cx - w/2 + i - 1, cy + i, true);
        _d->drawPixel(cx + w/2 - i,     cy + i, true);
    }
}

void TaraExpressions::_drawFrown(int cx, int cy, int w, int depth) {
    _d->drawHLine(cx - w/2, cy, w, true);
    for (int i = 1; i <= depth; i++) {
        _d->drawPixel(cx - w/2 + i - 1, cy - i, true);
        _d->drawPixel(cx + w/2 - i,     cy - i, true);
    }
}

void TaraExpressions::_drawFlat(int cx, int cy, int w) {
    _d->drawHLine(cx - w/2, cy, w, true);
}

void TaraExpressions::_drawOvalMouth(int cx, int cy, int w, int h) {
    _d->drawRoundRect(cx - w/2, cy - h/2, w, h, h/2, true);
    // Fill interior black (open mouth look)
    _d->fillRoundRect(cx - w/2 + 1, cy - h/2 + 1, w - 2, h - 2, h/2 - 1, false);
}

void TaraExpressions::_render() {
    _d->show();
}

unsigned long TaraExpressions::_nextBlink() {
    // Blink every 3–6 seconds
    return 3000UL + (unsigned long)(random(0, 3000));
}
