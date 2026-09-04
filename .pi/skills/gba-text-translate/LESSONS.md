# gba-text-translate LESSONS

> append-only；每条带日期 + ROM 名。recurring 模式（≥2 次）蒸馏进 SKILL.md 第六节。
>
> ⚠ **2025-09-03 事故记录**：本文件曾被误整体覆盖（原 #1-19 丢失，未入 git）。
> 已蒸馏进 SKILL.md 的内容无损（见 SKILL.md §六 踩坑清单 #1-21：id 主键/指针扫描/
> append_addr/多引用/重音区/控制码/标点/质量门槛/CSV BOM/残尾 FF/LZ77/重叠串/
> 码表歧义/丢控制码/FD 占位符/基座选型/conflict 恢复/空格对齐/代码区护栏/CSV 排序/
> id 大小写）。原文件经验要点按已知摘要重建于下，细节以 SKILL.md §六 为准。

## 2025-09-02 XTREME/RY 时代（重建，原 #1-13）

- R1. 子 agent 并行翻译首轮约 7% 丢 [/n][/p] → 门禁拦截后打包加严重试可达 100%
  （后被 {{C0}} 占位符机制性消除）
- R2. **async workflow + 「先写完文件再自检」**：glm-5.3-flash 400 条/批 30 分钟超时率
  约 40%（多为写完文件没来得及自检）→ 换 mimo-v2.5（原 #4）
- R3. 指针表条目引用数常见 1-4 处；repoint 全改漏扫 = 中英混显（watch-read 补抓）
- R4. FD 占位符跨基板语义不同（fd01=玩家等），token 原样保留即可
- R5. Excel 存 CSV 必须「CSV UTF-8」，校验失败先怀疑格式

## 2025-09-03 引号实证与停止符修复（RY 项目）

17. **引号字形改串实证法**：改主菜单串（Quetzal @文件 0x137E070）为 B1×4/B2×4/B3×4/B4×4，
    romctl 按 load→run 1602→START 180→run 600→run 3600→run 1500 时序截图：
    **B1=“（6形，头下尾上）B2=”（9形）B3=‘ B4=’**，与 pret 码表一致。
    旧 wholewords B2=["] 且 B1/B3 缺失 → 前后引号混同；gui_related translator.py 的
    ‘→B4/’→B3 单引号映射是**反的**，勿照抄。wholewords/charmap-base 已修正。
    ⚠ B4 码表标 ASCII '（字形即 ’）：撇号/后单引号共用，重导出 en 无变化零冲突。
18. **翻译串行/吞串根因 = 普查 max_bytes 虚高**：export-missing 旧版用 text.length+1
    （token 展开后字符数 ≠ 字节数，如 ['] 3 字符只占 1 字节）→ insert 残尾清 FF
    越界抹掉下一条串头部。已改 FF 实测位置；insert 另加终止符护栏
    （逐行扫 FF 定真实串长，CSV 不符记 budget_fix，找不到 FF 拒写）。
19. **存量数据迁移**：码表引号变更后旧 CSV en 含 `"`/`["]`/`[']`（新码表不可编码，
    worker 照抄 token 会被 H2 拒）→ migrate-quotes.js 一次性迁移（en 直映射、
    译文 ASCII " 配对、重导出假冲突自动恢复）；RY 实测 58 行修复，dump 合并 0 冲突。
20. **门禁加强**：apply/validate 新增残留英文硬拒绝（en∩zh 共有 ≥4 字母词）；
    overrides.json 译文同样过门禁；worker prompt 明确“引号用成对 “ ”、码表外字符会被拒绝”。
