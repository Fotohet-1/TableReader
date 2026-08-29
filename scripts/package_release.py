#!/usr/bin/env python3
"""打正式外发包，用 Python zipfile 正确写 UTF-8 文件名（避免中文乱码）。

用法：python3 scripts/package_release.py <repo_root> <out.zip>
"""
import os
import sys
import zipfile

root, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])

# 目录整体排除
EXCLUDE_DIRS = {
    ".git", "node_modules", "models", ".venv-edge", ".venv-qwen",
    "xhs", "logs", "cover", "__pycache__", ".gitattributes",
}
# 路径前缀排除（gitignored 的开发产物）
EXCLUDE_PREFIX = (
    "docs/核心功能与使用技巧/fonts/",
    "docs/核心功能与使用技巧/核心功能与使用技巧-visual/",
    "docs/核心功能与使用技巧/核心功能与使用技巧-landing-visual/",
)
# 文件精确/模式排除
EXCLUDE_FILES = {".DS_Store", "复盘总结-part1.md", "复盘总结-part2.md"}
EXCLUDE_SUFFIX = (".pyc", ".tmp")


def skipped(arc: str) -> bool:
    if any(arc.startswith(p) for p in EXCLUDE_PREFIX):
        return True
    if os.path.basename(arc) in EXCLUDE_FILES:
        return True
    if arc.endswith(EXCLUDE_SUFFIX):
        return True
    return False


with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        # 先过滤子目录，避免进入被排除的目录
        dirnames[:] = [
            d for d in dirnames
            if d not in EXCLUDE_DIRS
            and not skipped(os.path.join(rel, d) if rel != "." else d)
        ]
        for fn in filenames:
            arc = os.path.join(rel, fn) if rel != "." else fn
            if arc.startswith("./"):
                arc = arc[2:]
            if skipped(arc):
                continue
            full = os.path.join(dirpath, fn)
            z.write(full, arc)

print("已打包")
