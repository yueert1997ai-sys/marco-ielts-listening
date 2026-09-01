# 项目当前状态与交接

这份文档只描述当前仍然成立的事实。历史改动统一查看 [`CHANGELOG.md`](../CHANGELOG.md)。接手 Agent 不应仅凭聊天记忆判断版本或发布状态。

## 线上入口

- 训练端：<https://yueert1997ai-sys.github.io/marco-ielts-listening/>
- 易混词：<https://yueert1997ai-sys.github.io/marco-ielts-listening/confusions/>
- 词库后台：<https://marco-vocabulary-admin.marco-vocabulary-admin.workers.dev/>
- GitHub：<https://github.com/yueert1997ai-sys/marco-ielts-listening>

## 当前发布状态

<!-- VOCAB_STATUS_START -->
- 训练端程序版本：`v2.16.0`
- 后台程序版本：`v1.0.0`
- 正式词库：781 张主卡；听写 276 项；识词 562 项
- 个人错词：149 条；基础词覆盖：8 条；已停用：0 条
- 最后自动词库同步：2026-09-01，GitHub Issue #14
<!-- VOCAB_STATUS_END -->

- 最后完成线上运行态验收的功能提交：`552a7b1`（Listening `v2.16.0`）
- Listening `v2.16.0` 已发布：识义改为“认识 / 模糊 / 不认识”先自评后揭义；回炉间隔延长至 8–20 题，并在队尾间隔不足时转入高频复习；6 个无独立义的规则词形已归并到原形，`end / purpose / aim` 释义已按语境区分。
- 易混词已从 `/confusions/` 独立发布，共 32 组 84 词；线上已完成学习、12 题 cold test、错题强化、故障隔离、双 Cache 共存与离线回归。Listening localStorage 前后字节级相等，正式词库和训练状态结构不变。
- Confusions `v1.1.0` 已完成线上回读和完整手机流程验收：正式测试支持标准/舒缓节奏与题内暂停，暂停期间剩余时间、进度条和反应计时均冻结；320px 窄屏无横向溢出，44px 节奏触控区、减少动态效果、双 Cache 共存、离线重载及 Listening localStorage 字节级隔离均正常。
- 训练端由 GitHub Pages 托管；后台由 Cloudflare Worker + D1 托管。
- 词库后台只管理正式词库，不同步手机浏览器里的训练进度和记忆曲线。
- 训练端采用手机优先的浅色 iOS 原生界面：系统分组灰背景、白色表面、动态圆形日进度和系统蓝主操作；正确/错误反馈只使用成功绿与错误红。桌面仅保留居中的手机宽度外壳。
- 首页“我的错词训练”只使用 `sourceType=user` 或本机错词收件箱新增的词，完整保留每个词原先的听写/识义模式；一轮完成后可立即再练。
- 首页“重点词随机训练”读取当前浏览器的重点标记，使用独立可暂停队列；一轮完成后重建并重新打乱，答错同样进入高频复习。
- 识义题不显示中文候选项；“认识”需在 15–20 题后确认，“模糊”在 10–14 题后再考，“不认识”在 8–12 题后回炉。剩余题不足以形成至少 6 个不同词的间隔时，不在本轮强制循环。
- `melt` 已作为个人识义错词收录，释义为“融化；熔化；使融化”，词性为动词并带英式发音。

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
- 当前没有已确认的技术待办；新需求以 GitHub 最新 `main` 为起点重新评估。
