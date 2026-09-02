# Recharged Yellow v1.9.4 — 整句翻译闭环实录（2026-09）

## 结论速览

**gba-text-translate 流水线首次整句汉化闭环成功**：dump 指针引导导出 → 翻译 → 门禁 →
原地覆盖回填 → 模拟器逐段截图验证，主菜单 + Oak 开场白三段全部正确上屏。

- 基座：`roms/Recharged Yellow v1.9.4.gba`（**原版**——RY 自带双字节中文引擎与字库，
  无需任何注入；区别于槽位方案基座 XTREME 只能词级替换）
- 改动：370 字节 / 7 段（5 条文本：菜单 2 + 开场白 1 + Oak 对话 2），全部原地覆盖
- 工程快照：`translation-test-ry/`（码表 charmap-base + 术语表 glossary-pokemon）

## 流程实录

1. **init + add**：菜单串 @0x088F3350/0x088F3368（案例已验证地址）精确登记
2. **dump 指针引导导出**：全 ROM 15444 条（重叠别名剔除 1650 + 中段半句回溯剔除 437）
   - 质量抽检通过；发现 RY 文本含多语言开场白（英/西/法/意连续排列）
3. **翻译**：小批次人工终审（菜单 + 开场白 + Oak 对话 5 条）
   - 门禁拦截 2 次：漏 `[/n]`、控制码数不匹配 → 修正后通过
   - `002B53F5` 是被截断的上文（"…ak:"），译文保留原边界
4. **insert**：全部原地覆盖（84-102B 译文 vs 83-141B 预算）
5. **截图验证**：
   - 主菜单"新的游戏/选项" ✅
   - RY 自定义启动菜单（Select Difficulty）→ Start Adventure!
   - Oak 开场白三段："你好！很高兴见到你！♥" → "欢迎来到宝可梦的世界！▼" → "我叫大木。▼" ✅

## 关键经验

1. **整句翻译必须双字节引擎基座**（RY 自带/Quetzal 字库版）；XTREME 槽位方案只有 6 槽
2. **RY 原版即可翻译**（引擎自带），字库版只是菜单串已改的成品——翻译工程基座用原版
3. 多语言版 ROM（RY 文本含西/法/意）dump 会同时导出多语言文本，按场景筛选时注意
4. 串首杂字符（如 "ÂOak" 的 Â=0x02）是上文边界残留，翻译时保留或去除需人工判断
5. RY 字库容量 7080 字 > 码表 6768 字：缺字可往 0x086365E0 空槽补字形

## 复现步骤

```bash
cd gbajs2
S=.pi/skills/gba-text-translate/scripts
node $S/export-strings.js init --project translation-test-ry --rom "roms/Recharged Yellow v1.9.4.gba" \
     --append-addr 0x09F00000
node $S/export-strings.js add  --project translation-test-ry --scene title-menu --addr 0x088F3350 --addr 0x088F3368
node $S/export-strings.js add  --project translation-test-ry --scene intro --addr 0x082D4415 --addr 0x082B5A36 --addr 0x082B53F5
node $S/translate-batch.js set --project translation-test-ry --scene title-menu --id 008F3350 --col final --text "新的游戏"
node $S/translate-batch.js set --project translation-test-ry --scene title-menu --id 008F3368 --col final --text "选项"
node $S/translate-batch.js set --project translation-test-ry --scene intro --id 002D4415 --col final --text \
  "你好![/n]很高兴见到你![/p]欢迎来到宝可梦的世界![/p]我叫大木。[/p]人们都亲切地称我为[/n]宝可梦博士。[/p]"
node $S/validate.js --project translation-test-ry
node $S/insert-strings.js --project translation-test-ry
node romctl.js load "translation-test-ry/tmp/汉化输出.gba"
node romctl.js run 3600 && node romctl.js key START 60 && node romctl.js run 300
node romctl.js screenshot tmp/ry-menu.bmp            # 新的游戏/选项
node romctl.js key A 30 && node romctl.js run 600    # Start Adventure!
node romctl.js key A 30 && node romctl.js run 180    # 开场白逐段
node romctl.js screenshot tmp/ry-step.bmp
```

## 归档内容

| 文件 | 说明 |
|------|------|
| `artifacts/ry-menu.bmp` | 主菜单"新的游戏/选项" |
| `artifacts/ry-step2-4.bmp` | 开场白三段逐段截图 |
| `data-diff.json` | 与原版逐段 diff（370B/7 段） |
