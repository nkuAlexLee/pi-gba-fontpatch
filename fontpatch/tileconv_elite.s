;; tileconv.s — Elite Redux 中文字形 4bpp tile 转换函数
;;
;; 背景: 现有字库补丁的渲染函数 (0x09E2ECC0) 会 4 次调用 pool 0x9E2ED8C 指向的
;; 函数，把解压输出的位行数据转成 tile 写入 work buf。原补丁错误引用了
;; 0x08256CB0 (Elite Redux 的无关函数)，导致渲染挂死。
;;
;; 本函数替换之。调用约定 (由渲染函数的循环决定):
;;   r0 = src (不可靠, 忽略), r1 = dst = 0x030064EC + 32*k, k = 0..3
;;   通过 bx r3 进入, 需 bx lr 返回
;;
;; tile 语义 (dst 偏移决定):
;;   k=0: TL = 行 0-7   像素 0-7 (源行 u16 的 bit15-8)
;;   k=1: BL = 行 8-15  像素 0-7
;;   k=2: TR = 行 0-7   像素 8-10 (bit7-5) + 5 空 nibble
;;   k=3: BR = 行 8-15  像素 8-10 + 5 空
;;
;; 源: 解压位行缓冲 (decompress 函数输出, 每行 u16, 像素 p = bit15-p,
;;     11px 字形有效位 bit15-5, 9px 为 bit15-7)
;;   大字库 (11px): 基址 0x0203FF42 (decompress advance=1 行)
;;   小字库 (9px):  基址 0x0203FF44 (advance=2 行)
;;   区分方法: 渲染函数把宽度 (12/10) 写在 [workbuf+0x80]
;;
;; 输出: 8x8 4bpp tile 32B, 每行 u32: 像素 i 在 nibble i (低 nibble 在前),
;;       前景色 = 索引 1, 透明 = 0

.gba
.create "../tmp/tileconv.bin", 0x081E5B940

.org 0x081E5B940
.thumb
convert:
	push {r4-r7, lr}
	; off = dst - 0x030064EC
	ldr r0, =0x030064EC
	sub r1, r1, r0
	; 源基址按字体宽度选择
	ldr r4, =0x0203FF42
	ldr r2, =0x0300656C      ; workbuf + 0x80
	ldrb r2, [r2]
	cmp r2, #10
	bne @@big
	ldr r4, =0x0203FF44      ; 小字库
@@big:
	mov r5, #16              ; 移位量: 左 = 16 (px0→bit31)
	cmp r1, #64
	blt @@rowchk
	add r4, #16              ; 下 8 行
	sub r1, #64
@@rowchk:
	cmp r1, #32
	blt @@row
	mov r5, #24              ; 右: px8→bit31
@@row:
	ldrh r3, [r4]
	lsl r3, r5
	mov r6, #0
	mov r2, #8               ; 像素计数 (左 8)
	cmp r5, #24
	bne @@px
	mov r2, #3               ; 右 3 像素
@@px:
	lsl r6, r6, #4
	lsr r0, r3, #31
	orr r6, r0
	lsl r3, r3, #1
	sub r2, #1
	bne @@px
	cmp r5, #24
	bne @@store
	lsl r6, r6, #20          ; 补 5 个空 nibble
@@store:
	str r6, [r1]
	add r1, #4
	add r4, #2
	sub r7, #1
	bne @@row
	pop {r4-r7, pc}

.pool
.close
