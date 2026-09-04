;; elite-redux-fullfont.s — Elite Redux 2.65.1 绿宝石字库全量注入（方案 C：整库 + hook）
;;
;; 基础事实（全部经探针/截图实证，见 cases/EliteRedux-正向分析/ 与本次索引映射破解）：
;;   RenderText      = 0x08257010，字符读取+指针推进 @+0x88 (0x08257098..0x0825709F 4条指令)
;;   控制码跳转表    = 0x08257380 (0xF8-0xFF)
;;   fontid 分发     = +0x23E；fontid→handler 表 @0x0901C2AC，[1]=FONT_NORMAL 内联
;;   FONT_NORMAL     = 0x082572FA → bl 0x08257FFC(currChar, variant) → b 0x0825728C(公共后继)
;;   字形解压        = 0x08257FFC: glyphAddr=0x09067D18+currChar*64; 宽度表@0x0906FD18
;;                     宽>8 → 4×bl 0x082562A8(src+0x10 步进, dst=0x03005600+0x20 步进)
;;                     宽度写 [buf+0x80]，另写 [buf+0x81]=15
;;   blitter         = 0x082562A8(r0=src, r1=dst)，保护 r4-r7，脏 r0-r3（含内部 LUT 加载）
;;   后继 0x0825728C: bl 0x082563BC(r4) 消费缓冲 → [r4+8] += 宽度；r7(前字符分类)必须存活
;;   GetStringWidth  = 0x082576E4；普通字符路径 @0x08257852: mov r1,r8; bl 0x08258102 查宽
;;                     累加 r4；r5 前进 1；r0=[新r5]；回 0x0825778A (cmp r0,#255)
;;   菜单串          = 文件 0xEFB11C (GBA 0x08EFB11C)
;;
;; 字库（fonts/绿宝石字库.bin, 0xED780B = 15198×64B 记录，引擎原生 64B 四-tile 2bpp 含阴影层）：
;;   记录索引 record = corrected_hi*256 + lo
;;     corrected_hi: hi>=0x1C → hi-3; hi>=0x07 → hi-2; 否则 hi-1   (跳过无效 hi 0x06/0x1B)
;;   锚字实证: 阿(0x0100)@0、的(0x030B)@523、口(0x07E8)@1512、新(0x0E4D)@3149、一(0x0F0B)@3339
;;   每组 256 条，lo=0xF7-0xFF 的 9 条为全零空记录（组结构自证）
;;
;; 注入布局（ROM 尾部 9.9MB FF 空区 @文件 0x168A4D8 起）：
;;   FONT_GBA = 0x0968A4D8  字库全量 0xED780B
;;   CAVE     = 0x09777C58  hook 代码（紧贴字库尾，4 对齐）
;;   截流 1:  0x08257098 12B → ldr r3,[pc,#4]; mov pc,r3; nop; nop + 字面量 RT_HOOK
;;            （覆盖 str/lsl/add/lsl 4 条 + ldrb r5/lsr 2 条，全部在 hook 内复现）
;;   截流 2:  0x08257852 10B → 同技巧 + 字面量 GSW_HOOK
;;            （覆盖 mov r1,r8 / bl 0x08258102 / lsl r3 / ldrb r0 4 条，hook 内复现）
;;   菜单串:  0x08EFB11C = "新的游戏"FF
;;
;; 远调用技巧：blitter 距洞约 14MB，超出 bl ±4MB → ldr lr,=返回点; bx r6(=blitter|1)

.gba
.open "er_base.gba", "er_full.gba", 0x08000000
.thumb

FONT_GBA   equ 0x0968A4D8
CAVE       equ 0x09777C58
BLITTER    equ 0x082562A9     ; |1 保证 bx 切 Thumb
WORKBUF    equ 0x03005600
RT_SUCC    equ 0x0825728D     ; 公共后继 0x0825728C |1
RT_RESUME  equ 0x082570A3     ; lsr r3,r3,#24 @0x082570A2 |1
GSW_LOOP   equ 0x0825778B     ; cmp r0,#255 @0x0825778A |1
GSW_RESUME equ 0x0825785D     ; cmp r6,#0   @0x0825785C |1
GETWIDTH   equ 0x08258103     ; bl 0x08258102 |1
JTABLE     equ 0x08257380
WORKBUF80  equ 0x03005680     ; 工作缓冲+0x80（宽度区）
CONST8M     equ 0x08000000     ; (r0+8)<<24 的等价常数

; ================= RenderText 截流（12B，覆盖 0x08257098..0x082570A3） =================
.org 0x08257098
	.halfword 0x4B01	; ldr r3,[pc,#4]  → 字面量在 0x082570A0
	.halfword 0x469F	; mov pc,r3（Thumb 内不切状态）
	.halfword 0x46C0	; nop
	.halfword 0x46C0	; nop
	.word	RT_HOOK

; ================= GetStringWidth 截流（本次构建禁用）
.org 0x08257852
	.halfword 0x4641	; mov r1,r8（原指令）
	.halfword 0xF000
	.halfword 0xFC55	; bl 0x08258102（原指令）
	.halfword 0x0003	; lsl r3,r0,#0
	.halfword 0x7868	; ldrb r0,[r5,#1]

; ================= 主菜单 "NEW GAME" → "新的游戏" =================
.org 0x08EFB11C
	.byte	0x0E, 0x4D		; 新
	.byte	0x0F, 0x7C		; 游
	.byte	0x0D, 0xDB		; 戏
	.byte	0xFF

; ================= 代码洞 =================
.org CAVE

; ---- RenderText 字符截流 ----
; 入口现场: r0=currChar, r1=字符指针, r3=r1+1, r4=窗口结构, r6=跳转表基址, r7=前字符分类
RT_HOOK:
	add	r3, r1, 1		; ★r3 已被截流字面量污染，重算 r1+1（原 0x08257096）
	str	r3, [r4]		; 复现原指令①：存推进后的指针
	cmp	r0, 0x1E
	bhs	@@rt_normal
	cmp	r0, 0x06
	beq	@@rt_normal
	cmp	r0, 0x1B
	beq	@@rt_normal
	ldrb	r3, [r4, 0x14]		; fontid（低 4 位）
	lsl	r3, r3, 28
	lsr	r3, r3, 28
	cmp	r3, 1			; 仅 FONT_NORMAL
	bne	@@rt_normal
	mov	r3, 0x21
	ldrb	r3, [r4, r3]		; 字体变体标志
	cmp	r3, 0			; 仅主路径
	bne	@@rt_normal

	; --- 中文对 [hi=r0][lo] ---
	ldrb	r5, [r1, 1]		; lo
	cmp	r5, 0xFF
	beq	@@rt_trunc		; 截断对：hi 当 12px 空白，只推进 1
	push	r1
	add	r3, r1, 2
	str	r3, [r4]		; 中文占 2 字节
	; hi 修正: 0x01-05→-1, 0x07-1A→-2, 0x1C-1E→-3
	cmp	r0, 0x07
	bhs	@@h7
	sub	r0, 1
	b	@@cor
@@h7:
	cmp	r0, 0x1C
	bhs	@@h1c
	sub	r0, 2
	b	@@cor
@@h1c:
	sub	r0, 3
@@cor:
	lsl	r0, r0, 8
	add	r0, r5			; r0 = record 索引
	ldr	r2, =FONT_GBA
	lsl	r3, r0, 6		; ×64
	add	r3, r2			; r3 = 字形源址
	ldr	r6, =BLITTER
	mov	r0, r3
	ldr	r2, =WORKBUF
	mov	r1, r2
	ldr	r3, =(@@k1+1)	; |1 保证 bx 回 Thumb
	.halfword	0x469E	; mov lr,r3
	bx	r6			; blitter(TL)
@@k1:
	add	r0, 0x10
	add	r1, 0x20
	ldr	r3, =(@@k2+1)	; |1 保证 bx 回 Thumb
	.halfword	0x469E	; mov lr,r3
	bx	r6			; TR
@@k2:
	add	r0, 0x10
	add	r1, 0x20
	ldr	r3, =(@@k3+1)	; |1 保证 bx 回 Thumb
	.halfword	0x469E	; mov lr,r3
	bx	r6			; BL
@@k3:
	add	r0, 0x10
	add	r1, 0x20
	ldr	r3, =(@@k4+1)	; |1 保证 bx 回 Thumb
	.halfword	0x469E	; mov lr,r3
	bx	r6			; BR
@@k4:
	ldr	r2, =WORKBUF80
	mov	r3, 12
	strb	r3, [r2]			; 宽度
	mov	r3, 15
	strb	r3, [r2, 1]
	pop	r1
	ldrb	r5, [r1, 2]		; r5 = 对后字符（后继 kerning 语义）
	ldr	r6, =JTABLE		; 恢复跳转表基址（循环每轮复用）
	ldr	r3, =RT_SUCC
	bx	r3

@@rt_trunc:				; hi 后跟 FF：空白字形，推进 1
	add	r3, r1, 1
	str	r3, [r4]
	ldr	r6, =BLITTER
	ldr	r0, =BLANK
	ldr	r2, =WORKBUF
	mov	r1, r2
	ldr	r3, =(@@t1+1)	; |1 保证 bx 回 Thumb
	.halfword	0x469E	; mov lr,r3
	bx	r6
@@t1:
	add	r0, 0x10
	add	r1, 0x20
	ldr	r3, =(@@t2+1)	; |1 保证 bx 回 Thumb
	.halfword	0x469E	; mov lr,r3
	bx	r6
@@t2:
	add	r0, 0x10
	add	r1, 0x20
	ldr	r3, =(@@t3+1)	; |1 保证 bx 回 Thumb
	.halfword	0x469E	; mov lr,r3
	bx	r6
@@t3:
	add	r0, 0x10
	add	r1, 0x20
	ldr	r3, =(@@t4+1)	; |1 保证 bx 回 Thumb
	.halfword	0x469E	; mov lr,r3
	bx	r6
@@t4:
	ldr	r2, =WORKBUF80
	mov	r3, 12
	strb	r3, [r2]
	mov	r3, 15
	strb	r3, [r2, 1]
	ldr	r6, =JTABLE
	ldr	r3, =RT_SUCC
	bx	r3

@@rt_normal:				; 复现原指令②-⑥ 后回流
	lsl	r3, r0, 24
	ldr	r2, =CONST8M
	add	r3, r2			; r3 = ((r0+8)&0xFF)<<24
	ldrb	r5, [r1, 1]
	ldr	r2, =RT_RESUME
	bx	r2
.pool

; ---- GetStringWidth 字符截流 ----
; 入口现场: r0=currChar, r5=字符指针, r7=r5+1, r4=宽度累加, r6=0, r8=0, [sp]=间距(此路径恒0)
GSW_HOOK:
	cmp	r0, 0x1E
	bhs	@@gs_normal
	cmp	r0, 0x06
	beq	@@gs_normal
	cmp	r0, 0x1B
	beq	@@gs_normal
	ldrb	r3, [r5, 1]		; lo
	cmp	r3, 0xFF
	beq	@@gs_half
	add	r4, 12			; 中文对宽 12
	add	r5, 2
	ldrb	r0, [r5]		; r0 = [新 r5]（循环不变量）
	ldr	r2, =GSW_LOOP
	bx	r2
@@gs_half:				; 截断对：宽 12 推进 1，r0=FF 终止
	add	r4, 12
	add	r5, 1
	mov	r0, r3
	ldr	r2, =GSW_LOOP
	bx	r2
@@gs_normal:				; 复现原指令后回流
	mov	r1, r8
	ldr	r3, =GETWIDTH
	ldr	r2, =(@@gs_ret+1)	; |1
	.halfword	0x4696	; mov lr,r2
	bx	r3
@@gs_ret:
	mov	r3, r0			; 复现 lsl r3,r0,#0
	ldrb	r0, [r5, 1]		; 复现 ldrb r0,[r5,#1]
	ldr	r2, =GSW_RESUME
	bx	r2
.pool

BLANK:					; 全零字形（截断对用）
	.fill	64, 0x00

; ================= 字库全量 =================
.org FONT_GBA
	.incbin	"armips-src/graphics/fonts/full_fonts.bin"

.close
