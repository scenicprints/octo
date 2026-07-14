"""Foos icon: the two men — Kevin red, Josh blue — facing off on a chrome rod
over the felt. Writes both the Android launcher art and the web/PWA icons.

  assets/icon/foos_icon.png     · full square (Android legacy)
  assets/icon/foos_icon_fg.png  · transparent foreground (Android adaptive)
  docs/icon-{180,192,512}.png   · home-screen icons for iPhone + Android web
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(__file__)
ICON = os.path.join(HERE, "..", "assets", "icon")
DOCS = os.path.join(HERE, "..", "docs")
os.makedirs(ICON, exist_ok=True)
os.makedirs(DOCS, exist_ok=True)

GROUND = (11, 14, 12, 255)     # #0B0E0C
FELT = (14, 59, 42, 255)       # #0E3B2A
FELT_HI = (20, 80, 58, 255)
RED = (226, 58, 46, 255)
RED_LO = (168, 36, 25, 255)
BLUE = (42, 127, 232, 255)
BLUE_LO = (20, 80, 156, 255)
CHROME = (201, 205, 210, 255)
CHROME_LO = (110, 117, 125, 255)
BALL = (242, 233, 200, 255)

S = 1024


def figure(d, cx, cy, scale, body, leg, dark):
    """One foosball man, seen head-on, hanging from his rod."""
    def P(x, y):
        return (cx + x * scale, cy + y * scale)

    d.ellipse(P(-0.16, -0.50) + P(0.16, -0.18), fill=body)                      # head
    d.polygon([P(-0.19, -0.14), P(0.19, -0.14), P(0.24, 0.22), P(-0.24, 0.22)],
              fill=body)                                                        # torso
    d.polygon([P(-0.19, 0.22), P(-0.04, 0.22), P(-0.08, 0.62), P(-0.24, 0.62)],
              fill=leg)                                                         # left leg
    d.polygon([P(0.19, 0.22), P(0.04, 0.22), P(0.08, 0.62), P(0.24, 0.62)],
              fill=leg)                                                         # right leg
    d.rounded_rectangle(P(-0.27, 0.58) + P(-0.05, 0.70),
                        radius=int(0.04 * scale), fill=dark)                    # feet
    d.rounded_rectangle(P(0.05, 0.58) + P(0.27, 0.70),
                        radius=int(0.04 * scale), fill=dark)


def rod(d, y, x0, x1, thick):
    """A chrome rod with a highlight along the top."""
    d.rounded_rectangle([x0, y, x1, y + thick], radius=thick // 2, fill=CHROME_LO)
    d.rounded_rectangle([x0, y, x1, y + thick * 0.55], radius=thick // 2, fill=CHROME)


def draw(img, inset, with_bg):
    d = ImageDraw.Draw(img)

    if with_bg:
        pad = int(S * 0.10)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=GROUND)
        d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(S * 0.12), fill=FELT)
        # centre line + circle, the way a real table is marked
        d.line([S // 2, pad, S // 2, S - pad], fill=FELT_HI, width=int(S * 0.012))
        r = int(S * 0.115)
        d.ellipse([S // 2 - r, S // 2 - r, S // 2 + r, S // 2 + r],
                  outline=FELT_HI, width=int(S * 0.012))

    cy = S * 0.50
    sc = S * inset

    thick = int(S * 0.035)
    rod(d, cy - sc * 0.42, S * 0.06, S * 0.94, thick)
    figure(d, S * 0.30, cy, sc, RED, RED_LO, (124, 23, 16, 255))
    figure(d, S * 0.70, cy, sc, BLUE, BLUE_LO, (14, 58, 112, 255))

    # the ball, dead centre between them
    br = int(S * 0.052)
    d.ellipse([S // 2 - br, int(cy) - br, S // 2 + br, int(cy) + br], fill=BALL)


# ── Android: full square (felt + men) ──
full = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw(full, 0.42, with_bg=True)
full.save(os.path.join(ICON, "foos_icon.png"))

# ── Android adaptive foreground: men + ball only, transparent, in the safe zone ──
fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw(fg, 0.32, with_bg=False)
fg.save(os.path.join(ICON, "foos_icon_fg.png"))

# ── Web / iPhone home screen ──
for size in (180, 192, 512):
    full.resize((size, size), Image.LANCZOS).save(os.path.join(DOCS, f"icon-{size}.png"))

print("Wrote Android icons ->", os.path.abspath(ICON))
print("Wrote web icons     ->", os.path.abspath(DOCS))
