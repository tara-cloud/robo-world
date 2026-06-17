#!/usr/bin/env python3
"""
Push all Tara Robot emotion expressions to the server.
Run: python3 push_faces.py
"""

import json, urllib.request, urllib.error

SERVER = "http://192.168.0.107:4000"

# ─── Canvas: 128×64 SH1106 OLED ───────────────────────────────────────────────
# Eyes centred at x=36 (left) and x=92 (right), baseline y=28
# Mouth centre x=64, y=46-52
# Eyebrows at y=14-18

def put_face(name, label, cmds):
    url  = f"{SERVER}/faces/{name}"
    body = json.dumps({"label": label, "cmds": cmds}).encode()
    req  = urllib.request.Request(url, data=body, method="PUT",
                                   headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            print(f"  ✓  {name:14s}  ({r.status})")
    except urllib.error.HTTPError as e:
        print(f"  ✗  {name:14s}  HTTP {e.code}: {e.read().decode()}")

# ── Helper: eye pixel art ──────────────────────────────────────────────────────
def disc(x, y, r):             return {"t":"disc",   "x":x,"y":y,"r":r}
def circle(x, y, r):           return {"t":"circle", "x":x,"y":y,"r":r}
def hline(x, y, w):            return {"t":"hline",  "x":x,"y":y,"w":w}
def vline(x, y, h):            return {"t":"vline",  "x":x,"y":y,"h":h}
def px(x, y):                  return {"t":"pixel",  "x":x,"y":y}
def rbox(x, y, w, h, r=3):    return {"t":"rbox",   "x":x,"y":y,"w":w,"h":h,"r":r}
def rect(x, y, w, h):          return {"t":"rect",   "x":x,"y":y,"w":w,"h":h}
def text(x, y, s, font="small"): return {"t":"text", "x":x,"y":y,"s":s,"font":font}

# Closed eye (blink) = hline
def eye_closed(cx, cy, w=16): return hline(cx - w//2, cy, w)
# Raised eyebrow = hline above eye
def brow(cx, cy, w=14, tilt=0):
    # tilt>0 = inner corner raised (angry), tilt<0 = outer corner raised (sad)
    cmds = [hline(cx - w//2, cy, w)]
    if tilt > 0:   cmds.append(hline(cx - w//2, cy - 1, tilt))   # inner up
    if tilt < 0:   cmds.append(hline(cx + w//2 + tilt, cy - 1, -tilt))  # outer up
    return cmds
def flat_brow(cx, cy, w=14):  return [hline(cx - w//2, cy, w)]
def angry_brow(cx_l, cx_r, cy, w=14):
    # inner corners down on each side
    step = 3
    return [
        hline(cx_l - w//2,      cy,        w//2),
        hline(cx_l,             cy + step, w//2),
        hline(cx_r - w//2,      cy + step, w//2),
        hline(cx_r,             cy,        w//2),
    ]
def sad_brow(cx_l, cx_r, cy, w=14):
    # outer corners down on each side
    step = 3
    return [
        hline(cx_l - w//2, cy + step, w//2),
        hline(cx_l,        cy,        w//2),
        hline(cx_r - w//2, cy,        w//2),
        hline(cx_r,        cy + step, w//2),
    ]

# Mouth shapes
def mouth_flat(cx, cy, w=24):  return [hline(cx - w//2, cy, w)]
def mouth_smile(cx, cy, w=28):
    return [
        hline(cx - w//2, cy,   w),
        px(cx - w//2, cy - 1), px(cx + w//2 - 1, cy - 1),
    ]
def mouth_smile_big(cx, cy, w=32):
    return [
        hline(cx - w//2, cy,   w),
        hline(cx - w//2 + 2, cy - 1, w - 4),
        px(cx - w//2, cy - 1), px(cx + w//2 - 1, cy - 1),
        px(cx - w//2 + 1, cy - 2), px(cx + w//2 - 2, cy - 2),
    ]
def mouth_frown(cx, cy, w=28):
    return [
        hline(cx - w//2, cy,   w),
        px(cx - w//2, cy + 1), px(cx + w//2 - 1, cy + 1),
    ]
def mouth_open_o(cx, cy, r=7):  return [circle(cx, cy, r)]
def mouth_open_rect(cx, cy, w=26, h=12): return [rbox(cx - w//2, cy - h//2, w, h, 4)]
def mouth_grin(cx, cy, w=32, h=10):
    # wide open smile
    return [
        hline(cx - w//2, cy,      w),
        hline(cx - w//2 + 1, cy - 1, w - 2),
        hline(cx - w//2 + 3, cy - 2, w - 6),
        hline(cx - w//2 + 5, cy - 3, w - 10),
        px(cx - w//2, cy + 1), px(cx + w//2 - 1, cy + 1),
    ]
def mouth_zigzag(cx, cy, w=28):  # nervous
    half = w // 2
    cmds = []
    for i in range(half):
        y_off = 1 if i % 2 == 0 else 0
        cmds.append(px(cx - half + i*2,     cy + y_off))
        cmds.append(px(cx - half + i*2 + 1, cy + (1 - y_off)))
    return cmds

# ─── Face definitions ──────────────────────────────────────────────────────────
LX, RX, EY = 36, 92, 28   # eye centres
MX, MY = 64, 48            # mouth centre

faces = []

# ── IDLE ──────────────────────────────────────────────────────────────────────
faces.append(("idle", "Idle", [
    disc(LX, EY, 9),
    disc(RX, EY, 9),
    *mouth_flat(MX, MY),
]))

# ── HAPPY ─────────────────────────────────────────────────────────────────────
faces.append(("happy", "Happy", [
    disc(LX, EY - 2, 9),
    disc(RX, EY - 2, 9),
    disc(22, 40, 5),    # cheek left
    disc(106, 40, 5),   # cheek right
    *mouth_smile_big(MX, MY),
]))

# ── SAD ───────────────────────────────────────────────────────────────────────
faces.append(("sad", "Sad", [
    disc(LX, EY + 2, 8),
    disc(RX, EY + 2, 8),
    *sad_brow(LX, RX, 14),
    *mouth_frown(MX, MY + 2),
    # tear drop
    disc(LX + 10, EY + 14, 2),
    vline(LX + 10, EY + 10, 5),
]))

# ── THINKING ──────────────────────────────────────────────────────────────────
faces.append(("thinking", "Thinking", [
    disc(LX, EY - 4, 9),        # left eye looks up
    disc(RX, EY - 8, 9),        # right eye looks further up
    # thought dots
    disc(54, 52, 2),
    disc(64, 52, 2),
    disc(74, 52, 2),
    # single raised brow on right
    hline(RX - 7, 12, 14),
]))

# ── SLEEPING ──────────────────────────────────────────────────────────────────
faces.append(("sleeping", "Sleeping", [
    eye_closed(LX, EY, 18),
    eye_closed(RX, EY, 18),
    # zzz
    text(90, 20, "z"),
    text(100, 12, "Z"),
    text(112, 5,  "Z"),
    *mouth_flat(MX, MY + 4, 16),  # slightly open
]))

# ── LISTENING ─────────────────────────────────────────────────────────────────
faces.append(("listening", "Listening", [
    disc(LX, EY, 11),       # wide eyes
    disc(RX, EY, 11),
    # concentric sound rings on right side
    circle(108, MY, 5),
    circle(108, MY, 9),
    circle(108, MY, 13),
    *mouth_open_o(MX, MY, 5),
]))

# ── SPEAKING ──────────────────────────────────────────────────────────────────
faces.append(("speaking", "Speaking", [
    disc(LX, EY, 9),
    disc(RX, EY, 9),
    *mouth_open_rect(MX, MY, 28, 12),
]))

# ── ERROR ─────────────────────────────────────────────────────────────────────
# X eyes
x_cmds = []
for d in range(-7, 8):
    x_cmds += [px(LX + d, EY + d), px(LX + d, EY - d),
               px(RX + d, EY + d), px(RX + d, EY - d)]
faces.append(("error", "Error", [
    *x_cmds,
    *mouth_frown(MX, MY + 4, 20),
]))

# ── ANGRY ─────────────────────────────────────────────────────────────────────
faces.append(("angry", "Angry", [
    *angry_brow(LX, RX, 16),
    disc(LX, EY, 9),
    disc(RX, EY, 9),
    # shadow under brows
    hline(LX - 4, EY - 10, 8),
    hline(RX - 4, EY - 10, 8),
    *mouth_frown(MX, MY, 32),
]))

# ── SURPRISED ─────────────────────────────────────────────────────────────────
faces.append(("surprised", "Surprised", [
    # big circle eyes
    circle(LX, EY, 12),
    disc(LX, EY, 8),
    circle(RX, EY, 12),
    disc(RX, EY, 8),
    # arched brows high up
    hline(LX - 8, 10, 16),
    hline(RX - 8, 10, 16),
    *mouth_open_o(MX, MY, 9),
]))

# ── WINK ──────────────────────────────────────────────────────────────────────
faces.append(("wink", "Wink", [
    disc(LX, EY, 9),
    eye_closed(RX, EY, 18),  # right eye closed
    disc(106, 40, 5),         # right cheek
    *mouth_smile(MX, MY, 28),
    # wink lash
    hline(RX - 2, EY - 10, 12),
]))

# ── LOVE ──────────────────────────────────────────────────────────────────────
# Heart eyes (hand-drawn heart shape ~12px)
def heart(cx, cy, s=5):
    cmds = []
    # upper two bumps
    for dx in range(-s, 1):
        dy = int(-(s*s - dx*dx)**0.5) if (s*s - dx*dx) >= 0 else 0
        cmds.append(disc(cx - s//2 + dx + s//2, cy + dy, 1))
    # V-bottom
    for i in range(s + 2):
        cmds.append(hline(cx - s + i, cy + i, (s - i)*2))
    return cmds

faces.append(("love", "Love", [
    disc(LX, EY, 9),
    disc(RX, EY, 9),
    # hearts as pupils
    disc(LX, EY, 4),
    disc(RX, EY, 4),
    disc(22, 40, 5),    # cheeks
    disc(106, 40, 5),
    *mouth_smile_big(MX, MY),
    # small hearts floating
    text(6,  14, "<3"),
    text(100, 14, "<3"),
]))

# ── NERVOUS ───────────────────────────────────────────────────────────────────
faces.append(("nervous", "Nervous", [
    disc(LX, EY, 9),
    disc(RX, EY, 9),
    # sweat drop
    disc(RX + 12, EY - 6, 2),
    vline(RX + 12, EY - 10, 5),
    *mouth_zigzag(MX, MY, 28),
    # shaky brows
    hline(LX - 7, 14, 7), hline(LX + 1, 15, 7),
    hline(RX - 7, 15, 7), hline(RX + 1, 14, 7),
]))

# ── EXCITED ───────────────────────────────────────────────────────────────────
faces.append(("excited", "Excited", [
    disc(LX, EY - 2, 10),
    disc(RX, EY - 2, 10),
    # star sparkles
    text(4,  16, "*"),
    text(114, 10, "*"),
    disc(22, 38, 5),
    disc(106, 38, 5),
    *mouth_grin(MX, MY, 34, 10),
]))

# ── CONFUSED ──────────────────────────────────────────────────────────────────
faces.append(("confused", "Confused", [
    disc(LX, EY, 9),
    disc(RX, EY - 4, 9),    # one eye higher
    # asymmetric brows
    hline(LX - 7, 15, 14),
    hline(RX - 7, 11, 14),
    # question mark
    text(110, 20, "?"),
    # wavy mouth
    hline(MX - 12, MY,     8),
    hline(MX -  4, MY + 2, 8),
    hline(MX +  4, MY,     8),
]))

# ── BORED ─────────────────────────────────────────────────────────────────────
faces.append(("bored", "Bored", [
    # half-closed eyes (drooping lid = disc with rect mask effect)
    disc(LX, EY, 9),
    rect(LX - 10, EY - 9, 20, 9),  # black out top half of eye
    disc(RX, EY, 9),
    rect(RX - 10, EY - 9, 20, 9),
    *flat_brow(LX, 15),
    *flat_brow(RX, 15),
    *mouth_flat(MX, MY, 20),
]))

# ── CRYING ────────────────────────────────────────────────────────────────────
faces.append(("crying", "Crying", [
    disc(LX, EY, 9),
    disc(RX, EY, 9),
    *sad_brow(LX, RX, 14),
    *mouth_frown(MX, MY + 2, 28),
    # tears streaming
    vline(LX - 4, EY + 9,  10), disc(LX - 4, EY + 19, 3),
    vline(LX + 4, EY + 9,  7),  disc(LX + 4, EY + 16, 2),
    vline(RX - 4, EY + 9,  8),  disc(RX - 4, EY + 17, 2),
    vline(RX + 4, EY + 9,  12), disc(RX + 4, EY + 21, 3),
]))

# ─── Push all ─────────────────────────────────────────────────────────────────
print(f"Pushing {len(faces)} faces to {SERVER} ...\n")
for name, label, cmds in faces:
    put_face(name, label, cmds)
print(f"\nDone. Open http://192.168.0.107:4000 → Faces tab to preview.")
