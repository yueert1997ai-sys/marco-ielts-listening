# 项目当前状态与交接

这份文档只描述当前仍然成立的事实。历史改动统一查看 [`CHANGELOG.md`](../CHANGELOG.md)。接手 Agent 不应仅凭聊天记忆判断版本或发布状态。

## 本轮统一与发布

2026-09-06 v2.19.1 待发布：所有识义揭义页新增“其实不认识”，支持背错词、加练、背新词、旧混合识义与专项。`captureKnownAttempt` 仅暂存当前题作答前的进度/错词档案/回炉次数；`correctKnownAttempt` 将这次认识替换为一次错误，撤销虚增 passes、stage 和长排期，保留其他词、星标、历史和每日基础完成数，清掉旧确认题后按 8–12 题插入一次回炉。队尾不足/次数达上限仍留到后续复习。纠正按钮仅在当前揭义页有效，双击和跨日受保护；不允许看过答案后把不认识改成认识。后台代码不变，本次修复只发布 Pages。

v2.19.1 本地验证：主逻辑 132、易混逻辑 12、Python 16 项通过；词库/音频/易混构建与发布校验通过。真实 Chrome 覆盖五个识义入口、最后一题、加练、旧按钮失效、纠正后刷新、25/25 与 18/18、存储保护、到期排期和原有四选一。320×568 与 390×844 的“其实不认识 / 下一词”并排按钮可见可点击，词库保持 823 卡。

2026-09-05 从 origin/main `0db8f71` 建立审计分支，完成 v2.18.1–4 的数据、档案、每日题单及排期修复。用户随后授权统一并发布；两次 fetch/rebase 确认最新基准后，正常快进推送 main（未 force push）。v2.19.0 功能提交 `8ddb8d1`，严格短屏测试修正 `9e9a3438f205a13b8c5ba8499fc83a5aa42b8495`。GitHub Pages 工作流 [33941759953](https://github.com/yueert1997ai-sys/marco-ielts-listening/actions/runs/33941759953) 与文档守卫均 success。前轮详见 [自检报告](AUDIT-2026-09-05.md)。

生产已回读：`version.json / sw.js / app.js / style.css / data/listening.json` 与本地发布内容一致；真实 Chrome 在公开站点验证首屏只有认识/不认识、不认识四选一（刷新仍保留原判断）、新词 8 题/错词 10 题后回炉重判、错词身份和重点保留，320×568/390×844/1440×900 无横向溢出、无 pageerror。`ielts-listening-v2.19.0` Cache 与断网后的首屏训练通过。

后台待补发：v1.0.1 本地 14 项测试及 wrangler dry-run 成功，但现有 OAuth 缺少 `workers_scripts:write`，正式部署在读取 deployments 时返回 Authentication error 10000（未上传新代码）。旧后台首页与 `/api/session` 回读正常。本次设备授权等待用户确认；授权后用原 `XDG_CONFIG_HOME` 配置运行 `npx wrangler deploy`，不要改 D1、Secret 或 GitHub token。不得把训练端成功描述为后台也已发布，后台及三层拦截中的服务端生产代码需补验。

两条词汇主线与旧识义共用 `recordAttempt / reinforcementDecision / renderRecognitionMeaningCheck`。首屏只有认识/不认识；不认识后四选一、揭义、8–12 题回炉再判断，选中正确中文仍只记录最初那一次错误。`queue[].meaningCheck` 保存已做出的不认识判断，刷新/暂停继续确认，不能看答案后改报认识。

`vocabNewDaily` 是新词识义队列的统一来源，`syncLearningRecognition` 将其投影回混合 `daily`，保留听写项位置和记录；新旧入口共享基础进度、强化队列、streak 和 retryCount。旧在途队列会兼容补入，不重置学习数据。回炉不增加每日完成数；初次认识需间隔确认（15–20 题），已有记忆阶段则按到期复习，不加无用确认。同轮短队尾或 3 次上限停止插题，未确认状态可次日独立判断完成；`:vocab` 不会被塞进只能解析听写/识义的旧复习队列。

v2.19.0 发布前验收：主逻辑 129、易混逻辑 12、Python 16、后台 Node 14，共 171 项通过；词库/音频/易混构建和发布、文档校验通过，823 张主卡/831 个音频无变化。十组真实 Chrome 流程（前轮九组 + `unified_training_playwright.js`）覆盖 320×568、390×844、1440×900。新词 8 题、错词 10 题后实测回炉；四选一刷新、双击、每日 25/25 与 18/18、加练、档案/重点、旧入口、易混离线隔离通过。

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
- 训练端程序版本：`v2.19.1`（待发布；线上上一版 v2.19.0）
- 后台程序版本：`v1.0.1`
- 正式词库：823 张主卡；听写 276 项；识词 604 项
- 个人错词：192 条；基础词覆盖：8 条；已停用：0 条
- 最后自动词库同步：2026-09-03，GitHub Issue #20
<!-- VOCAB_STATUS_END -->

- 当前代码 v2.19.1 增加误判认识纠正；v2.19.0 统一主线、永久档案、赦免、重点、固定日任务及排期修复均保留。
- 2026-09-05 本地真实 Chrome 验收通过：390×844、320×568、1440×900；主应用逻辑 122 项、易混逻辑 12 项、Python 16 项、后台 Node 14 项均通过。
- 易混词 v1.1.0 本轮本地完成学习、12 题冷测、错题强化、暂停/舒缓节奏、故障隔离和离线回归。Listening LocalStorage 前后字节级相等。
- 当前生产验收以本页顶部 v2.19.0 回读为准；后续发布仍需重新 fetch、验收并回读，不能只引用历史记录。
- 训练端由 GitHub Pages 托管；后台由 Cloudflare Worker + D1 托管。
- 词库后台只管理正式词库，不同步手机浏览器里的训练进度和记忆曲线。
- 训练端采用手机优先的浅色 iOS 原生界面：系统分组灰背景、白色表面、动态圆形日进度和系统蓝主操作；正确/错误反馈只使用成功绿与错误红。桌面仅保留居中的手机宽度外壳。
- 首页“我的错词训练”是个人同步来源的专项（不是所有错词档案），完整保留听写/识义模式，排除已赦免词；一轮完成后可主动再练。
- 首页“重点词随机训练”读取当前浏览器的重点标记，使用独立可暂停队列；一轮完成后重建并重新打乱，答错同样进入高频复习。
- 所有正式识义训练首屏不显示中文候选项，只问“认识 / 不认识”；不认识时四选一确认。首次认识在 15–20 题后确认，不认识在 8–12 题后回炉；回炉仍先判断。熟词按到期验证；剩余题不足以拉开间隔时不强制循环，未完成确认保留后续复习。
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
- 剩余 P2：普通词库尚无搜索；原生浏览器返回无专用路由；多标签同存档并发写、iOS Safari 真机、超大历史备份等边界尚未充分验证。前轮报告中的训练题型分歧已在 v2.19.0 统一。

- v2.18.0 QA：普通训练错误只作为近期错误提升优先级，只有明确真实错题证据才设置 `causedIeltsError`；赦免会同步刷新当日背错词队列；`id:vocab` 复习进度每次以永久错词档案的掌握阶段与 nextReview 为基准，防止状态分叉。
