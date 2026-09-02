;OriginFunctionAddress — 红龙传说（AXPE 头，实为德语版布局的蓝宝石改版，已 trace 实证）
;布局依据: pokesapphire_de.sym + romctl 动态 trace（GetGlyphWidth/DrawGlyphTiles 调用点命中）
sub_80034D4                             equ 0x08003608
sub_8003504                             equ 0x08003638
GetGlyphWidth                           equ 0x08004A1C
GetStringWidth                          equ 0x08004D00
DrawGlyphTile_ShadowedFont              equ 0x080057B4
DrawGlyphTiles                          equ 0x080069A8
GetExpandedPlaceholder                  equ 0x0800712C
UpdateTilemap                           equ 0x08006A88
GetCursorTileNum                        equ 0x08006B0C
StringCopy                              equ 0x08006BE4
StringAppend                            equ 0x08006C04
gMiscBlank_Gfx                          equ 0x08215940
UpdateNickInHealthbox                   equ 0x080454C4      ;Phase2
UpdateSafariBallsTextInHealthbox        equ 0x08045BD4      ;Phase2
UpdateLeftNoOfBallsTextOnHealthbox      equ 0x08045CBC      ;Phase2
GetBattlerPosition                      equ 0x08078BEC
sub_8097F58                             equ 0x080980A8      ;Phase2
PrintDisplayMonInfo                     equ 0x08098340      ;Phase2 未验证
CpuSet                                  equ 0x081ED6EC

;strings（改版自己的西语文本布局，指针在 0x08009E28 区字面量池）
gMainMenuString_NewGame                 equ 0x0841109C      ;"PARTIDA NUEVA"

;graphic
gFont3LatinGlyphs                       equ 0x08EA3130
gPSSMenuHeader_Tilemap                  equ 0x08E8E10C

;define
FONT_NORMAL_UNSHADOWED                  equ 0
FONT_SMALL_UNSHADOWED                   equ 1
FONT_SMALL_COPY_UNSHADOWED              equ 2
FONT_NORMAL_SHADOWED                    equ 3
FONT_SMALL_SHADOWED                     equ 4
FONT_SMALL_COPY_SHADOWED                equ 5
FONT_BRAILLE                            equ 6

LANGUAGE_JAPANESE                       equ 1
LANGUAGE_ENGLISH                        equ 2
LANGUAGE_FRENCH                         equ 3
LANGUAGE_ITALIAN                        equ 4
LANGUAGE_GERMAN                         equ 5
LANGUAGE_KOREAN                         equ 6
LANGUAGE_SPANISH                        equ 7
NUM_LANGUAGES                           equ 7
