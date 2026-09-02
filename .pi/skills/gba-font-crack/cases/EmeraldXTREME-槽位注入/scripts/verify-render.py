#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
verify-render.py — Emerald XTREME 中文渲染像素校验（NEW GAME 范式判定）
用法: python verify-render.py <截图.bmp>
前置: romctl 已跑到主菜单画面（load → run 3600 → run 3500 → key START 60 → run 400）
判据: 箱1(选中项)"新的游戏" 与 箱2(未选中项)"选项" 的墨点与字库源字形逐像素一致
注意: 依赖 gba_chs_font_11x11.bin 的 11bit/行打包解码 与 (hi修正)*0xF7+lo 索引（勿改）
"""
import struct, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, '../../../assets/gba_chs_font_11x11.bin')

# 码表（wholewords.txt）→ 字库索引 = (hi修正)*0xF7 + lo（pokeE 权威公式）
CHARS_BOX1 = [0x0E4D, 0x030B, 0x0F7C, 0x0DDB]  # 新的游戏
CHARS_BOX2 = [0x0E8A, 0x0E1B]                  # 选项
CODE_BASE = 0x87                                # 注入码位起点
CH_WIDTH = 12

def fix_hi(hi):
    if 0x01 <= hi <= 0x05: return hi - 1
    if 0x07 <= hi <= 0x1A: return hi - 2
    if 0x1C <= hi <= 0x1E: return hi - 3
    return hi

def glyph(code, font):
    idd = fix_hi(code >> 8) * 0xF7 + (code & 0xFF)
    bits = ''.join(format(b, '08b') for b in font[idd*16:idd*16+16])
    return [[1 if bits[r*11+c] == '1' else 0 for c in range(11)] for r in range(11)]

def load_bmp(path):
    d = open(path, 'rb').read()
    off = struct.unpack('<I', d[10:14])[0]
    w = struct.unpack('<i', d[18:22])[0]
    rs = (w*3+3)//4*4
    h = struct.unpack('<i', d[22:26])[0]
    def px(x, y):
        i = off + (h-1-y)*rs + x*3
        return (d[i+2], d[i+1], d[i])  # RGB
    return px

def main(path):
    px = load_bmp(path)
    font = open(FONT, 'rb').read()
    ink = lambda c: sum(c)/3 < 150

    # 箱1：白底选中项，深色墨点（右侧邻白去边框噪声）
    pts = [(x, y) for y in range(5, 28) for x in range(12, 115)
           if ink(px(x, y)) and all(v > 200 for v in px(x-1, y))]
    x0, y0 = min(p[0] for p in pts), min(p[1] for p in pts)
    total = hit = 0
    for k, code in enumerate(CHARS_BOX1):
        g = glyph(code, font)
        for r in range(11):
            for c in range(11):
                got = 1 if ink(px(x0 + k*CH_WIDTH + c, y0 + r)) else 0
                total += 1; hit += (got == g[r][c])
    r1 = 100.0*hit/total
    print('箱1(新的游戏): bbox x%d y%d | 像素比对 %d/%d (%.1f%%)' % (x0, y0, hit, total, r1))

    # 箱2：灰底未选中项，深色文字（自动对齐：遍历起点取墨点得分最高者）
    def cls(x, y):
        s = sum(px(x, y))/3
        return 2 if s < 100 else (1 if s < 126 else 0)  # 2=墨 1=影 0=底
    best = None
    for oy in range(38, 46):
        for ox in range(14, 20):
            sc = tot = 0
            for k, code in enumerate(CHARS_BOX2):
                g = glyph(code, font)
                for r in range(11):
                    for c in range(11):
                        if g[r][c]:
                            tot += 1; sc += (cls(ox + k*CH_WIDTH + c, oy + r) == 2)
            if best is None or sc > best[0]: best = (sc, tot, ox, oy)
    r2 = 100.0*best[0]/best[1]
    print('箱2(选项): 对齐 ox=%d oy=%d | 墨点比对 %d/%d (%.1f%%)' % (best[2], best[3], best[0], best[1], r2))

    ok = r1 > 95 and r2 > 95
    print('结论:', 'PASS ✅' if ok else 'FAIL ❌')
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'tmp/v5_menu.bmp'))
