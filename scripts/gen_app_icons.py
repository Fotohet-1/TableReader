#!/usr/bin/env python3
"""生成 PWA / macOS 用的应用图标（系统 Python + Pillow，无需额外依赖）。

输出到 public/icons/：icon-1024.png、icon-512.png、icon-192.png、icon-180.png。
运行：python3 scripts/gen_app_icons.py
"""
from PIL import Image, ImageDraw
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "public", "icons")

ACCENT_TOP = (0, 113, 227)     # #0071e3
ACCENT_BOTTOM = (0, 102, 204)  # #0066cc
WHITE = (255, 255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)


def draw_icon(size: int) -> Image.Image:
    scale = size / 1024.0
    img = Image.new("RGBA", (size, size), TRANSPARENT)

    # 垂直渐变背景
    grad = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(size - 1, 1)
        r = int(ACCENT_TOP[0] + (ACCENT_BOTTOM[0] - ACCENT_TOP[0]) * t)
        g = int(ACCENT_TOP[1] + (ACCENT_BOTTOM[1] - ACCENT_TOP[1]) * t)
        b = int(ACCENT_TOP[2] + (ACCENT_BOTTOM[2] - ACCENT_TOP[2]) * t)
        d.line([(0, y), (size, y)], fill=(r, g, b, 255))

    # 圆角外框
    radius = int(size * 0.22)
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    # 白色均衡器波形（朗读/声音意象），居中
    draw = ImageDraw.Draw(img)
    bars = [0.40, 0.72, 1.0, 0.72, 0.40]
    bar_w = 92 * scale
    gap = 44 * scale
    total_w = len(bars) * bar_w + (len(bars) - 1) * gap
    x0 = (size - total_w) / 2
    cy = size * 0.5
    max_h = size * 0.5
    for i, h in enumerate(bars):
        bh = max_h * h
        x = x0 + i * (bar_w + gap)
        draw.rounded_rectangle(
            [x, cy - bh / 2, x + bar_w, cy + bh / 2],
            radius=bar_w / 2,
            fill=WHITE,
        )
    return img


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for size in (1024, 512, 192, 180):
        img = draw_icon(size)
        img.save(os.path.join(OUT, "icon-%d.png" % size), "PNG")
        print("wrote public/icons/icon-%d.png" % size)


if __name__ == "__main__":
    main()
