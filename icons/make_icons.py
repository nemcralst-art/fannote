"""Generate ファンノート PWA icons: a cream heart on a lavender square.
Matches きろく帖's palette (lavender #9F8FD4 / cream #FAF7F0) but uses a
heart (= 応援/ファン) so the two sister apps are easy to tell apart.
Run: python3 make_icons.py
"""
import math
from PIL import Image, ImageDraw, ImageFilter

LAVENDER = (159, 143, 212, 255)   # #9F8FD4
LAVENDER_DARK = (132, 116, 188, 255)
CREAM = (250, 247, 240, 255)       # #FAF7F0
SHADOW = (90, 76, 140, 90)         # soft purple shadow

SS = 4  # supersampling factor for smooth edges


def heart_points(cx, cy, scale):
    """Classic parametric heart, centred on (cx, cy)."""
    pts = []
    for i in range(721):
        t = math.radians(i * 0.5)
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * scale, cy - y * scale))
    return pts


def make(size):
    S = size * SS
    img = Image.new("RGBA", (S, S), LAVENDER)
    draw = ImageDraw.Draw(img)

    # very subtle vignette for depth (darker lavender at the corners)
    veil = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    vd = ImageDraw.Draw(veil)
    vd.ellipse([-S * 0.25, -S * 0.25, S * 1.25, S * 1.25], fill=(255, 255, 255, 22))
    img.alpha_composite(veil)

    cx, cy = S * 0.5, S * 0.48
    scale = S * 0.022  # kept inside the maskable safe zone (centre ~80%)

    # soft shadow under the heart
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.polygon(heart_points(cx, cy + S * 0.02, scale), fill=SHADOW)
    shadow = shadow.filter(ImageFilter.GaussianBlur(S * 0.02))
    img.alpha_composite(shadow)

    # the cream heart
    draw.polygon(heart_points(cx, cy, scale), fill=CREAM)

    img = img.resize((size, size), Image.LANCZOS)
    return img.convert("RGB")  # opaque, full-bleed (good for iOS + Android maskable)


for s in (512, 192, 180, 167, 152, 120):
    make(s).save(f"icon-{s}.png")
    print(f"wrote icon-{s}.png")

# A simple favicon too
make(64).save("favicon.png")
print("wrote favicon.png")
print("done")
