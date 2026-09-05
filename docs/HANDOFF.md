# 项目当前状态与交接

这份文档只描述当前仍然成立的事实。历史改动统一查看 [`CHANGELOG.md`](../CHANGELOG.md)。接手 Agent 不应仅凭聊天记忆判断版本或发布状态。

## 本轮本地审计（未发布）

2026-09-05 从 origin/main `0db8f71` 建立 `codex/learning-system-audit-20260905`。本地 v2.18.4 修复存储保护、永久错词/重点统计、每日固定题单及到期/加练排期。详见 [自检报告](AUDIT-2026-09-05.md)。本轮不以历史发布记录证明当前生产版本，没有 push 或部署；下述线上描述为历史交接信息，发布前须重新回读。

进度仍保存在 `marcoIeltsListening.v1`；导入先验证再写入，失败不改原进度。坏 JSON 不会清空，启动页提供原始备份导出与导入恢复。保存失败时页面显示未保存提示并提供导出/重试；此时禁止自动刷新更新。

`vocabErrorDaily.frozenPool` 标记固定当日题单；`vocabErrorDaily.extra` 是用户主动加练的独立 session，仍随主存档保存，刷新后可继续，不重置或增加主线完成数。未答赦免词从当日题单移出，不自动补位；已答赦免词保留当天完成记账。次日重选新题单。

日常背错词只选到期词，上限 18；没有到期词显示空状态，不强凑任务。主动加练可包含未来到期词，但提前答对不连续升级或延后原到期日；到期验证每次最多升一级，静态迁移保留原阶段。听写仍保留独立模式记录，永久档案不会被陈旧模式阶段拖低。

## 线上入口

- 训练端：<https://yueert1997ai-sys.github.io/marco-ielts-listening/>
- 易混词：<https://yueert1997ai-sys.github.io/marco-ielts-listening/confusions/>
- 词库后台：<https://marco-vocabulary-admin.marco-vocabulary-admin.workers.dev/>
- GitHub：<https://github.com/yueert1997ai-sys/marco-ielts-listening>

## 当前代码与发布状态

<!-- VOCAB_STATUS_START -->
- 训练端程序版本：`v2.18.4`（本轮本地未发布）
- 后台程序版本：`v1.0.1`
- 正式词库：823 张主卡；听写 276 项；识词 604 项
- 个人错词：192 条；基础词覆盖：8 条；已停用：0 条
- 最后自动词库同步：2026-09-03，GitHub Issue #20
<!-- VOCAB_STATUS_END -->

- 本地当前为 v2.18.4：两条每日词汇主线、永久错词档案、主动赦免、独立重点维度、固定日任务及到期复习；状态/数据规模详见本页顶部与自检报告。
- 2026-09-05 本地真实 Chrome 验收通过：390×844、320×568、1440×900；主应用逻辑 122 项、易混逻辑 12 项、Python 16 项、后台 Node 14 项均通过。
- 易混词 v1.1.0 本轮本地完成学习、12 题冷测、错题强化、暂停/舒缓节奏、故障隔离和离线回归。Listening LocalStorage 前后字节级相等。
- 历史文档记录过 v2.16.0 的线上验收（552a7b1），不能代表此刻生产版本。本轮未重新确认线上部署，后续发布需重新 fetch、验收并回读。
- 训练端由 GitHub Pages 托管；后台由 Cloudflare Worker + D1 托管。
- 词库后台只管理正式词库，不同步手机浏览器里的训练进度和记忆曲线。
- 训练端采用手机优先的浅色 iOS 原生界面：系统分组灰背景、白色表面、动态圆形日进度和系统蓝主操作；正确/错误反馈只使用成功绿与错误红。桌面仅保留居中的手机宽度外壳。
- 首页“我的错词训练”是个人同步来源的专项（不是所有错词档案），完整保留听写/识义模式，排除已赦免词；一轮完成后可主动再练。
- 首页“重点词随机训练”读取当前浏览器的重点标记，使用独立可暂停队列；一轮完成后重建并重新打乱，答错同样进入高频复习。
- 旧听写/识义主线及专项的识义首屏不显示中文候选项，只问“认识 / 不认识”；不认识时再显示四个中文释义用于确认。认识词在 15–20 题后确认，不认识词在 8–12 题后回炉；回炉仍先问认识度。剩余题不足以形成至少 6 个不同词的间隔时，不在本轮强制循环。
- `melt` 已作为个人识义错词收录，释义为“融化；熔化；使融化”，词性为动词并带英式发音。

## 永久错词档案（v2.18.0 新增）

`state.errorWords[itemId]` 以词条 `id` 为唯一键，跨训练模式只维护一条主记录：

- `isErrorWord`：永久历史身份，赦免也保持 true；活跃状态唯一判断为 isErrorWord && !pardoned。
- `sources`：`source(listening/vocabulary/reading/manual) / sourceDetail / errorType / wrongAt` 历史，去重，不因答对或赦免丢弃；旧版本已截断的历史无法凭空恢复。
- `wrongCount / firstWrongAt / lastWrongAt`：错误累计。
- `priority`：近 2 天错或上次再错为 S；历史错多/致 IELTS 错题且未稳定仍 S，阶段≥3 降 A，阶段≥5 降 B；普通词阶段≥3 为 B。分级影响到期词选题顺序。
- `masteryLevel / reviewStatus`：学习中 / 稳定掌握 / 长期维持，只代表当前会不会。
- `nextReviewAt / lastReviewAt`：背错词 SRS 排期（沿用 1/3/7/14/30/60 天 INTERVALS）。
- `pardoned / pardonedAt / pardonHistory`：手动赦免记录；再错自动复活并保留赦免历史。

登记入口：任何训练会话答错或点「不认识」、错词收件箱确认加入、已发布个人错词（`sourceType=user`）、静态真实错词与本机旧 lapses 自动播种。每日「背错词」队列最多 18 词，排序为到期 → S/A/B → 最近错误 → 错误次数 → 复习再错 → 久未复习。「背新词」取自今日新词识义子集，与今日新词共享 `id:recognition` 进度，双入口作答互相跳过。

## 系统结构

```text
飞书快照 ─────────────┐
个人错词 ─────────────┼─> build_listening.py ─> data/listening.json ─> GitHub Pages
基础词覆盖/停用 ──────┘                 └────> audio/ + data/audit.json

后台录入/编辑 ─> Cloudflare D1 队列 ─> GitHub Issue
               └─────────────────────> sync-wrong-words.yml ─> 校验、提交、发布
```

正式数据真相源：

- `source/feishu_listening.json`：飞书基础词快照
- `source/custom_words.json`：个人错词
- `source/vocabulary_overrides.json`：基础词修订和停用状态

易混词独立数据真相源：

- `source/confusions.json`：32 组、84 词及句内题
- `confusions/data/confusions.json`：由 `scripts/build_confusions.py` 生成的运行时数据
- `marcoIeltsConfusions.v1`：浏览器内学习、冷测、混淆对与强化记录

不要直接维护 `data/listening.json`、`data/audit.json` 或音频清单；这些都应由构建流程生成。
易混词数据不得写入任何 Listening 源数据或 `marcoIeltsListening.v1`。

## 版本规则

- 训练端代码或体验变化：提升 `version.json`、页面资源版本和 Service Worker 版本。
- 后台代码变化：提升 `admin/package.json` 的后台版本。
- 单纯新增或更新词汇：训练端程序版本不变，以 Git 提交、Issue 编号和最后同步日期作为词库版本。
- 手机上看到旧版时，先核对线上 `version.json` 和 `sw.js`，再判断是否是浏览器缓存。
- 易混词独立读取 `confusions/version.json`，版本不跟随 Listening；两套 Service Worker 只清理各自的 cache namespace。

## Agent 接手流程

1. 读取根目录 `CLAUDE.md`（`AGENTS.md` 是同源入口）、`README.md`、本文件和 `CHANGELOG.md` 顶部记录。
2. `git fetch origin main`，确认工作基准来自最新 `origin/main`。
3. 优先使用独立任务分支；修改前确认工作区没有未识别的用户改动。
4. 只改真相源，按 `CLAUDE.md` 运行对应构建和验证。
5. 同一提交更新 `CHANGELOG.md`；当前事实变化时同步更新本文件。
6. 推送后等待相关 GitHub Actions 完成，并回读公开训练端或后台。

## 发布与运维要点

- GitHub Issue 同步只接受仓库所有者创建的 `[错词同步]` 或 `[词库管理]` Issue。
- 错词同步使用 `wrong-word-sync` 并发队列，并在任务真正开始时显式签出最新 `main`，避免排队期间其他同步提交导致最终推送冲突。
- 自动同步成功后应提交源数据、构建数据、音频、`CHANGELOG.md` 和本文件，并关闭 Issue。
- Cloudflare Worker 所需 Secret：`ADMIN_PASSWORD_HASH`、`SESSION_SECRET`、`GITHUB_TOKEN`；不得记录具体值。
- `GITHUB_TOKEN` 应保持为仅该仓库、仅 Issues 读写的 fine-grained token。
- 本机浏览器验收使用 `scripts/run_playwright.sh`，不要自行拼接 Node/OpenSSL 环境变量。

## 最小验收

```bash
python scripts/check_docs_sync.py
python scripts/validate_release.py
python scripts/build_confusions.py
python scripts/validate_confusions.py
node tests/test_logic.js
node tests/test_confusions_logic.js
python -m unittest tests/test_vocabulary_admin.py tests/test_project_docs.py
cd admin && npm test
```

发布后至少回读：

- `version.json` 的程序版本
- `sw.js` 的 `APP_VERSION`
- `data/listening.json` 的主卡数量及本次目标词
- GitHub Actions 和同步 Issue 的最终状态

## 已知边界

- 手机训练进度只保存在对应浏览器本地，不在后台跨端同步。
- 易混词使用独立 `marcoIeltsConfusions.v1`；其学习、冷测和强化记录不进入 Listening 进度、streak 或词库统计。
- 本地模型只在词典缺失且浏览器支持 WebGPU 时按需使用；模型资源不随仓库发布。
- 剩余 P2：新词汇自评与旧识义四选一强化尚为两种题型；普通词库尚无搜索；原生浏览器返回无专用路由；多标签同存档并发写、iOS Safari 真机、超大历史备份等边界尚未充分验证。详见自检报告。

- v2.18.0 QA：普通训练错误只作为近期错误提升优先级，只有明确真实错题证据才设置 `causedIeltsError`；赦免会同步刷新当日背错词队列；`id:vocab` 复习进度每次以永久错词档案的掌握阶段与 nextReview 为基准，防止状态分叉。
