# 技术报告：mGBA vs gbajs2 核心机制差异与 EliteRedux 转场卡死分析

> 日期：2026-09-04
> ROM：Pokémon Elite Redux 2.65.1 beta（`roms/pker.gba`）
> 现象：mGBA 0.10.5 正常完成"开场→大地图"转场；gbajs2 在淡出完成后永久黑屏
> 方法：对 mGBA（`tmp/mgba`，commit 507061a）、gbajs2 原版（`tmp/orig-gbajs2`，commit 5f575bf）、VBA-M（`tmp/vbam`）做源码级逐项对照；对 gbajs2 stub BIOS（`resources/bios.bin`，220 字节）做完整 ARM 反汇编
> 结论有效期：基于本轮源码分析；所有"新发现"均已用二进制/源码直接验证

---

## 0. 摘要

| 编号 | 发现 | 状态 |
|------|------|------|
| F1 | **推翻旧结论**：gbajs2 stub BIOS 自带完整忠实的 VBlankIntrWait 实现（影子标志簿记 + 真 HALT 循环），并非"忙轮询立即返回" | 本轮反汇编证实 |
| F2 | gbajs2 的 swi 分发是 **HLE（irq.js）+ stub BIOS 处理器 双重处理**；HLE 层在移交给 stub 之前把真实 IF **全部清零**，而真 BIOS 从不清真实 IF | 本轮证实 |
| F3 | mGBA 的 HLE BIOS（hle-bios.s）是真 BIOS IntrWait 的忠实重实现：0x03007FF8 影子标志 + HALTCNT 真 halt + IME 编舞，与 gbajs2 的 HLE 语义实质不同 | 源码证实 |
| F4 | 三方 halt/唤醒条件均为 GBATEK 修正版（(IF&IE) 无条件唤醒，不看 IME）：mGBA `_triggerIRQ` 无条件 `halted=0`；VBA-M kSchedIrq 同样 | 源码证实 |
| F5 | gbajs2 的延迟递送链（cpsrI=1 时挂起 → 事后补递送）只依赖 `testIRQ/springIRQ`，而 **testIRQ 只在 waitForIRQ 中被调用**——I 位窗口期内挂起的一次性 IRQ 有丢失风险（mGBA/VBA-M 有成熟的重调度/成熟度机制） | 源码证实 |
| F6 | IRQ 递送延迟：mGBA = 7 周期（GBA_IRQ_DELAY），VBA-M = 5 周期（可调），gbajs2 = **0 周期同步向量** | 源码证实 |

**最重要的行动结论**：F2 中 `irq.js` case 0x04 的 `dismissIRQs(0xffffffff)` 是 gbajs2 独有的破坏性语义（真 BIOS/mGBA/VBA-M 都不清真实 IF）。删除它是一个 2 行的决定性实验（E1，见 §6）。

---

## 1. 问题背景与既有证据（复用前几轮成果）

### 1.1 卡死签名（gbajs2 确定性可复现，f6080 基准态）

- 主循环 0x08168100–0x081681B0 存活，每帧 `swi 0x5`（VBlankIntrWait）1 次/帧，健康态与卡死态相同
- 淡出已完成：调色板经 DMA3 ch3 写零（包装器 0x081686A0 → 0x08186390）
- 引擎主状态 0x03003420：cbA=0x08183A99 ≠ 期望 0x08184D75；[0x03003434]（VBlank tick 门）= 0
- 异步相位机 [0x030023D8] = 0：初始化 0x0815E1CE 从未执行（休眠态）
- 状态机 tick 0x08117740 十帧零命中；其门标志 [0x03002330] = 1 无人消费
- +2000 帧等待不自愈 → 非"慢"，是"缺一环"

### 1.2 已排除

- 我们对 gbajs2 的所有修改均为纯插桩（与 tmp/orig-gbajs2 逐字节 diff 验证）
- Flash 存档：开场流程零访问（vanilla 行为）
- BIOS 差异：gbajs2 与 VBA-M 对照时 VBA-M 用真 BIOS——但 mGBA 默认**也是 HLE BIOS** 却能跑通，故"必须真 BIOS"不成立（见 §3.2）

---

## 2. SWI 分发架构三方对照

### 2.1 总览

| 维度 | mGBA | gbajs2 | VBA-M |
|------|------|--------|-------|
| 入口 | `GBASwi16` (bios.c:403) | `irq.swi` (irq.js:341) | `CPUSoftwareInterrupt(comment)` (gba.cpp:3023) |
| 有真 BIOS 时 | `ARMRaiseSWI` 原生执行 | `raiseTrap()`（不适用，见 §2.2） | `CPUSoftwareInterrupt()` 原生执行 (gba.cpp:3073) |
| 无真 BIOS（HLE） | 逐条模拟真 BIOS 语义（含 `ARMRaiseSWI` 跳 hle-bios.s 的真形态代码） | JS switch 直解 + `raiseTrap()` 二次移交 stub | C switch 直解（swi_cycles 校准注释见 gba.cpp:3083） |
| IntrWait/VBlankIntrWait | `ARMRaiseSWI` → hle-bios.s 真形态 IntrWait | HLE dismiss-all + raiseTrap → stub 的影子协议 handler | `CPUSoftwareInterrupt()`（真 BIOS）或 HLE（无 BIOS 时走 switch，无 IntrWait 专项处理，依赖 stub） |

### 2.2 gbajs2 的运行形态（本轮确认）

`romctl.js:179` 调用 `gba.setBios(biosBin)`——**单参数**，`mmu.js:384` 使 `bios.real = false`。

由此 `irq.swi`（irq.js:343）的 `if (this.core.mmu.bios.real)` 恒为假 → 所有 swi 走 JS HLE switch。关键点：

1. **case 0x04/0x05（irq.js:395-414）**：
   ```js
   case 0x05: gprs[0]=1; gprs[1]=1;   // VBlankIntrWait 置 discard=1, mask=1
   case 0x04:
       if (!this.enable) this.io.store16(this.io.IME, 1);   // 强制 IME=1 且不恢复
       if (!gprs[0] && (interruptFlags & gprs[1])) return;  // r0=0 且已 pending → 直接返回
       this.dismissIRQs(0xffffffff);                        // ★ 清真实 IF 全部位
       this.cpu.raiseTrap();                                // 移交 stub BIOS
   ```
2. `raiseTrap()`（core.js:443）→ 切 Supervisor 模式、PC=0x0C（即执行 0x08 处指令）、cpsrI=1
3. stub 0x08：`b 0x24` → dispatcher（见 §2.3）

### 2.3 gbajs2 stub BIOS 完整反汇编（本轮新成果，纠正旧结论）

```
;======== 向量表 ========
0x00: mov pc, #0x8000000        ; reset → 直接跳 ROM
0x04: b 0x04                    ; undef: 死循环
0x08: b 0x24                    ; SWI → dispatcher
0x0c: b 0x0c                    ; pabt: 死循环
0x10: b 0x10                    ; dabt: 死循环
0x14: nop
0x18: b 0x50                    ; IRQ → handler
0x1c: b 0x1c                    ; FIQ: 死循环
;======== reset ========
0x20: mov pc, #0x8000000        ; 跳转游戏入口
;======== SWI dispatcher (0x24) ========
0x24: cmp sp, #0
0x28: moveq sp, #0x04000000
0x2c: subeq sp, sp, #0x20       ; 无栈时用 BIOS 私有栈 (IWRAM 镜像 0x7FE0)
0x30: push {lr}
0x34: ldrb r0, [lr, #-2]        ; 读 Thumb swi 立即数
0x38: cmp r0, #4
0x3c: bleq 0x68                 ; swi4  → 0x68
0x40: cmp r0, #5
0x44: bleq 0x68                 ; swi5  → 0x68（★4/5 同一 handler）
0x48: pop {lr}
0x4c: movs pc, lr               ; 其他 swi：直接返回（依赖 irq.js HLE 已做完）
;======== IRQ handler (0x50) ========
0x50: push {r0-r3, r12, lr}
0x54: mov r0, #0x04000000
0x58: add lr, pc, #0            ; lr = 0x60（IntrMain 正常返回落点）
0x5c: ldr pc, [r0, #-4]         ; ★ 跳 0x03007FFC 槽位指向的 IntrMain
0x60: pop {r0-r3, r12, lr}      ; IntrMain 返回后的恢复路径
0x64: sub pc, lr, #4            ; 异常返回
;======== swi4 & swi5 共用 handler (0x68)：忠实 VBlankIntrWait ========
0x68: push {r4, lr}; sub sp, sp, #4
0x70: strh r1, [sp]             ; 保存 mask (r1)
0x74: mov r4, #0x04000000
0x78: add r4, r4, #0x200        ; r4 = IE 寄存器
0x7c: ldrh r0, [r4]             ; 读 IE
0x80: strh r0, [sp, #2]         ; 保存 IE
0x84: ldrh r1, [sp]             ; mask
0x88: orr r0, r0, r1
0x8c: strh r0, [r4]             ; IE |= mask
0x90: mov r4, #0x04000000
0x94: mov r0, #0x1f             ; System 模式 (I=0)
0x98: msr cpsr, r0
0x9c: mov r0, #0
0xa0: strb r0, [r4, #0x301]     ; ★ HALTCNT = 0 → 真 HALT
0xa4: mov r0, #0xd3             ; SVC | I=1
0xa8: msr cpsr, r0
0xac: ldrh r0, [r4, #-8]        ; 读 0x03007FF8 BIOS 影子标志（IWRAM 镜像）
0xb0: ldrh r1, [sp]             ; mask
0xb4: and r1, r1, r0            ; shadow & mask
0xb8: eorne r1, r1, r0          ; 非零 → 从影子中清除已满足位
0xbc: strhne r1, [r4, #-8]      ; 写回影子
0xc0: beq 0x94                  ; 零 → 回 0x94 再 HALT 再查（等待循环）
0xc4: mov r4, #0x04000000
0xc8: add r4, r4, #0x200
0xcc: ldrh r0, [sp, #2]         ; 恢复 IE
0xd0: strh r0, [r4]
0xd4: add sp, sp, #4
0xd8: pop {r4, pc}              ; 返回调用者
```

**结论（F1）**：旧结论"HLE raiseTrap→stub 0x0C 立即返回=忙轮询"是**错误的**。实际链路：irq.js HLE（dismiss-all）→ raiseTrap → dispatcher → **stub 0x68 完整执行 IE|mask → HALT 循环 → 影子标志检查**。语义上接近真 BIOS，但**前置了一个真 BIOS 没有的破坏性动作**（§3.1 D1）。

**结论（F2-细节）**：swi4 与 swi5 在 stub 中走同一 handler（0x68），即 stub 不区分 IntrWait/VBlankIntrWait 的 discard 语义；mask 均取 r1。而 irq.js HLE 在 swi5 时硬编码 r0=1/r1=1，覆盖了游戏传入的参数（真 BIOS VBlankIntrWait 也是置 r0=1/r1=1，这点一致）。

### 2.4 mGBA 的 HLE BIOS IntrWait（hle-bios.s:171-195）

```asm
VBlankIntrWait: mov r0, #1; mov r1, #1     ; 落入 IntrWait
IntrWait:
    cmp r0, #0
    beq 快速返回路径
    ldrh r3, [r12, #-8]      ; 读 0x03007FF8 影子
    bic r3, r1
    strh r3, [r12, #-8]      ; 仅清除影子中 wanted 位（★不动真实 IF）
0:  strb r0, [r12, #0x301]   ; HALTCNT=0 → 真 halt
1:  strb r0, [r12, #0x208]   ; IME=0
    ldrh r3, [r12, #-8]      ; 影子
    ands r3, r1
    eorne r3, r1
    strneh r3, [r12, #-8]    ; 清已满足位
    strb r2, [r12, #0x208]   ; IME=1
    beq 0b
    ldmfd sp!, {r2-r3, pc}
```

**F3**：mGBA 的 HLE 是真 BIOS 的逐指令忠实重实现（含 `[r12,#-8]`=0x03FFFFF8=IWRAM 镜像 0x7FF8 的影子标志协议、HALTCNT 真 halt、IME 编舞）。影子由游戏的 IntrMain 维护（pokeemerald 系 IntrMain 会把已确认的 IF 位 OR 进 0x03007FF8——这是 IntrWait 协议的契约）。

---

## 3. 关键语义差异清单（按危险度排序）

### D1【最高危】HLE IntrWait 清空真实 IF —— 真 BIOS 从不这么做

- gbajs2（irq.js:412）：`dismissIRQs(0xffffffff)`
- 真 BIOS / mGBA hle-bios.s：只清 0x03007FF8 **影子**中的 wanted 位；真实 IF 由 IntrMain ack
- 后果：swi4/5 执行瞬间，所有挂起 IRQ 标志（VBlank 之外的 **TIMER0-3、SIO、DMA、KEYPAD、GAMEPAK** 等一次性 IRQ）被抹掉。若游戏在 swi5 前依赖某个刚置位的非 VBlank 标志 → **永久丢失**，且 game 侧影子永远收不到该位 → 引擎等待该事件的相位永不推进
- 与卡死签名吻合：相位机 0x030023D8 永不武装（等待的事件源被抹）

### D2【高危】IME 强制置 1 且不恢复

- gbajs2（irq.js:402）：`if (!this.enable) this.io.store16(this.io.IME, 1)`
- mGBA：IME 编舞在 BIOS 代码内（0→检查→1），且语义是 IntrWait 期间的临时状态
- 后果：游戏若以 IME=0 轮询 IF（不希望被抢占）的临界区，被 gbajs2 强制开启抢占； IntrMain 会在游戏未预期的点重入

### D3【中危】IRQ 递送延迟与模型

- mGBA：`GBATestIRQ` → `mTimingSchedule(irqEvent, GBA_IRQ_DELAY=7)`（gba.c:28,594）→ `_triggerIRQ`
- VBA-M：`CPUTestIRQ` → `gbaScheduler::Schedule(kSchedIrq, delay=5)`（gba.cpp:1054）
- gbajs2：`raiseIRQ()` → **同步立即** `cpu.raiseIRQ()`（0 周期），cpsrI=1 时静默丢弃（core.js:430），补递送仅靠 `springIRQ`（只在 waitForIRQ 中置位/消费，irq.js:123-127,730）
- 后果：gbajs2 的 IRQ 几乎总是"抢先"到达；且 §F5 的丢失窗口真实存在

### D4【中危】Halt 语义

- mGBA：HALTCNT 写 → `GBAHalt`（gba.c:601）→ `cpu->halted=1`，CPU 真停机，定时器经 mTiming 推进；唤醒 = `_triggerIRQ` 无条件 `halted=0`（gba.c:1039）——GBATEK 修正版
- VBA-M：`holdState=true`，kSchedIrq 分发时清 holdState（gba.cpp:5690），wake-on-(IF&IE) 注释明确引用 GBATEK（gba.cpp:1017）
- gbajs2：HALTCNT 写（io.js:419-424）→ `irq.halt()` → `waitForIRQ()`（irq.js:727）——JS 忙轮询 pollNextEvent，直到 interruptFlags 非零。**等价性依赖 pollNextEvent 的完整性**；`nextEvent` 为空时 `waitForIRQ` 返回 false → `irq.halt()` 抛 "Waiting on interrupt forever"（irq.js:890）——异常会直接打断 CPU 步进

### D5【低危】stub 的 IRQ 直跳协议

- stub 0x5C：`ldr pc, [0x03007FFC]` 直跳 IntrMain，无 SPSR/模式簿记，依赖游戏 IntrMain 自己完成异常返回。pokeemerald 系 IntrMain 是完整主 ISR（保存上下文、subs pc, lr, #4），可正常工作；但任何"假设 BIOS ISR 存在且有额外行为"的游戏代码会有偏差

---

## 4. 与 EliteRedux 卡死症状的映射

| 症状（§1.1） | 最吻合差异 | 说明 |
|--------------|-----------|------|
| 相位机 [0x030023D8] 永不武装 | **D1** | 武装（init 0x0815E1CE）很可能由某个非 VBlank 事件触发（定时器/一次性 IRQ），该事件恰在 swi5 的 dismiss 窗口内置位 → 被抹 |
| tick 0x08117740 零命中、flag 0x03002330=1 无人消费 | D1/D3 | 消费者依赖相位机武装后的调用链 |
| 主循环活着、VBlank handler 正常 | — | VBlank 每帧重发，自愈性强，故大部分流程正常；只有一次性事件敏感的转场段受害 |
| mGBA 正常 | F3/F4 | mGBA 的忠实 IntrWait 不动真实 IF，事件不丢 |

**注意**：D1/D2 都是"gbajs2 独有的额外动作"，方向一致——gbajs2 比真机**多做**了事（清 IF、强开 IME），而不是少做。

---

## 4.5 E1 实验结果与后续实测（2026-09-04 追加）

### E1 已执行：删除 HLE dismissIRQs(0xffffffff)

- 改动：`js/irq.js` case 0x04 不再清真实 IF（备份 `js/irq.js.bak-e1`）
- 重放：serve 重启 → replay-flow（f3068 对话完）→ +3000 帧
- 结果：**行为改变但未修复**。旧 stall 是全黑屏（调色板全零）；新状态是**全白屏**，且：
  - 主循环存活（swi5 每帧 1 次，经 stub 0x68 影子协议正常返回）✓
  - IntrMain 每帧 2 次（VBlank + VCOUNTER；TIMER2 使能但从不触发）✓
  - tick 包装器 0x08168470 计数器 [r4+32]/[r4+36] 每帧 +1 ✓
  - **但门全部冻结**：[r4+12]=0（tick 链不跑）、[r4+20]=0、phase=0x030023D8=0、0x03002330=0
  - cbA=0、cbB=0x08168689、+0xC=0x081686A1（停在淡出包装器区）

### 新增静态分析成果（ROM 字面池/Thumb 编码搜索 + 反汇编）

| 目标 | 结论 |
|------|------|
| [r4+20]（0x03003434）写入者 | **仅两处**：① 引擎 init **0x0815E088**（0x0815E0B2 `str r3,[r4,#20]`，值来自 [指针字面量] 的半字）② 0x08160068 的函数（同时写 smState 0x030023FC） |
| init 0x0815E088 的调用者 | `bl` 共 3 处：0x0815E034、0x0815E830、**0x08160462**（引擎引导函数 0x08160460 的第一条指令） |
| 引导 0x08160460 的调用者 | `bl` 共 2 处：**0x08163088**、**0x08163456** —— 均在任务池分发器内（无 BL 调用者，是**任务池 handler**，由 tick 链经函数指针调度） |
| tick 包装器结构 | 0x08168470：[r4+32]++ → [指针][][]++ → **if([r4+12]!=0) bl 0x08168684** → [r4+36]++ → bl 0x08252490 → bl 0x08251FEC |
| VBlank handler 结构 | 0x08168560：**if([r4+20]!=0) bl 0x08168684** → bl 0x08002EB4 → 影子 0x03007FF8 `|=4` → [r4+28]`|=4` |
| 第二 handler | 0x08168594：if([r4+24]!=0) bl 0x08168684 → 影子`|=0x80` |
| 热点 IWRAM 循环 0x03005DBC/E84 | m4a 音频混音器（Q24 定点+饱和运算），每帧 ~112 次迭代，经 thunk 0x0800055C 由 tick 包装器路径调用——**正常现象，非卡因** |

**结论链**：门变量只能由 init 0x0815E088 开启 → init 只能由引导 0x08160460 调用 → 引导只在任务池分发器的特定 case 里执行 → **卡死的直接原因是任务池脚本/调度状态从不推进到该 case**。与旧 stall 相同的最终缺口，但 E1 排除了 D1 是唯一根因（或有多个叠加根因）。

### 4.6 E1+无 guardian 重放 + 健康轨迹对齐（2026-09-04 深度追加）——重大反转

#### 4.6.1 mGBA 健康轨迹（v2/v3，用户实测）推翻旧诊断

| 旧认知（错误） | 健康实测（正确） |
|------|------|
| phase 0x030023D8 应武装 | **全程为 0** |
| gate20 应非零 | **全程为 0** |
| flag330/state27/smState 应变化 | **全程为 0** |
| 脚本行 0x0202802E/0x020283EE 应推进 | **全程为 0** |
| cbA=0x08183A99 = 卡死态 | **正是健康地图态的 cbA**（f6633 后） |
| “卡死签名” | **guardian 污染产物**（见 4.6.3） |

#### 4.6.2 健康流程完整时间线（用引擎内部帧计数 cnt32 对齐）

| cnt32 | 事件 |
|-------|------|
| 729 | boot 态 cbB=0x08152D75/gate12=0x08152D5D |
| 1040 | cbB=0x0820AB29（开场） |
| 1118 | **cbB=0x08168689/gate12=0x081686A1（第 1 次，仅 2 帧）** |
| 2304-2410 | setup→命名（0x0822BBD9→0x0822BBE9→0x0817CEF5→0x0817F2CD） |
| 2588 | cbB=0x0816B041（命名后） |
| **2590** | **cbB=0x08168689/gate12=0x081686A1（第 2 次）= 对话容器态，持续 437 帧** |
| 2590-3027 | 对话期：**fade 三角波每 ~65 帧一个周期**（f5 倒数 4,3,2,1,0→0x81-0x84；f7 脉冲 0→0x80→0→0x7F/0xFF），队列 qcnt 周期性 1→0 |
| **3028** | **cbB=0x08183C21 = 转场触发**（最后一个 fade 周期完成后！） |
| 3032 | BLDCNT=0x1E40 + BLDY 渐变（真淡出） |
| 3036 | **cbB=0x08183B15/gate12=0x08184355 = 地图态** ✓ |
| 3618 | 再次 0x08183B15（最终地图态） |

**核心规律：每个相位切换之前都有一个 fade 周期脉冲。fade 周期 = 相位推进的心跳。**

#### 4.6.3 guardian 污染实锤

旧 stall 基准（f6080）是 guardian 开启时录的。guardianTick（romctl.js:422）：
1. 每 128 帧强制 `IE\|=0x25`——健康流程 IE 只在 0x04/0x05/0x85 间变化，从不含 TM2 位
2. VBlank 槽清零时把引擎 EWRAM 实例（0xE64B @ROM 0x08004AB8 → 0x02027FC8）整个重注入——**任务停摆后重注入会重启引擎重新 spawn 任务，制造“已修复/已推进”假象**

结论：旧 stall 签名（脚本行 28954/1024、cbA=0x08183A99 卡住等）全部是重注入产物。**guardian 默认值已改为关闭**（romctl.js，battle 转场需要时 /guardian?on=1）。

#### 4.6.4 E1+无 guardian 的真实卡点（白屏态）

- 游戏逻辑状态机与健康**逐点一致**（cbB/gate12 对到过 0x0822BBE9/0x0822BC05、0x0817F2CD，A/START 键有响应）
- 对话容器态 cbB=0x08168689 进入正常，但**对话任务未 spawn**：任务池 64 条目**活跃数 = 0**；分发器 0x08162F14/0x081633E2 零调用（无 BL 调用者，是任务池 handler，经函数指针调度）
- fade 三角波**不再重启**（f4/f5/f7 冻结：+4=0、+5=0、+7=0）→ 相位切换脉冲缺失 → 一切等待
- 引擎异步调度器停摆：工作索引 byte[0x03005155] 停在 0x31（空槽），槽 0x30/0x31/0x32 全零；0x08251FEC 主路径每帧跑但槽空跳过
- CpuSet 每帧在跑但只是 OAM 同步（0x03003458→0x07000000）
- 硬件调色板正常、BLDY=12/BLDCNT=0x250（alpha blend）被每帧重写；白屏 = 地图 tile 未上传（VRAM 冻结）
- 对话初始化 0x0816B040（spawn 对话任务+装 cbB=0x08168689/gate12=0x081686A1）在当前卡死态零调用（早已执行过）
- fade tick 调度 0x081863DC→按 mode(+9&3) 分发：mode0→0x08186954（要求 byte+7 bit7=1 即 fade 活跃，否则立即返回）；fade 启动器 0x081876DA **无 BL 调用者/无指针引用（计算分发）**
- 所有 TM 定时器：仅 TM0 运行（音频），TM1/2/3 停（健康流程 IE 从不含 TM 位，定时器 IRQ 非驱动源）
- **flash 排除**：任务条目里 0x09018FEx 是 ROM 指针（32MB ROM 上半区），非 SRAM/flash；旧“零 flash 访问”结论基于只挂了写的日志，不可靠但此处无关

#### 4.6.5 当前前沿（下一步）

唯一缺口：**健康的“fade 周期启动者/工作槽填充者”在 gbajs2 里不起作用**。它经计算分发调用（0x081876DA 无静态引用）。已写 v4 追踪脚本（tmp/mgba-engine-trace.lua：调度器 srun/sidx/工作槽 0x30-0x32/任务池活跃字节/队列/fade 结构/定时器 ctl），待健康轨迹回填后 diff 找出第一个缺失的生产事件及其触发条件。

#### 4.6.6 突破：游戏首次在 gbajs2 推进到地图态（纯按键+单点补丁）

**按键导航发现（推翻“卡死”定论）**：主循环反汇编（0x08168100）解出完整逻辑：
- `heldKeys = 0x3FF ^ KEYINPUT`（引擎自定义边沿检测，0x08168324 每帧写 [r4+40]）
- cbA/cbB 调用条件：gate1(0x08185964)≠1 **且** 0x08160528()==0（无异步加载活动）；否则走 gate2/加载路径
- gate2(0x081858F8) 返 1 需要：①byte[base+0xFBD=0x030033B9]>1（主状态字节）②[0x03003420]==0x08184D75 ③helper 0x0815EB84 ④[0x030040FC]∈{0x08185355,0x08185329} ⑤消费旗 ⑥fade+7>127 ⑦fade+10 bit2
- 地图回调 0x08183B14 首行检查**有符号半字 [0x020391FA]（fade+14）**，<0 则跳过整个函数体（含调度器+fade tick）

**实测结果**：重放→A 键导航（对话容器 A→菜单、START→起名容器、A 推进）→ **地图态 cbB=0x08183B15 到达**（无需补丁！）→ 打 +14=0 单点补丁 → **地图回调恢复每帧执行，调度器/fade tick/任务池全部复活**（任务 0/60 活跃，BLDY 振荡）。

**最后一层缺口**：地图资产链未完成——① sidx 停在 0x55（健康在地图切换时 0x27→0x2C 连跳，工作项入队由 0x08252354 提交）②队列 64 项为陈旧计数（描述符表全零，消化无效果）③真实 tile 上图生产者 0x08253810（唯一直调者 0x081B7A66=地图 tile 加载器，计算分发）零触发 ④状态字节被游戏逻辑重置回 0（资产未加载→世界未就绪）→ gate2 关闭→全部停。任务 0/60 handler（0x08134E71/0x08132E49=脚本解释器）**零调用**（分发器→选择器 0x08254E70→handler 的链路断）。任务脚本的推进机制 = 下一层 RE 目标。

**已修工具坑（本轮）**：callertrace TDZ bug、watchwrite palette 块缺 store8、callertrace 栈读 loadU32→load32、watchwrite 闭包捕获首调用 wa/wl（换目标无效——需重启 serve）。


#### 4.6.7 第二轮深挖：地图加载链五层根因逐层击破（最新会话）

**方法**：多钩子埋伏（/hookadd 支持 Map 多实例，事件含 r0-r3）+ 全流程重放 + callertrace/watchwrite 动态追踪。

**第一层：gate12 卸载死锁（已修，ROM 补丁）**
地图回调 0x08183B14 的逻辑实为：读 `ldrsh r7,[0x020391EC+14]`（fade+14 组号）→ 主体每帧都跑；**帧尾若 +14<0 则装 gate12=0x08184355（队列消费者），帧头若 +14<0 则先卸载**。消费者只经 tick 包装器（0x08168470 的 [r4+12] 分发）派发，而包装器在回调主体内运行——此时 gate12 恒为 0（本帧开头刚卸载）→ 消费者永远赶不上。健康地图阶段 +14≥0（不卸载，转场装的 0x08184355 持久）→ 消费者每帧跑。
- **修复**：/rompatch 端点（romctl.js 新增：直接改写 ROM 缓冲 + invalidatePage 失效 icache）把 0x08183B9E 的 `mov r0,#0; bl 0x08168418`（卸载调用）改成 `b 0x08183BA4`（字节 01 E0）。注意 0xBF00（NOP）在 gbajs2 未实现会触发 Illegal instruction，须用短跳转。
- 效果：gate12 持久，队列消费者每帧跑（调用栈实证：解释器→任务→调度器→gate12→消费者）。

**第二层：异步加载器结构未初始化（已修，内存补丁）**
0x08160528 读 byte[0x030023AF]（引擎总模式旗）：非 0 → 主循环走加载路径。我们的值卡在 0xAF，加载器结构 0x02022C8E 却是 0F0F 未初始化垃圾（mode=255、block=15）→ 加载器永远无动作 → 模式旗永不清零 → cbA/cbB 永不执行。
- **修复**：poke block(0x02022D7D)=0、mode(0x02022C9A)=0 → 加载器 mode-0 循环复活 → **0x030023AF 自动清零**（无需手动恢复）。

**第三层：引擎 tick 使能（已修，poke）**
byte[0x03003898]=0 → tick 包装器（0x08168460，注册于 IntrMain TM1 槽）被禁。poke=1 后恢复。

**第四层：地图资产链复活（实证）**
tile 流拷贝确认工作：队列条目 src=0x089E63C0/0x08A4CF00/0x08A4D100 → dst=VRAM 0x06010000/0x06010200，CpuSet(swi 0xB HLE) 每帧执行，VRAM 0x06010080 起与 ROM 源逐字节一致（源前 0x40-0x80 字节为透明 tile 的零，非异常）。**注意：此前误判"VRAM 零变化"是因为只读 VRAM 头 16-64 字节（恰好是透明 tile）。**
fade 完成：+4 level→0、+7→0x00、+14→0；DISPCNT 强制白屏位（0x4000）随状态字节=2 的 poke 被清。
场景 0（0x02021DBC）步字段 [+28] 从 0xFF 变 0 —— **地图场景首次启动**。

**第五层：剩余缺口——地图脚本/元数据未加载（未解决）**
- 工作槽系统（0x03004940 位图 + 0x03004954 槽表 128×16B + srun 0x03005154/sidx 0x03005155）在健康全程活跃（sidx 从 boot 持续推进、转场时 5 槽连续提交），我们的槽表=0x0C0C 未初始化垃圾、sidx 卡 0x69、submit-A（0x08252354，唯一用槽表的提交函数）全程零调用（计算分发）。已手动清空槽表+sidx 归零（系统现干净待命）。
- 场景重启循环：任务包装器每帧"停止场景（0x0811F816：步=FF+清 bit6/7）→启动场景（0x0811F67C：步=0+置 bit6）"——地图自己的脚本数据未加载进场景表，bit7（运行中）永不置位，解释器始终走休眠路径。
- 状态字节 0x030033B9 保持 0（被 poke 为 2 后能保持，DISPCNT 强制白屏位随之清除，但 BG 使能层需要更完整的世界状态）。
- **下一个目标**：工作槽提交链的入口（健康转场提交的 5 槽内容=地图元数据/脚本加载）；以及地图脚本加载器（场景表 0x02021DBC 的写入者除解释器外的第三方）。

**工具坑（本轮新增）**
- watchwrite 闭包捕获首个请求的地址（换目标需重启 serve）——已再次踩坑确认。
- 0xBF00 NOP 未实现 → ROM 补丁用短跳转代替。
- /memread 大范围读要分块（单次上限）；serve 重启后 ROM 补丁丢失需重新 /rompatch（内存快照含 gate12 等 poke 会恢复）。
- __swiLog 只在 /load 时初始化，重启后为 undefined（已在 romctl.js 启动时补 `gba.__swiLog ||= []`），irq.js CpuSet HLE 已加日志（op=cpuset）。

### 4.7 存档-CONTINUE 快速通道 + 音频/渲染链路修复（2026-09-04 晚间追加）

**重大突破：绕过开场直达大地图**
- mGBA 产出的 `roms/pker.sav`（128K+16B mGBA 格式）经 `/loadsav` 注入 FlashSavedata 后，**全新启动即走 CONTINUE 语义路径：~318 帧直达大地图态（cbB=0x08152D75，与 mGBA 健康 dump 完全一致）**。带 E1 补丁时反而要 1400+ 帧（E1 已用 git checkout 还原，备份在 tmp/irq.js.e1-version）。
- 健康 dump（tmp/mgba-dump-mapphase.log）对照结论：健康大地图态下 LOADER(0x02022C8E)/WORKSYS(0x03004940)/QUEUE(0x0203E41C) **全零=正常空闲**；cfg 指针 [0x0201CC0C]（69 处 ROM 引用，注意不是早前误判的 0x02010CCC）健康时**同样为 NULL（flush 的 NULL 分支=正常态）**；场景表 0x02021DBC 与我们完全一致（0/432 差异）。
- BG1 tilemap（0x06005000）健康时也是全零——**地图=BG1 全屏 tile0（草地）**，健康 DISPCNT=0x3641（BG0 未使能！bit14=Win1 不是强制消隐——强制消隐=bit7=0x80，此前长期误读）。

**写只读寄存器 open-bus 语义差异（新核心差异 D-音频）**
- 症状：游戏声音驱动无限轮询 DMA1CNT_H（0x040000C4）→ gbajs2 对写只读 DMA/FIFO 寄存器的读取**恒返回 badMemory[0]** → 游戏等的标志永不出现 → 死循环 → runFrames 永不返回 → 单线程 HTTP 服务器整体饿死（无画面无声音无日志）。
- mGBA 语义：读返回最后写入的总线值 → 游戏正常。
- 修复（js/io.js loadU16 的写只读 case）：`return this.registers[offset >> 1]`（返回最后写入值）。修复后 0xC4 轮询警告从每帧刷屏降为 0。
- 派生症状"哔哔声"= 旧调试快照里游戏逻辑卡死，音乐引擎冻结，只剩方波寄存器残值恒响；音频寄存器 1 秒零变化=引擎冻结的判据。

**serve 音频链路（Node 无 Web Audio 的完整方案）**
- 产出：gbajs2 音频引擎照常混合写入环形缓冲（32768Hz）；Node 下需手动补齐 buffers（audio.js 的环仅在 AudioContext 存在时分配），并放大到 4×（65536 样本≈2s，60 帧/1s 爆发不覆盖）。
- 传输：`GET /audio?cid=标签ID` 增量拉取（float32 交错 L/R 二进制）。**cid 必须每标签独立指针**（audioSentByPid 表），否则多标签互相偷流。
- 播放：memview 构造纯 `GameBoyAdvanceAudio` 实例，把拉到的样本按 writeSample 语义喂进它的环——**消费路径与原本地模式完全一致（audioProcess: resampleRatio 重采样+outputPointer 欠载保护）**。
- 纯音频实例的四个隐式陷阱（全部踩过）：
  1. `clear()` 才是状态初始化器（samplePointer/outputPointer 在其中），构造器不调它 → 必须 `clear()` 前补 `core={irq:{FREQUENCY:16777216,pollNextEvent(){}}}`（clear 读 this.core.irq.FREQUENCY）；
  2. `jsAudio→destination` 的连接藏在 `writeEnable()`（游戏写 0x84 才连）→ 必须手动 `jsAudio.connect(destination)`，否则 audioProcess 永不触发（proc=0 静音）；
  3. 环需扩到 2s（默认 0.5s 会被 60 帧爆发覆盖）；
  4. outputPointer 从写指针后方 0.25s 起步，避免播陈旧历史数据。
- 推帧节流：memview playLoop **必须实时节流**（帧数×16.7ms）。不节流时本机 20 倍速推帧 → 音频产出速率远超消费 → 环溢出 → 音乐变噪音/静音。
- 多标签：无 409 接管（用户要求），各标签独立 cid 音频流。

**诊断工具教训（CLI vs HTTP 活体）**
- serve 运行时 `node romctl.js screenshot`（CLI）为只读，读的是**落盘快照（滞后≤600 帧）**——本轮所有"白屏"截图全是快照假象，实际画面早已渲染（56-151 色地图）。**活体画面必须用 HTTP `/shot`**。
- serve 崩溃免疫：浏览器中途断开（关标签/刷新）触发未处理 ECONNRESET 会带崩整个进程——已加 res/req error 监听 + clientError + uncaughtException/unhandledRejection 兜底。
- 静态文件由 serve 自身提供（/memview.html、js/、resources/），启动时自动开浏览器；页面为 serve-only（无本地模式），autoStartIfLoaded 自动接续 serve 已载 ROM。

### 4.8 WebSocket 推送通道（2026-09-04 深夜追加）——画面卡顿的最终根治

**背景**：HTTP 轮询架构下即使加了大批次+面板降频，页面仍然"卡卡的"。

**三层叠加根因（按发现顺序）**：
1. **画面攒批**：16帧/批才推一次 BMP → 模拟 60fps 但视觉只有 4fps。修复=每帧推 BMP（帧消息缓冲复用，避免每帧 Buffer.concat 分配 115KB）。
2. **Windows 15.6ms 系统定时器粒度**：Atomics.wait/setTimeout 全被量化到该粒度——睡 5-10ms 实际睡 15.6ms，每帧膨胀到 ~28ms=33fps。修复=泵内残余(<25ms)用忙等（performance.now 自旋）消除；仅游戏运行时段占约半核，空闲不进此路径。
3. **同步泵饿死事件循环**：preciseSleep 是同步阻塞，泵的 while(true) 不再 await → 事件循环永不还栈 → HTTP upgrade/WS 收包**全部饿死**（serve 活着但无响应）。修复=每帧循环加 `await new Promise(r => setImmediate(r))` 还栈处理 I/O。**教训：任何"精确睡眠"混入 async 循环都必须中间让出事件循环**。

**最终架构**：
- 手写最小 WS 服务器（romctl.js，无 npm 依赖）：HTTP Upgrade 握手 + SHA-1 accept（crypto 模块）+ 帧解析（客户端掩码解除/分片重组/ping-pong/close）
- **服务端帧泵**（唯一推帧方）：有 playing 客户端才跑；每帧 `runFrames(1)` → 推 BMP → `wsPushAudio` → `setImmediate` 让栈 → 忙等补齐 16.7ms
- 实测：**60fps 视觉 + 音频 100% 实时**（5.03s/5s）；工作耗时 5-12ms/帧
- 协议：客户端→服务端 JSON `{t:'hello'|'play'|'pad'}`；服务端→客户端 二进制 `[type,0,0,0]+payload`（type1=BMP、type2=float32 交错音频，4 字节头保证 Float32Array 视图对齐）
- 多客户端：每连接独立音频游标；帧=全体 playing 广播
- 断线重连：客户端 2s 自动重连+续播
- 职责划分：**WS=推帧+推音频+即时按键（<5ms）；HTTP=加载/截图/面板等低频请求（不再与帧推送抢连接池）**
- 诊断遗留：泵内 `[pump] run=.. bmp+send=..` 计时日志（每 512 帧）保留，可随时看帧耗时

**调试期间的 serve 崩溃教训**：`taskkill /F /IM node.exe` 会把 pi agent 自己（也是 node）一起杀掉——终止 serve 一律用 romctl 自带的锁文件 PID 机制（直接再跑一次 `node romctl.js serve` 即可）。

### 4.9 2026-09-05 决定性突破：BIOS 保护读 open-bus 语义（D-新，两个 ROM 黑屏的共同根因之一）

**症状**：① 红龙传说（西语蓝宝石改版）NEW GAME 后转场立即永久黑屏；② pker.gba (EliteRedux) 开场→本体转场黑屏（此前分析见 §4.5-4.7）。

**根因（红龙传说，已修复+验证通关）**：
- gbajs2 旧代码：BIOS 区（0x0000-0x3FFF）保护性读取（PC 在 BIOS 外）走 `BadMemory.load32`，返回 **“当前指令半字 | 半字<<16”**（Thumb 下 = 当前指令后半字复制，如 0x68456845，**恒为正数**）。
- 真机/mGBA 语义（mGBA memory.c LOAD_BIOS + biosPrefetch）：返回**最后一次 BIOS 区预取的指令字**（实践中恒为 0xE... 的 ARM 操作码 → 有符号数为负）；mGBA 的 HLE SWI 后固定 0xE3A02004。
- 游戏触发链（红龙传说）：NEW GAME → LoadMapFromCameraTransition → InitBackupMapLayoutConnections(gMapHeader) → 起始地图 connections=NULL → `ldr r1,[r0=#0]` 解引用 NULL → 期望返回负数使 `cmp r1,#0; ble` 跳过循环；gbajs2 返回 0x68456845（正）→ 循环 **0x68456845≈17.5 亿次**（r5 指针同步增长为非法地址 0xA0xxxxxx），主线程永久卡死在地图连接处理 → 黑屏。每帧 ~2592 次迭代（pchist 铁证），16 分钟才减 ~1.2 亿 → 等于永不结束。
- mGBA 健康 dump 对照发现旧报告误判：LOADER/WORKSYS 区的 0x0FFF0FFF 哨兵是**游戏正常写入**（转场时 FastCpuSet 预填充，红龙/EliteRedux 同构），03003898=00、状态字节 0 也是健康态 → §4.6.7 的“层2/层3 修复”作废。

**修复（三处，语义对齐 mGBA）**：
1. `js/mmu.js`：MMU 新增 `biosPrefetch`（初值 0xE3A02004）；BIOSView 5 个 load 路径的保护分支改返回 biosPrefetch 对应 8/16/32 位切片（不再走 BadMemory）。
2. `js/core.js`：raiseTrap 设 biosPrefetch=0xE1B0F00E（stub SWI 出口 movs pc,lr）、raiseIRQ 设 0xE25EF004（stub IRQ 出口 sub pc,lr,#4）。
3. `js/irq.js`：HLE swi 入口设 biosPrefetch=0xE3A02004（对齐 mGBA GBASwi16）。

**验证（红龙传说全流程通过）**：NEW GAME → 女神故事过场（正常显示图文页）→ 野外 → 遭遇战（"¡Un PIDGEY salvaje!" → RATTATA 出击 PLACAJE）全部正常；修复前卡死循环 0x88b908c（RTC 读函数）区域消失，steps/frame 从 97k 降到 29-34k 健康值。

**修复后 pker.gba (EliteRedux) 新前沿**：转场仍黑屏但性质更清楚——
- 转场时游戏正常执行：gMapHeader 清零（0x81a6973）、LOADER 区 0x0FFF0FFF 哨兵填充（FastCpuSet @0x83b4392 ← 0x081457E6，与红龙同构函数）都发生了；mGBA 健康 dump 证明哨兵/tick=0/状态字节 0 均为健康态。
- 卡死签名收敛为**唯一缺口**：fade 结构 +14 (0x020391FA，有符号半字) 从 boot 起恒为 -1，全程（含转场后）**零写入**（watchwrite 0x020391FA/0x020391F8 实证，+12 每帧被 0x81863ac/0x818640a 写 0/-1 但 +14 无人写）。
- 后果链（hook 0x08168418/0x08183B14 实证）：地图回调 0x08183B14 每帧读 +14<0 → 帧头 `0x8168418(0)` 卸 gate12、帧尾 `0x8168418(0x08184355)` 装 gate12 → 消费者经 tick 包装器（回调主体内）派发时 gate12 恒 0 → 地图脚本/资产队列消费者饿死 → 黑屏。
- **下一步**：找健康流程中转场时写 fade+14（≥0 地图组号）的代码（+14 无直接字面量，经 fade 基址+偏移访问；转场族函数 0x8183C21/0x8183C96/0x8183D68 状态机嫌疑最大）；以及该代码在 gbajs2 下不执行的前置条件。

**本轮工具修复（romctl.js）**：① `/watchwrite?len=` 支持 0x 前缀（原 parseInt(…,10) 把 0x1C 解析成 0 → 范围长度 0 → 永不命中，此前多轮“零写入”结论作废）；② /load 经 mmu.clear() 重建块后 watchwrite 自动重包装（记录块身份）；③ watchwrite/watchdma 支持 tail=4000 全量导出；④ hookadd 支持 xregs=5,6,7 额外寄存器；⑤ 新增 /wwdebug 端点。注意：hook 块首 PC 匹配下函数入口可能永不命中（进块路径不同），循环体/返回点地址更可靠。

### 4.10 2026-09-05 第二个核心发现：CPU 半字访问对齐/符号扩展缺陷（已修复，pker 黑屏的直接机制之一）

**pker 卡死态的真 gate（纠正上文 +14 红鲱鱼）**：地图回调 0x08183B14 的等待门是 `mov r7,#7; ldrsh r7,[fade_base,r7]` —— **非对齐 LDRSH**（地址 fade+7，奇地址）。ARM7TDMI/mGBA 硬件语义：16 位加载强制 bit0 清零 → 实际读 fade+6 处半字（字节 [+6],[+7] = 00 80 → 0x8000 → 符号扩展后 **-32768 负数**）→ `cmp r7,#0; blt` 成立 → epilogue 卸载 gate12(0)、跑完加载体后重装 gate12=0x08184355 → tick（0x8184354：队列泵+fade tick 0x8186390）每帧被派发 → fade 推进、完成、+7 bit7 清零 → gate 变正 → 等待结束正常推进。健康 dump 中 gate12=0x08184355 常驻安装证实此设计。

**gbajs2 缺陷（js/arm.js + js/thumb.js，8 处）**：
1. LDRSH/LDRH/STRH（ARM+Thumb 全部 6 处）**无对齐掩码**：`load16(addr)` 直接用奇地址按字节序读 → 读到字节 [+7],[+8] = 80 40 → 0x4080（正数）→ gate 判定翻转 → gate12 永不安装 → tick 饿死 → fade 冻结在 +0..3=0xFFFFFFFF → 黑屏死锁（与 §4.9 的 +12 镜像早退、tick390 零命中全部互洽）。
2. LDRSH（2 处）**无符号扩展**：load16 返回无符号值直接入寄存器（0x8000 应为 -32768 却变 +32768）；同查获 LDRSB（2 处）同病。

**修复**：LDRH/STRH 加 `& 0xFFFFFFFE`；LDRSH 加掩码 + `(v<<16)>>16` 符号扩展；LDRSB 加 `(v<<24)>>24`。

**修复后状态（pker 仍黑屏，新前沿）**：gate12 安装恢复（g12set 2 次/帧 = 卸+装）✓，但流程仍卡：① cbA（0x08183A98）入口检查 `[0x02032038]==0x08183B15` 失败（0x02032034 区 64B 全零）→ 相位联动断裂；② mapcb 体每帧提交 1 个队列任务（0x8117FF0，队列 desc 0x0203E41C：flag=01/count=0x40/项指向 0x089E63C0）后 flush（0x811824C(0xC20)）；③ gate12 派发者未找到（maptick 0 命中，但健康期 trtick 0x081686A1 能被派发 → 派发器存在且有附加条件）；④ fade 卡死值 +0..3=FFFFFFFF/+4=80/+5=03/+7=80/+8=40/+B=02 不变。**转场 fade 序列实测**：f10251 fade#1 正常完成（BLDY 2→16 递增、+A=0x20 done 位、0x8186A3C 清 +7 bit7，全套完成序列工作正常）；f10274 fade#2（写者 0x81864C8，caller 0x822BCB3）BLDY 14→0 递减到 target；f11352 fade#3（caller 0x817CF7D）启动后无任何步进。**下一步**：读 [0x03007FFC]=0x0300389C 处 IRQ 处理器找 gate12 派发者 + 查 0x02032038 应由谁写。

**工具**：tools/disasm-rom.js 独立 ROM 反汇编器（node 直读 ROM 文件，不依赖 serve 状态）。

## 5. 决定性实验设计（在 gbajs2 上直接做）

### E1【已执行，见 §4.5】删除 HLE dismiss——结果：行为改变（黑→白）但未修复

E1 补丁保留（语义上正确：真 BIOS 不清真实 IF），后续实验在其基础上继续。

### E2【观测】SWI/IRQ 全量追踪（对照 mGBA Lua 追踪）

在 irq.js swi case 0x04/0x05 入口记录：r0、r1、dismiss 前 IF、dismiss 后 IF、影子 0x03007FF8、IME、cpsrI。
在 raiseIRQ（irq.js:765）记录：来源标志、cpsrI、IME、递送 or 静默丢弃。
与 `tmp/mgba-engine-trace.lua` 的 mGBA 健康轨迹逐帧对齐，找第一个分歧帧。

### E3【若 E1 通过后的加固】恢复 7 周期 IRQ 延迟 + springIRQ 补递送泛化

把 `cpu.raiseIRQ()` 同步向量改为调度（对齐 mGBA GBA_IRQ_DELAY=7），并把 springIRQ 的消费从 waitForIRQ 扩展到主 step 循环，消除 F5 丢失窗口。

### E4【若 E1 不通过】逐项做 D2（去掉 IME 强制置 1）、D4（waitForIRQ 抛异常路径加固）

---

## 6. 修复后的验证标准

1. 确定性重放 f6080 基准态 → 快进 ≥ 3000 帧 → 大地图画面出现（截图 BMP 比对非黑屏）
2. 会话快照/重放帧号不变性保持（不破坏既有确定性基准）
3. pokéruby/pokefirered 等既有版本回归：转场、战斗、菜单全通

---

## 7. 源码位置索引

| 机制 | 文件:行 |
|------|---------|
| gbajs2 swi HLE | js/irq.js:341（swi）、395-414（case 0x04/05） |
| gbajs2 raiseTrap/raiseIRQ | js/core.js:443 / 429 |
| gbajs2 dismissIRQs | js/irq.js:777 |
| gbajs2 waitForIRQ | js/irq.js:727 |
| gbajs2 HALTCNT | js/io.js:138,419 |
| gbajs2 springIRQ | js/irq.js:123,762 |
| gbajs2 BIOS 装载（real=false） | romctl.js:179、js/mmu.js:384、js/gba.js:104 |
| stub BIOS | resources/bios.bin（§2.3 反汇编） |
| mGBA GBASwi16 | src/gba/bios.c:403 |
| mGBA HLE IntrWait | src/gba/hle-bios.s:171-195 |
| mGBA GBATestIRQ/GBAHalt/_triggerIRQ | src/gba/gba.c:590/601/1035 |
| mGBA GBA_IRQ_DELAY | src/gba/gba.c:28（=7） |
| VBA-M CPUSoftwareInterrupt | src/core/gba/gba.cpp:3023（3073 真BIOS分发） |
| VBA-M CPUTestIRQ/halt-wake | src/core/gba/gba.cpp:1017-1075、5690 |
| VBA-M lost-wakeup 注释（SIO） | src/core/gba/gba.cpp:1121-1140 |
