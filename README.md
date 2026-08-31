# IELTS Listening 50

手机端 IELTS Listening 基础词训练：每天 25 个听音拼写 + 25 个快速看义，支持分页浏览、全词发音、重点词、记忆阶段和跨端错词同步。今日新词、高频到期复习、“我的错词训练”和“重点词随机训练”使用四条独立队列，不会互相占用进度；两个专项训练都保留原先选择的听写/识义模式，支持暂停后续练和完成后再随机练一轮。首页另有独立的“方位检测”，以及挂载在 `/confusions/` 的“易混词”子应用。

## 易混词

“易混词”是同一 GitHub Pages 下的独立产品，提供词义匹配、Chunk 匹配、12 题 cold test、pairwise confusion 统计和错题强化。学习盘面每屏至少同时辨析 4 个词，不足 4 词的组会按词性和词形相似度加入补位词，但仅核心组记入学习状态。正式测试支持随时暂停，并可在保持掌握判定不变的前提下切换标准（词义 2.5 秒 / 语境 5 秒）或舒缓（5 秒 / 10 秒）节奏。V1 包含 32 个 confusion groups、84 个词，每词配有人工校对的 academic 句内题。

- 入口：<https://yueert1997ai-sys.github.io/marco-ielts-listening/confusions/>
- 独立版本：`Confusions v1.1.0`
- 独立数据：`source/confusions.json` → `confusions/data/confusions.json`
- 独立本地记录：`marcoIeltsConfusions.v1`

易混词不会进入 Listening 正式词库，不读写 `marcoIeltsListening.v1`，学习和强化结果也不会修改 cold test 成绩。

## 多 Agent 协作

本仓库把 GitHub 作为跨 Codex、Claude 和其他 Agent 的共同真相源。接手前请先阅读 [`CLAUDE.md`](CLAUDE.md)（`AGENTS.md` 为同源入口）、[`docs/HANDOFF.md`](docs/HANDOFF.md) 和 [`CHANGELOG.md`](CHANGELOG.md)。任何改动都必须在同一提交更新变更记录；版本、部署、数据规模或发布流程变化时还要更新交接文档。GitHub Actions 会自动检查是否漏记。

## 词库管理后台

`admin/` 是独立的 Cloudflare Worker + D1 单人后台。它提供密码登录、全词库表格、搜索分页、修改、停用恢复、快速录入、ECDICT 本地释义与 30 秒批量发布。后台只管理正式词库内容，不读取或同步手机上的训练进度与记忆曲线。

- 后台地址：<https://marco-vocabulary-admin.marco-vocabulary-admin.workers.dev>

后台把待发布操作合并成 GitHub Issue，由仓库自动化完成去重、构建、缺失音频生成、校验与 GitHub Pages 发布；正式真相源仍是 `source/custom_words.json` 与 `source/vocabulary_overrides.json`。

## 记录新错词

- 手机端可直接粘贴带编号的单词列表、“单词+中文”或原有 JSON；页面会去编号并生成可编辑预览。
- 主词库已有的词会自动补中文释义；全新词在确认前需要补齐准确中文义。
- 任意 ChatGPT：让它输出 `term / meaning / mode / reason` 的 JSON，粘贴进网页“错词收件箱”。
- 任意 Codex：项目根目录的 `AGENTS.md` 会指导它通过 `scripts/import_wrong_words.py` 入库。
- 跨设备同步：网页会生成 GitHub 同步单；仅仓库所有者提交的同步单会触发自动校验、音频生成和发布。
- 分类规则：听错或拼错进入 `spelling`，不认识或词义混淆进入 `recognition`，两种情况进入两类。
- 单数和规则复数只保留一张主卡，不会把 `curtain` / `curtains` 当成两个挑战；英美拼写差异仍分别保留。

## 数据来源

- 飞书文档：`IELTS Listening 基础必备词汇表｜真题反推版 V1`
- 文档 token：`PMXRdM6RFouDlwxRZsWc3phPndf`
- `source/feishu_listening.json` 保存可复现快照
- `data/audit.json` 保存每次发布的词库审计结果

## 更新词库

```powershell
python scripts/fetch_feishu.py
python scripts/build_listening.py
python scripts/generate_audio.py
python scripts/validate_release.py
node tests/test_logic.js
```

网页本身是静态文件。训练进度、重点词和未提交的个人错词保存在当前浏览器，并可在首页导入、导出；提交到 GitHub 的错词会进入公共词库，在所有设备生效。

## 手机端自动更新

- 手机始终使用同一个 GitHub Pages 链接，不需要为每个版本重新找地址。
- 网页首次打开、从后台回到主页、以及结束训练返回主页时会检查最新版本；发现更新后自动刷新。
- 自动更新不会在答题过程中强制打断，训练进度仍保存在手机浏览器中。
- iPhone 用 Safari 打开后，点“分享 → 添加到主屏幕”，之后可像普通 App 一样从桌面全屏启动；浅灰启动背景和浅色状态栏会与应用界面保持一致。

当前 Listening 训练端代码为 `v2.15.1` 浅色 iOS 原生训练界面：系统分组灰背景、白色卡片、系统蓝主操作与离线 Phosphor 图标，并在首页提供易混词独立入口。正确反馈会用 22px 中文和高对比系统绿显示，识义选项词性使用 `n`、`v`、`adj` 等英文缩写。仅针对手机端设计；桌面打开时保留居中的手机宽度外壳。

## 刷题节奏

- 听写答对后会短暂显示中文意思再自动进入下一题；答错、超时和“不会”仍保留完整复盘页。
- 听写题会自动聚焦输入框；从识义题切回听写时会提前唤起手机键盘，下一题音频也会预加载。
- 识义题的四个中文选项都会显示词性，词性来自项目内的 ECDICT 轻量词典和人工校准。
- 识义题不再默认“一次选对就算掌握”：真实错词必定稍后换序确认，普通识义题约 40% 随机抽查。
- 答错、超时或点“不会”的词会在 2–4 题后快速回炉，并要求连续答对两次；每个词每轮最多插入 4 次，未巩固完成的仍留到高频复习。
- 加强题属于额外巩固，不占每天 25 个听写 + 25 个识义的新词名额，也不会让昨日错词挤掉今日新词。
- “重点词随机训练”只读取当前浏览器中的重点标记；训练中点星标只原位更新，暂停后会同步下一次训练池，不会把页面弹回顶部。
- 短屏手机会自动压缩非必要留白，识义选项和结果页按钮优先保持在首屏内。

本地浏览器验收使用 `scripts/run_playwright.sh`，脚本已内置 Node/npm/npx 路径与 OpenSSL 兼容处理。
