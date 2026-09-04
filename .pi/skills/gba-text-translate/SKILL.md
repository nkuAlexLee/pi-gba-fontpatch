---
name: gba-text-translate
description: GBA 宝可梦改版 ROM 文本汉化流水线（基于 gba-font-crack 的字库成果）：指针引导导出+全 ROM 盲扫普查、{{C0}} 占位符控制码保护、LLM/人工双轨翻译、自动排版（CJK 禁则/文本框折行）、乱码识别与缺字替换、导入前门禁校验、原地覆盖与扩容重指向回填 ROM。当需要把改版 ROM 的英文文本翻译为中文、批量提取/回填游戏字符串、处理文本超长需改指针指向、翻译结果乱码或丢控制码的问题时使用。
---

# GBA 文本汉化流水线

> **前置条件**：目标 ROM 必须已完成中文字库注入（`../gba-font-crack/`，整库路线），
> 否则中文无法渲染。本 skill 解决"文本内容汉化"；渲染能力问题归 gba-font-crack。
>
> **★ 分工**：字库/引擎/hook/截图验证 = `gba-font-crack`；字符串批量提取、
> 翻译协作、回填 = 本 skill。两者共享同一套码表（wholewords.txt 体系）。

## 一、先懂三件事（路线、基座、保护流）

### 1.1 写入策略决策树

中文 3B(ESC)/2B 字、12px；英文 1B/字、~8px。中文串通常比英文短 → 多数原地覆盖：

```
译文编码+FF ≤ 原串字节数？
├── 是 → 【原地覆盖】指针零风险（insert 自动走这条）
└── 否 → 全 ROM 指针扫描（4B 小端 == 0x08000000+偏移；≥min_pointer_source 护栏）
    ├─ 有引用 → 【repoint】新串写 append_addr（4B 对齐），指针全部改指，原址清 FF
    └─ 无引用 → 跳过+报告（偏移表/运行时指针/LZ77，需人工分析）
```

⚠ 定长缓冲（玩家名/昵称/Box 名）只能原地且上限更小，宁短勿长。

### 1.2 基座选型（决定翻译能力上限，先于一切）

| 基座类型 | 中文能力 | 能翻什么 |
|----------|----------|----------|
| 双字节引擎（Quetzal/RechargedYellow/红龙传说字库版） | 全量字库 | **整句对话** ✅（RY 闭环已验证） |
| 整库 ESC（EliteRedux v7，[F7][hi][lo] 3B/字，fontid 0-8 全渲染器 hook） | 全量字库 | **整句对话** ✅ |
| 槽位注入（XTREME，码 0x87+ 单字节槽） | 仅几个槽位的字 | 词级替换（菜单项 ≤6 字）|

- 实证工具：`node scripts/probe-dualbyte.js <rom> <renderText地址>`
  （窥视指令 `ldrb rX,[rY,#1]` = 支持双字节的必要特征；XTREME 完全无）
- 判别：码表含双字节汉字码（wholewords 体系）→ 双字节/ESC 引擎；仅 0x87-0x9F 单字节槽 → 槽位
- 新 ROM 实证流程：hook 窥视处 + 写入双字节测试串（0E 4D 03 0B FF）渲染一次

### 1.3 两阶段保护流（★核心机制，2025-09 起）

```
en ──protect──► {{C0}} 占位符文本 + codes 映射 ──► worker 纯流式中文 ──restore──►
空格对齐 ──► 标点归一 ──► wrapText 自动排版 ──► 预算校验 ──► 原地/repoint 回填
```

- **保护**：原文 `[...]` 控制码 → `{{C0}}` 编号占位符。worker 只需保留占位符，
  从机制上杜绝丢 token（旧流程丢 token 率 7-40%）
- **自动排版**：worker 不管换行（原文换行也变占位符保留）；apply 端 restore 后
  wrapText 按 32 宽度单位/行、2 行/框重新排版（CJK 禁则：句读不开行首、
  开括号不开行尾；复合词/控制码不拆）
- **空格对齐**：译文前后空格强制与 en 一致——游戏常用"指向串内部（跳过空格）"
  的指针，空格错位 = 指针落在多字节中文码中间（症状：只显示后半字）
- 占位符之外的硬性预算仍需遵守：`纯中文 ≤ (max_bytes-1)/3`(ESC) 或 `/2`(双字节)

## 二、翻译工程结构（单一事实源）

```
translation/                    # 或自定义 --project 目录
├── project.json                # ROM/码表/append_addr/输出/escPrefix/subst/min_pointer_source
├── overrides.json              # 可选：{id: 译文} 人工兜底（apply 最高优先级）
├── subst.json                  # 可选：{缺字: 近似字}（如 {"椪":"梧"}）
├── glossary.csv                # 术语表：en,zh（AI 和人工都必须遵守）
├── strings/<场景>.csv          # id=8位hex文件偏移（稳定主键）
└── report/                     # 任务包/校验报告（不手改）
```

**CSV 列**：`id,addr_gba,scene,context,max_bytes,max_chars,en,mt,final,status,notes`

| 列 | 谁写 | 说明 |
|----|------|------|
| en | 工具 | 原文，锁定 |
| mt | AI | 机器初译 |
| final | 人 | 人工终审，非空则导入优先 |
| status | 工具 | untranslated → machine-translated → human-reviewed；conflict/locked 不导入 |
| max_bytes | 工具 | 原串字节数+终止符 = 原地覆盖预算；超出走 repoint |

status=conflict 的恢复：notes 含「原串已消失」且 mt 非空 → 改回 machine-translated
（系旧版 add 全表合并 bug 误标，已修复）。

## 三、工具链（scripts/，bash 调用）

```bash
cd .pi/skills/gba-text-translate/scripts

# ⓪a 基准码表：wholewords + pokeE PMRSEFRLG 补缺 → charmap-base.txt
node merge-charmap.js
# ⓪b 官方术语表（对照表 4137 条；数据源 D:/vibecoding/gui_related/translate）
node build-glossary.js [数据源目录]
# ⓪c PokeAPI 官方译名（8 类多语言 CSV → 与对照表合并，旧条目优先）
node build-glossary-pokeapi.js          # 默认读 assets/pokeapi → assets/glossary-pokeapi.csv

# ① 初始化工程（之后手工核对 project.json：append_addr 空闲区 / escPrefix / min_pointer_source）
node export-strings.js init --project <目录> --rom <ROM路径>

# ② 提取：dump 指针引导导出（首选）→ 普查补漏（必跑）
node export-strings.js dump --project <目录> --scene main-text
#    自带置信保险: noHan/语言一致性/可读率≥90%/重叠别名剔除/中段半句回溯/极短串词法
#    参数: --from/--to 限定；--lang en/zh；--min-ratio 0.9
#    盲扫 scan / 密度探测 probe / 单条 add：见各文件头
node export-missing.js --project <目录> [--add]   # ★全 ROM 普查：改版自定义文本
#    多为运行时引用，指针 dump 必有盲区；4 秒扫 32MB，--add 自动登记

# ③ AI 翻译：prepare 生成任务包（{{Cn}} 占位符+codes+预算）→ worker 翻译 → apply
node translate-batch.js prepare --project <目录>
node translate-batch.js apply --project <目录>
node translate-batch.js set --project <目录> --scene <名> --id <ID> --col final --text "..."

# ④ 人工终审：编辑 strings/*.csv 的 final 列（CSV UTF-8，勿 xlsx）

# ⑤ 门禁（H1 空译/H2 缺字/H3 控制码不一致 = 硬错误禁止导入；--strict 升级术语警告）
node validate.js --project <目录>

# ⑥ 回填（--dry-run 看策略；--allow-mt 机器译直接上）
node insert-strings.js --project <目录> --dry-run
node insert-strings.js --project <目录>

# ⑦ 验证：gba-font-crack 的 romctl 加载输出 ROM 截图核对
```

**协作规则**：AI 只经 translate-batch 写入（只填 mt）；人工编辑 mt/final/notes；
采纳 AI 译法 = 复制到 final 再改；重导出自动 merge（en 未变保留翻译，变了标 conflict）。

## 四、子 agent 并行翻译（大批量标准做法）

1. **切批**：`node gen-batches.js --project <目录>`（自适应批：短串 400/批，长对话按字符预算缩批）
2. **fanout**：subagent workflowScript 并行（8 路×波次），worker 固定
   `model: opencode-go/mimo-v2.5:off`（pi 后缀语法 = 模型 + thinking 强度；**翻译默认关思考**：
   占位符靠切段配方机制性保证、质量靠门禁兕底，关思考最快且超时最少；
   若某批 apply 拒绝率明显升高（长对话丢占位符），仅对该批降级 `:low` 重试）
3. **worker prompt 要点**：{{Cn}} 占位符原样保留且数量一致 / 半角标点、引号用成对 “ ”（字库分前后引号，码表外字符会被门禁拒绝） /
   汉字数 ≤ budget / 术语表内联 / 「先写完文件再自检」（防超时丢产出）
4. **汇总**：各批 out 合并去重 → report/translations.json（条目含 codes）→ apply
5. **失败重试**：apply 拒绝的条目打包加严重试（token 计数核对）

实测：XTREME 200 条（MiMo）首轮 93% → 重试 100%；ESC 基座改版 15000+ 条
（MiMo，占位符流程）12/12 测试批与大批次全通过，占位符零丢失。

## 五、标准执行七步（新 ROM 汉化）

1. **确认基座**（1.2 表 + probe 实证）；字库未注入 → 先走 gba-font-crack 整库路线
2. **init + dump + 普查**：init → dump → `export-missing.js --add` 补漏 → 抽检首批
3. **翻译**：术语表（build-glossary*）→ prepare → 并行批次（第四节）→ apply
4. **validate**：清零硬错误（H2 码表外内容 → 缺字用 subst.json/扩字库，emoji/装饰符号直接删或改文字；H3 → 改译文；H5 → 补译）
5. **dry-run 回填**：审查策略分布；repoint 核对指针数是否合理（1-4 处常见）
6. **实跑回填 → romctl 截图验证**（NEW GAME 范式，见 gba-font-crack 阶段 5）
7. **归档**：cases/ 案例 + cases/README.md 登记 + LESSONS.md 记录

## 六、踩坑清单

**症状速查**：只显示半个词/乱尾 → #18 空格对齐；句号变"er" → #12 全角标点；
翻译后整段英文 → #10/#17 残尾与 conflict；应用后大片没生效 → #22 大小写/id 问题；
游戏崩 → #19 代码区假指针；中文空白 → 基座不支持（1.2）；
译文吞掉下一条串/串行 → #26；引号不分前后 → #29。

| # | 坑 | 要点 |
|---|-----|------|
| 1 | id 是唯一主键 | 8 位 hex 文件偏移；重导出 merge 全靠它；勿手改 |
| 2 | 指针扫描逐字节步进 | 脚本区指针未必 4 对齐；命中数 >8 先怀疑误命中 |
| 3 | append_addr 人工确认 | init 默认值改版未必成立；确认区域全 FF（insert 有回扫校正） |
| 4 | 同串多处引用 | repoint 全改，漏扫 = 中英混显；用 watch-read.js 动态补抓 |
| 5 | 0x01-0x1E 重音字母区 | 非英语基板的重音字节占 1B，预算不受影响 |
| 6 | 控制码 token 原样保留 | [PK]/[玩家]/[文本色00] 等，validate H3 强制；位置可按语序移动 |
| 7 | 标点归一化内置 | 全角→可编码形式自动转换；但见 #12 的字形警告 |
| 8 | 机翻质量门槛 | 原文含英文单词而译文无中文 → apply 拒绝 |
| 9 | Excel 存 CSV 丢 BOM | 用"CSV UTF-8"保存；校验失败先怀疑格式 |
| 10 | 原地残尾清 FF | 残留旧英文会中英混显（insert 已自动处理） |
| 11 | 压缩文本 | 大量 invalid 解码 → 可能 LZ77，人工专项 |
| 12 | ★全角标点字形不可靠 | charmap 有全角码位（。=0x2C 等）能编码但引擎字形是别的图案（。→"er"）。翻译产出一律半角（.,!? 已实证）；apply/insert 会自动转换 |
| 13 | 码表不全 → 半句乱串 | 05b8=纪 vs 05=È+b8=, 天然歧义；已防御（补缺+noHan+回溯剔除）；新 ROM 首次 dump 后抽检 |
| 14 | worker 丢控制码 | 旧流程 7% 丢失；**新流程 {{C0}} 占位符已机制性消除**；仍需 validate 兜底 |
| 15 | FD 占位符跨基板语义不同 | fd01=玩家等，token 原样保留；decode 已合并未知 FD 对为 [fdxx] |
| 16 | 以有字库 ROM 为蓝本 | 同字库体系共享码表；基座优先选已注入字库的 ROM |
| 17 | ★add 曾破坏性全表合并（已修） | 旧版 add 把未扫到行标 conflict「原串已消失」——insert 后再 add 必大规模误标；已改非破坏性。存量恢复：notes 含该标记且 mt 非空 → machine-translated |
| 18 | ★译文空格对齐 | 见 1.3；worker 丢前导空格高发；apply/insert 已内置对齐 |
| 19 | ★repoint 代码区护栏 | 代码区 literal pool 假指针改写=崩游戏（实测 240/2759 中招）；`min_pointer_source` 过滤（默认 0xA0000，改版按代码区上调） |
| 20 | ★CSV 必须按 id 排序 | insert 重叠防御按 CSV 顺序；追加行不排序 = 大片误报重叠跳过 |
| 21 | ★apply id 大小写敏感 | translations.json 的 id 大小写须与 CSV 一致，否则静默写 0 条 |
| 26 | ★普查 max_bytes 用字符数（已修） | 旧版 export-missing 用 text.length+1 冒充字节数——控制码 token（[']、[/n]、[玩家]）解码后一字符占多字符但只占 1-2 字节 → 预算虚高 → insert 残尾清 FF 越界**抹掉下一条串头部**（症状：翻译串行/吞串）。已改用 FF 实测位置 |
| 27 | ★写 ROM 前终止符实测 | insert 逐行扫 FF 定真实串长（找不到 FF 或跨区超 0x400 拒绝写入）；repoint 清原址也用实测长度，不信任 CSV max_bytes（不符时记 budget_fix 告警） |
| 28 | ★残留英文硬拒绝 | en 与 zh（去 token）共有的 ≥4 字母英文词 = worker 抄了原文（如 Master Ball 未译）→ apply/validate H5 硬错误；overrides.json 译文同样过门禁 |
| 29 | ★引号分前后 | 字库实证：B1=“（6形） B2=”（9形） B3=‘（6形单个） B4=’（9形单个，兼作撇号，码表标 ASCII '）。旧码表 B2=["]、B1/B3 缺失 → 前后引号混同；normalizeText 自动把 ASCII " 按序配对为 “/”；存量 CSV 用 migrate-quotes.js 迁移（en/译文映射+重导出假冲突恢复） |

## 七、与 gba-font-crack 的衔接

- 字符串地址未知 → romctl hook + watch-read.js 动态定位 → `add` 登记进工程
- 回填验证 → romctl 加载输出 ROM → 场景截图 → bmp-ascii.js 像素比对
- 缺字（H2）→ subst.json 近似字 或扩字库（gba-font-crack），再重新 validate
- 转场黑屏等疑似崩溃 → 先做 base/补丁对照实验（gba-font-crack 踩坑 11）

## 八、资源

- 码表：`../gba-font-crack/assets/wholewords.txt`（本 skill assets/charmap-base.txt 为合并版）
- 字模：`../gba-font-crack/assets/gba_chs_font_11x11.bin`
- PokeAPI 官方术语 CSV：`assets/pokeapi/*.csv`（`build-glossary-pokeapi.js` 一键重建）
- 官方术语表：`assets/glossary-pokemon.csv`（4137 对照表）、`assets/glossary-pokeapi.csv`（合并版 4425）
- 案例：`cases/README.md`（索引，暂无归档）

## 九、自总结进化机制

每个里程碑/案例闭环后三步：
1. **记**：新坑/新机制追加 `LESSONS.md`（日期+ROM 名，append-only）
2. **蒸馏**：recurring 模式（≥2 次）→ 蒸馏进第六节清单或固化成脚本
3. **归档**：完整闭环写 `cases/<ROM名>-<主题>/README.md` 并登记索引
