#!/usr/bin/env python3
"""移除每一行行首的制表符缩进。"""
import sys

for path in sys.argv[1:]:
    with open(path, encoding="utf-8") as f:
        lines = f.read().split("\n")
    out = []
    for line in lines:
        stripped = line.lstrip("\t")
        out.append(stripped)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out))
    print(f"完成: {path}")
