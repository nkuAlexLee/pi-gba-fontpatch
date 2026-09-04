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
RT_RESUME  equ 0x082570A5     ; cmp r3,#7 @0x082570A4 |1（A0-A3 已被字面量占用）
GSW_LOOP   equ 0x0825778B     ; cmp r0,#255 @0x0825778A |1
GSW_RESUME equ 0x0825785D     ; cmp r6,#0   @0x0825785C |1
GETWIDTH   equ 0x08258103     ; bl 0x08258102 |1
JTABLE     equ 0x0901C28C     ; ★真实控制码跳转表（0x08257380 是存它的 pool，案例笔记勘误）
WORKBUF80  equ 0x03005680     ; 工作缓冲+0x80（宽度区）
CONST8M     equ 0x08000000     ; (r0+8)<<24 的等价常数

; ================= RenderText 截流（12B，覆盖 0x08257098..0x082570A3） =================
.org 0x08257098
	.halfword 0x4B01	; ldr r3,[pc,#4]  → 字面量在 0x082570A0
	.halfword 0x469F	; mov pc,r3（Thumb 内不切状态）
	.halfword 0x46C0	; nop
	.halfword 0x46C0	; nop
	.word	RT_HOOK

; ================= GetStringWidth：本构建不挂钩（保持原函数体完整） =================
; 历史：v2 洞设计时残留的 v1 内联体覆盖了 0x0825785C+ 的 GSW 函数中段，
; 连 v2 的 resume 点 0x0825785D 也被覆盖 → Option 页初始化调 GSW 即挂死。
; GSW 只影响对话窗自动宽度，菜单/固定窗口用宽度表不受影响。
.org 0x08257852
	.halfword 0x4641	; mov r1,r8
	.halfword 0xF000
	.halfword 0xFC55	; bl 0x08258102
	.halfword 0x0003	; lsl r3,r0,#0
	.halfword 0x7868	; ldrb r0,[r5,#1]

; ================= 主菜单 "NEW GAME" → "新的游戏" =================
.org 0x08EFB11C
	.byte	0xF7, 0x0E, 0x4D	; 新
	.byte	0xF7, 0x0F, 0x7C	; 游
	.byte	0xF7, 0x0D, 0xDB	; 戏
	.byte	0xFF

; ★开场白 "This is what we call a \"Pokémon.\"" 原串 40B（0xEFB5EE，
;   被 +2 内部偏移指针引用，不能 repoint，只能原地等长替换）
;   译文: "  我们把它们叫做[/n]\"宝可梦\"。" + 原控制尾字节 fc 08 60 fb ff
.org 0x08EFB5EE
	.byte	0x00, 0x00
	.byte	0xF7, 0x0D, 0x98	; 我
	.byte	0xF7, 0x09, 0x5F	; 们
	.byte	0xF7, 0x01, 0x30	; 把
	.byte	0xF7, 0x0C, 0x9F	; 它
	.byte	0xF7, 0x09, 0x5F	; 们
	.byte	0xF7, 0x07, 0x22	; 叫
	.byte	0xF7, 0x11, 0x2E	; 做
	.byte	0xFE			; [/n]
	.byte	0xB1			; ["
	.byte	0xF7, 0x01, 0x63	; 宝
	.byte	0xF7, 0x07, 0xD7	; 可
	.byte	0xF7, 0x09, 0x66	; 梦
	.byte	0xB1			; "
	.byte	0xA1			; 。（半角句点）
	.byte	0xFC, 0x08, 0x60, 0xFB, 0xFF	; 原控制尾

; ================= 代码洞 =================
.org CAVE

; ---- RenderText 字符截流 ----
; 入口现场: r0=currChar, r1=字符指针, r3=r1+1, r4=窗口结构, r6=跳转表基址, r7=前字符分类
; ---- RenderText 字符截流（ESC 方案: [F7][hi][lo] 3字节中文） ----
; 入口现场: r0=currChar, r1=字符指针, r4=窗口结构, r6=跳转表基址, r7=前字符分类
; ★入口 r3 已被截流字面量污染，指针推进在洞内重算
RT_HOOK:
	add	r3, r1, 1		; ★重算 r1+1（原 0x08257096，被字面量冲掉）
	str	r3, [r4]		; 复现原指令①：存推进后的指针
	push	r2			; ★保护 r2（const 重载会冲掉它，控制码处理器依赖 r2 现场）
	cmp	r0, 0xF7
	bne	@@rt_normal		; 非 ESC 走原路（图标码 0x01-0x1E 原生渲染）
	ldrb	r5, [r1, 1]		; hi
	cmp	r5, 0x1E
	bhs	@@rt_normal		; hi 越界 → ESC 无效，原路渲染 0xF7 空槽
	cmp	r5, 0x06
	beq	@@rt_normal
	cmp	r5, 0x1B
	beq	@@rt_normal
	ldrb	r3, [r4, 0x14]		; fontid（低 4 位）
	lsl	r3, r3, 28
	lsr	r3, r3, 28
	cmp	r3, 8
	bhi	@@rt_normal		; 仅 fontid 0-8（2-6 处理器不渲染，白做也无害）
	push	r3			; ★保存 fontid（出口按它选 [buf+0x81]）
	mov	r3, 0x21
	ldrb	r3, [r4, r3]		; 字体变体标志（不再限制：标题栏等变体≠0 的也要出中文）
	ldrb	r3, [r1, 2]		; lo
	cmp	r3, 0xFF
	beq	@@rt_esc2p		; 截断: 只吃 F7+hi（2字节）渲染空白，保留 FF 终止符
	push	r1
	; ★先算索引（r3=lo），后改指针——否则 lo 被覆盖
	cmp	r5, 0x07
	bhs	@@h7
	sub	r5, 1
	b	@@cor
@@h7:
	cmp	r5, 0x1C
	bhs	@@h1c
	sub	r5, 2
	b	@@cor
@@h1c:
	sub	r5, 3
@@cor:
	lsl	r5, r5, 8
	add	r5, r3			; r5 = record 索引
	add	r3, r1, 3
	str	r3, [r4]		; 中文占 3 字节
	ldr	r2, =FONT_GBA
	lsl	r3, r5, 6		; ×64
	add	r3, r2			; r3 = 字形源址
	mov	r5, r3			; ★r5 = src 基址（blitter 会冲掉 r0，必须每次从基址重载）
	ldr	r6, =BLITTER
	ldr	r2, =WORKBUF
	mov	r1, r2			; ★r1 = dst（blitter 只读 r1，可安全累加）
	mov	r0, r5			; src +0
	ldr	r3, =(@@k1+1)
	.halfword	0x469E	; mov lr,r3
	bx	r6			; blitter(TL)
@@k1:
	mov	r0, r5
	add	r0, 0x10
	add	r1, 0x20
	ldr	r3, =(@@k2+1)
	.halfword	0x469E	; mov lr,r3
	bx	r6			; TR
@@k2:
	mov	r0, r5
	add	r0, 0x20
	add	r1, 0x20
	ldr	r3, =(@@k3+1)
	.halfword	0x469E	; mov lr,r3
	bx	r6			; BL
@@k3:
	mov	r0, r5
	add	r0, 0x30
	add	r1, 0x20
	ldr	r3, =(@@k4+1)
	.halfword	0x469E	; mov lr,r3
	bx	r6			; BR
@@k4:
	ldr	r2, =WORKBUF80
	mov	r3, 12
	strb	r3, [r2]		; 宽度
	pop	r1
	ldrb	r5, [r1, 3]		; r5 = 对后字符（后继 kerning 语义）
	pop	r3			; fontid
	mov	r6, 15			; 默认高度参数（1/7 及其它）
	cmp	r3, 0
	beq	@@f13
	cmp	r3, 8
	bne	@@wb
	mov	r6, 12			; fontid 8
	b	@@wb
@@f13:
	mov	r6, 13			; fontid 0 小字
@@wb:
	strb	r6, [r2, 1]
	pop	r2			; ★恢复 r2
	ldr	r6, =JTABLE		; 恢复跳转表基址（循环每轮复用）
	ldr	r3, =RT_SUCC
	bx	r3

@@rt_popf:
	pop	r3
	b	@@rt_normal
@@rt_esc2p:
	pop	r3
	b	@@rt_esc2

@@rt_esc2:				; F7+hi 但 lo=FF：空白字形推进 2，FF 留给终止
	add	r3, r1, 2
	str	r3, [r4]
	ldr	r6, =BLITTER
	ldr	r5, =BLANK		; ★src 基址放 r5
	ldr	r2, =WORKBUF
	mov	r1, r2
	mov	r0, r5			; src +0
	ldr	r3, =(@@t1+1)
	.halfword	0x469E	; mov lr,r3
	bx	r6
@@t1:
	mov	r0, r5
	add	r0, 0x10
	add	r1, 0x20
	ldr	r3, =(@@t2+1)
	.halfword	0x469E	; mov lr,r3
	bx	r6
@@t2:
	mov	r0, r5
	add	r0, 0x20
	add	r1, 0x20
	ldr	r3, =(@@t3+1)
	.halfword	0x469E	; mov lr,r3
	bx	r6
@@t3:
	mov	r0, r5
	add	r0, 0x30
	add	r1, 0x20
	ldr	r3, =(@@t4+1)
	.halfword	0x469E	; mov lr,r3
	bx	r6
@@t4:
	ldr	r2, =WORKBUF80
	mov	r3, 12
	strb	r3, [r2]
	mov	r3, 15
	strb	r3, [r2, 1]
	pop	r2			; ★恢复 r2
	ldr	r6, =JTABLE
	ldr	r3, =RT_SUCC
	bx	r3

@@rt_normal:				; 复现原指令②-⑥ 后回流
	lsl	r3, r0, 24
	ldr	r2, =CONST8M
	add	r3, r2			; r3 = ((r0+8)&0xFF)<<24
	lsr	r3, r3, 24		; ★搬迁原 0x082570A2 的 lsr（该位置已被字面量覆盖）
	ldrb	r5, [r1, 1]
	pop	r2			; ★恢复 r2 现场
	ldr	r2, =RT_RESUME
	bx	r2
.pool

; ---- GetStringWidth 字符截流（ESC 方案） ----
; 入口现场: r0=currChar, r5=字符指针, r7=r5+1, r4=宽度累加, r6=0, r8=0
GSW_HOOK:
	push	{r2, r3}		; ★保护 r2/r3（原 mov/bl 不碰它们，远调用碰）
	cmp	r0, 0xF7
	bne	@@gs_normal		; ★仅精确 0xF7 进 ESC（bhs 笔误曾吞掉全部控制码）
	ldrb	r3, [r5, 1]		; hi
	cmp	r3, 0x1E
	bhs	@@gs_normal
	cmp	r3, 0x06
	beq	@@gs_normal
	cmp	r3, 0x1B
	beq	@@gs_normal
	ldrb	r0, [r5, 2]		; lo
	cmp	r0, 0xFF
	beq	@@gs_esc2		; 截断: 宽12 推进2（FF 留给终止）
	add	r4, 12			; 中文对宽 12
	add	r5, 3
	ldrb	r0, [r5]		; r0 = [新 r5]（循环不变量）
	ldr	r2, =GSW_LOOP
	.halfword	0x4694	; mov ip,r2
	pop	{r2, r3}
	.halfword	0x4760	; bx ip
@@gs_esc2:
	add	r4, 12
	add	r5, 2
	mov	r0, r3			; r0 = FF → 循环终止
	ldr	r2, =GSW_LOOP
	.halfword	0x4694	; mov ip,r2
	pop	{r2, r3}
	.halfword	0x4760	; bx ip
@@gs_normal:				; 复现原指令后回流
	mov	r1, r8
	ldr	r3, =GETWIDTH
	ldr	r2, =(@@gs_ret+1)
	.halfword	0x4696	; mov lr,r2
	pop	{r2}
	bx	r3
@@gs_ret:
	mov	r3, r0			; 复现 lsl r3,r0,#0
	ldrb	r0, [r5, 1]		; 复现 ldrb r0,[r5,#1]
	ldr	r2, =GSW_RESUME
	.halfword	0x4694	; mov ip,r2
	pop	{r2}
	.halfword	0x4760	; bx ip
.pool

BLANK:					; 全零字形（截断对用）
	.fill	64, 0x00

; ================= 字库全量 =================
.org FONT_GBA
	.incbin	"armips-src/graphics/fonts/full_fonts.bin"

.close
