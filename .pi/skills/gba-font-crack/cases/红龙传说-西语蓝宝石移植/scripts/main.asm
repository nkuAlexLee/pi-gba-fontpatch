;宝可梦红龙传说 中文字库补丁（Phase 1: 核心文本引擎 + 菜单字符串）
;基板: AXPE 头蓝宝石改版，实为德语版代码布局（+0x134 文本区 / +0x324 战斗区），已 trace 实证
.gba
.thumb
.loadtable "./charmap.txt"
.open "./baserom.gba","./红龙传说_字库.gba",0x08000000

;符号定义
.include "./include/Symbols.s"
.include "./include/hack.s"

;1.核心文本引擎 hook（汉字识别 + 汉字宽度 + 汉字绘制）
;DrawGlyphTiles+2: 覆盖 sub sp,#28; add r6,r0 → Chinese 入口自带 sub sp,0x1C 复刻栈帧
.org DrawGlyphTiles + 2                             ;0x080069AA
    bl DrawGlyphTilesChinese
;GetGlyphWidth+2: 覆盖 add r2,r0; add r3,r1 → origin 路径复刻
.org GetGlyphWidth + 2                              ;0x08004A1E
    bl GetGlyphWidthChinese
;GetStringWidth+0x100: 覆盖 add r6,#1 .. lsr r2,#24 (0x12B) → 自调宽度函数
.org GetStringWidth + 0x100                         ;0x08004E00
    push lr
    bl GetStringWidthChinese
    pop r0
    mov r14,r0
    b GetStringWidth + 0x112                        ;0x08004E12

;中文相关函数（放在 gMiscBlank_Gfx 空白图形资源区，0x800 字节）
.org HackFunctionAddresses
.include "./src/GetGlyphWidthChinese.s"
.include "./src/GetStringWidthChinese.s"
.include "./src/DrawGlyphTilesChinese.s"

;中文字库（16x16 4bpp，128B/字；0x09200000+ 为改版空余区，绝对寻址无 bl 距离限制）
.org PokeRSFontChsNormal
.incbin "./graphic/fonts/PokeRSFontChsNormal(0xE0000).bin"
.org PokeRSFontChsSmall
.incbin "./graphic/fonts/PokeRSFontChsSmall(0xE0000).bin"

;主菜单 "PARTIDA NUEVA" → "新的游戏"（原地等长替换，FF 收尾 + 00 补齐）
.org gMainMenuString_NewGame
    .strn "新的游戏$00000"

.close
