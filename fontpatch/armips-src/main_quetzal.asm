;; main_quetzal.asm — Quetzal（Emerald 改版）中文字库补丁
;;
;; 用法（在本目录执行）:
;;   armips\armips.exe main_quetzal.asm -erroronwarning
;;
;; 输入: ../roms/PokemonQuetzalAlpha7v0测试.gba（原版 Quetzal）
;; 输出: ../tmp/PokemonQuetzalAlpha7v0测试_chs.gba（支持中文的 Quetzal）
;;
;; 内容:
;;   1. RenderText / GetStringWidth 的 4 处 hook（中文分支）
;;   2. 中文渲染功能函数（0x09FD0000 起的空区域）
;;   3. 中文字库数据（11x11 大字库 + 9x9 小字库 + 标点）
;;
;; 地址前提（已用 romctl 反汇编逐一验证 Quetzal 与 stock Emerald 布局一致）:
;;   RenderText          = 0x080057B4
;;   RenderText+0xD0     = 0x08005884  (中文函数返回点)
;;   RenderText+0x45C    = 0x08005C10  (CopyGlyphToWindow)
;;   GetStringWidth      = 0x08005ED8
;;   DecompressGlyphTile = 0x08004C04  (实测入口; pokeE 原定义 0x08004C10 为函数中段,
;;                                      text_quetzal.h 已修正)

.gba
.open "../roms/PokemonQuetzalAlpha7v0测试.gba", "../tmp/PokemonQuetzalAlpha7v0测试_chs.gba", 0x08000000

.include "./include/text.h"
.include "./include/graphics.h"
.include "./include/gba/defines.h"
.include "./include/constants/global.h"
.include "./include/hackSymbols_E.h"

.thumb
; 文本引擎 hook（RenderText 中文分支 / GetStringWidth 中文宽度）
.include "./src/HookInOrigin/text.s"

; 中文渲染功能函数 + 中文字库数据
.org HackFunctionAddresses
.include "./src/HackFunction/text.s"
.include "./src/HackFunction/graphics.s"

.close
