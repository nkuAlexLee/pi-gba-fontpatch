# Quetzal 中文字库补丁工作区

## 一键补丁（已验证）

```bash
# 前提: ../roms/PokemonQuetzalAlpha7v0(字库).gba（含中文引擎的基座）
node patch-newgame-string.js
# 输出: ../tmp/PokemonQuetzal字库版_新的游戏.gba（主菜单显示"新的游戏"）
```

## 目录

- `patch-newgame-string.js` — 主菜单字符串中文补丁（唯一需要的脚本）
- `armips-src/` — pokeE 补丁的 armips 移植尝试（已废弃，保留研究：
  移植失败原因见 .pi/skills/quetzal-fontpatch/SKILL.md 踩坑 #1）
  - `main_quetzal.asm` — 汇编脚本（针对 Quetzal 的地址验证都写在注释里）
  - `include/` `src/` — pokeE 的头文件与源码（text_quetzal.h 已修正
    DecompressGlyphTile 入口 0x08004C04）
  - `graphics/fonts/` — 11x11/9x9 中文点阵字库 + 标点（1bpp）
  - `armips.exe` — 汇编器

## 技术要点速查

- 中文双字节: [hi][lo]，hi ∈ 0x01-0x1E（排除 06/1B），lo < 0xF7
- 码表: ../../fonts/wholewords.txt（0E4D=新 030B=的 0F7C=游 0DDB=戏）
- 字库版引擎: hook@RenderText+0xBA → 跳板@0x081400C34 → 字库@0x1B7FFCC 起
- 主菜单字符串: 文件偏移 0x137E070（NEW GAME）
