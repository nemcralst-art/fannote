"""Generate ファンノート PWA icons by resizing the master image.

Put the square master image at icons/icon-src.png, then run:
    cd icons && python3 make_icons.py

It writes icon-512/192/180/167/152/120.png and a 64px favicon.png
(all opaque RGB = good for iOS home screen and Android).
"""
from PIL import Image

SRC = "icon-src.png"
SIZES = (512, 192, 180, 167, 152, 120)

src = Image.open(SRC).convert("RGB")  # opaque, full-bleed
for s in SIZES:
    src.resize((s, s), Image.LANCZOS).save(f"icon-{s}.png")
    print(f"wrote icon-{s}.png")
src.resize((64, 64), Image.LANCZOS).save("favicon.png")
print("wrote favicon.png")
print("done")
