(function () {
  "use strict";

  const logic = window.ConfusionsLogic;
  const screen = document.getElementById("screen");
  const screenLabel = document.getElementById("screen-label");
  let groups = [];
  let groupMap = new Map();
  let state = null;
  let study = null;
  let testRun = null;
  let lastResult = null;
  let reinforcement = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function icon(name) {
    return `<i class="ph ph-${escapeHtml(name)}" aria-hidden="true"></i>`;
  }

  function loadState() {
    const raw = localStorage.getItem(logic.STORAGE_KEY);
    if (raw === null) return logic.defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("storage");
    return logic.safeState(parsed);
  }

  function saveState() {
    localStorage.setItem(logic.STORAGE_KEY, JSON.stringify(state));
  }

  function statusName(status) {
    return { "high-risk": "高危", learning: "模糊", stable: "稳定", untested: "未测试" }[status] || "未测试";
  }

  function renderStatusGrid() {
    const counts = logic.statusCounts(groups, state);
    return `
      <div class="status-grid" aria-label="当前总体状态">
        <div class="status-chip risk"><strong>${counts["high-risk"]}</strong><small>高危</small></div>
        <div class="status-chip learning"><strong>${counts.learning}</strong><small>模糊</small></div>
        <div class="status-chip stable"><strong>${counts.stable}</strong><small>稳定</small></div>
        <div class="status-chip untested"><strong>${counts.untested}</strong><small>未测试</small></div>
      </div>`;
  }

  function renderHome() {
    window.scrollTo(0, 0);
    screenLabel.textContent = "学习与冷测";
    const familiar = Object.values(state.learning).filter((record) => record?.status === "familiar").length;
    const coldRuns = state.testHistory.length;
    screen.innerHTML = `
      <section class="hero">
        <p class="hero-kicker">DISCRIMINATION TRAINING</p>
        <div class="word-lens" aria-label="precede, proceed, perceive">
          <span>precede</span><span>proceed</span><span>perceive</span>
        </div>
        <h2>词形很近，意思很远</h2>
        <p class="hero-copy">先建立词义与搭配，再用不预习的冷测检验你是否真的分得清。</p>
      </section>
      ${renderStatusGrid()}
      <div class="action-stack">
        <button id="start-learning" class="action-card" type="button">
          <span class="action-icon">${icon("cards-three")}</span>
          <span class="action-copy"><strong>学习</strong><small>每屏至少 4 词 · 已熟悉 ${familiar} / ${groups.length} 组</small></span>
          <span class="action-caret">${icon("caret-right")}</span>
        </button>
        <button id="start-test" class="action-card" type="button">
          <span class="action-icon">${icon("timer")}</span>
          <span class="action-copy"><strong>正式测试</strong><small>12 题 cold test · 已完成 ${coldRuns} 轮</small></span>
          <span class="action-caret">${icon("caret-right")}</span>
        </button>
      </div>
      <p class="inline-note">易混词拥有独立版本、词库和学习记录，不会计入 Listening 训练进度。</p>`;
    document.getElementById("start-learning").addEventListener("click", startLearning);
    document.getElementById("start-test").addEventListener("click", startColdTest);
  }

  function startLearning() {
    const seed = `${Date.now()}`;
    const selected = logic.selectLearningGroups(groups, state, 5, seed);
    study = {
      groups: selected,
      pools: Object.fromEntries(selected.map((group) => [
        group.id,
        logic.buildLearningPool(group, groups, `${seed}:${group.id}`),
      ])),
      groupIndex: 0,
      stage: "meaning",
      matched: new Set(),
      selectedLeft: null,
      selectedRight: null,
      recallIndex: 0,
      recallQuestions: [],
      seed,
    };
    renderStudyStage();
  }

  function currentStudyGroup() {
    return study.groups[study.groupIndex];
  }

  function currentLearningPool() {
    return study.pools[currentStudyGroup().id];
  }

  function studyHeading(title, subtitle) {
    return `
      <header class="section-head">
        <div><p class="eyebrow">LEARN · 核心组 ${escapeHtml(currentStudyGroup().label)}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div>
        <span class="progress-count">${study.groupIndex + 1}/${study.groups.length}</span>
      </header>`;
  }

  function renderStudyStage() {
    window.scrollTo(0, 0);
    screenLabel.textContent = "学习";
    if (study.stage === "meaning" || study.stage === "chunk") renderMatching();
    else renderRecall();
  }

  function renderMatching() {
    const group = currentStudyGroup();
    const pool = currentLearningPool();
    const isMeaning = study.stage === "meaning";
    const remaining = pool.filter((term) => !study.matched.has(term.term));
    const left = logic.seededShuffle(remaining, `${study.seed}:${group.id}:${study.stage}:left:${study.matched.size}`);
    const right = logic.seededShuffle(remaining, `${study.seed}:${group.id}:${study.stage}:right:${study.matched.size}`);
    screen.innerHTML = `${studyHeading(isMeaning ? "词义匹配" : "Chunk 匹配", isMeaning ? "先点英文，再点对应中文。错误不会揭晓答案。" : "把单词和最常用的学术搭配连起来。")}
      <section class="panel">
        <div class="match-grid">
          <div class="match-column">
            ${left.map((term) => `<button class="match-option term" data-left="${escapeHtml(term.term)}">${escapeHtml(term.term)}</button>`).join("")}
          </div>
          <div class="match-column">
            ${right.map((term) => `<button class="match-option" data-right="${escapeHtml(term.term)}">
              ${isMeaning ? `<span class="meaning-pos">${escapeHtml(term.partOfSpeech)}</span><span class="meaning-main">${escapeHtml(term.meaning)}</span>` : `<span class="meaning-main">${escapeHtml(term.chunk)}</span>`}
            </button>`).join("")}
          </div>
        </div>
        <div id="match-feedback" class="match-feedback empty">还剩 ${remaining.length} 对</div>
      </section>
      <button id="leave-study" class="secondary" type="button">返回首页</button>`;
    document.querySelectorAll("[data-left]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-left]").forEach((item) => item.classList.remove("selected"));
      study.selectedLeft = button.dataset.left;
      button.classList.add("selected");
      judgeMatch();
    }));
    document.querySelectorAll("[data-right]").forEach((button) => button.addEventListener("click", () => {
      document.querySelectorAll("[data-right]").forEach((item) => item.classList.remove("selected"));
      study.selectedRight = button.dataset.right;
      button.classList.add("selected");
      judgeMatch();
    }));
    document.getElementById("leave-study").addEventListener("click", renderHome);
  }

  function judgeMatch() {
    if (!study.selectedLeft || !study.selectedRight) return;
    const leftButton = document.querySelector(`[data-left="${CSS.escape(study.selectedLeft)}"]`);
    const rightButton = document.querySelector(`[data-right="${CSS.escape(study.selectedRight)}"]`);
    if (study.selectedLeft !== study.selectedRight) {
      leftButton?.classList.add("wrong");
      rightButton?.classList.add("wrong");
      setTimeout(() => {
        leftButton?.classList.remove("wrong", "selected");
        rightButton?.classList.remove("wrong", "selected");
      }, 260);
      study.selectedLeft = null;
      study.selectedRight = null;
      return;
    }
    const term = currentLearningPool().find((item) => item.term === study.selectedLeft);
    study.matched.add(term.term);
    document.querySelectorAll(".match-option").forEach((button) => { button.disabled = true; });
    const feedback = document.getElementById("match-feedback");
    feedback.className = "match-feedback";
    feedback.innerHTML = `<strong>${escapeHtml(term.term)}</strong><span>${escapeHtml(term.partOfSpeech)} ${escapeHtml(term.meaning)}</span><small>${escapeHtml(term.chunk)}</small>`;
    study.selectedLeft = null;
    study.selectedRight = null;
    setTimeout(() => {
      if (study.matched.size === currentLearningPool().length) {
        study.stage = study.stage === "meaning" ? "chunk" : "recall";
        study.matched = new Set();
        if (study.stage === "recall") prepareRecallQuestions();
      }
      renderStudyStage();
    }, 700);
  }

  function prepareRecallQuestions() {
    const group = currentStudyGroup();
    const pool = currentLearningPool();
    const selected = logic.seededShuffle(group.terms, `${study.seed}:${group.id}:recall`).slice(0, 2);
    study.recallQuestions = [
      logic.makeLearningQuestion(group, selected[0], "zh-en", pool, `${study.seed}:${group.id}:recall:0`),
      logic.makeLearningQuestion(group, selected[1], "sentence", pool, `${study.seed}:${group.id}:recall:1`),
    ];
    study.recallIndex = 0;
  }

  function questionPrompt(question) {
    if (question.type === "en-zh") return `<h2 class="prompt-word">${escapeHtml(question.prompt)}</h2><p class="prompt-hint">选择核心中文义</p>`;
    if (question.type === "zh-en") return `<h2 class="prompt-meaning">${escapeHtml(question.prompt)}</h2><p class="prompt-hint">选择对应英文词</p>`;
    return `<h2 class="prompt-sentence">${escapeHtml(question.prompt).replace("___", "<mark>___</mark>")}</h2><p class="prompt-hint">选择最符合语境的词</p>`;
  }

  function choiceMarkup(question, choice) {
    if (question.type === "en-zh") {
      return `<strong>${escapeHtml(choice.meaning)}</strong><small>${escapeHtml(choice.partOfSpeech)}</small>`;
    }
    return `<strong>${escapeHtml(choice.term)}</strong><small>${escapeHtml(choice.partOfSpeech)}</small>`;
  }

  function renderRecall() {
    const question = study.recallQuestions[study.recallIndex];
    screen.innerHTML = `${studyHeading("组末回忆", "离开配对界面，确认你不是靠消元完成。")}
      <section class="question-card">
        <div class="question-meta"><span>回忆 ${study.recallIndex + 1} / 2</span><span>${escapeHtml(currentStudyGroup().label)}</span></div>
        ${questionPrompt(question)}
        <div class="choices">${question.choices.map((choice) => `<button class="choice" data-answer="${escapeHtml(choice.term)}">${choiceMarkup(question, choice)}</button>`).join("")}</div>
        <div id="recall-feedback" class="inline-note">选对后继续</div>
      </section>
      <button id="leave-study" class="secondary" type="button">返回首页</button>`;
    document.querySelectorAll("[data-answer]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.answer !== question.expected) {
        button.classList.add("wrong");
        document.getElementById("recall-feedback").textContent = "再想一下，答案不会直接揭晓";
        setTimeout(() => button.classList.remove("wrong"), 300);
        return;
      }
      button.classList.add("selected");
      document.querySelectorAll("[data-answer]").forEach((choice) => { choice.disabled = true; });
      document.getElementById("recall-feedback").textContent = `${question.expected} · ${question.chunk}`;
      setTimeout(advanceRecall, 500);
    }));
    document.getElementById("leave-study").addEventListener("click", renderHome);
  }

  function advanceRecall() {
    study.recallIndex += 1;
    if (study.recallIndex < study.recallQuestions.length) {
      renderRecall();
      return;
    }
    const completedGroup = currentStudyGroup();
    state = logic.markGroupFamiliar(state, completedGroup.id);
    saveState();
    study.groupIndex += 1;
    if (study.groupIndex >= study.groups.length) {
      renderLearningComplete();
      return;
    }
    study.stage = "meaning";
    study.matched = new Set();
    study.recallIndex = 0;
    study.recallQuestions = [];
    renderStudyStage();
  }

  function renderLearningComplete() {
    screenLabel.textContent = "学习完成";
    screen.innerHTML = `<section class="completion">
      <div class="completion-icon">${icon("check-circle")}</div>
      <h2>本轮 5 组已熟悉</h2>
      <p>这些记录只属于学习模式。真正的高危、模糊和稳定状态仍要由正式冷测决定。</p>
      <button id="learning-home" class="primary" type="button">返回首页</button>
    </section>`;
    document.getElementById("learning-home").addEventListener("click", renderHome);
  }

  function startColdTest() {
    const startedAt = new Date().toISOString();
    testRun = {
      deck: logic.buildColdTest(groups, state, `${Date.now()}:${Math.random()}`),
      index: 0,
      answers: [],
      startedAt,
      questionStartedAt: 0,
      timerId: null,
      locked: false,
    };
    renderColdQuestion();
  }

  function renderColdQuestion() {
    if (testRun.index >= testRun.deck.length) {
      finishColdTest();
      return;
    }
    window.scrollTo(0, 0);
    screenLabel.textContent = "正式测试";
    const question = testRun.deck[testRun.index];
    testRun.locked = false;
    screen.innerHTML = `<section class="question-card">
      <div class="question-meta"><span>COLD TEST · ${testRun.index + 1}/${testRun.deck.length}</span><span>${(question.timeLimitMs / 1000).toFixed(1)}s</span></div>
      <div class="timer"><div class="timer-bar" style="animation-duration:${question.timeLimitMs}ms"></div></div>
      ${questionPrompt(question)}
      <div class="choices">${question.choices.map((choice) => `<button class="choice" data-answer="${escapeHtml(choice.term)}">${choiceMarkup(question, choice)}</button>`).join("")}</div>
      <div id="test-note" class="inline-note">只记录第一次答案</div>
    </section>`;
    document.querySelectorAll("[data-answer]").forEach((button) => button.addEventListener("click", () => finishColdAnswer(button.dataset.answer)));
    testRun.questionStartedAt = performance.now();
    testRun.timerId = setTimeout(() => finishColdAnswer(null), question.timeLimitMs);
  }

  function finishColdAnswer(selected) {
    if (testRun.locked) return;
    testRun.locked = true;
    clearTimeout(testRun.timerId);
    const question = testRun.deck[testRun.index];
    const answer = logic.answerQuestion(question, selected, performance.now() - testRun.questionStartedAt);
    testRun.answers.push(answer);
    document.querySelectorAll("[data-answer]").forEach((button) => {
      button.disabled = true;
      if (selected && button.dataset.answer === selected) button.classList.add("selected");
    });
    document.getElementById("test-note").textContent = selected ? "已记录" : "超时，已记录";
    setTimeout(() => {
      testRun.index += 1;
      renderColdQuestion();
    }, 220);
  }

  function finishColdTest() {
    const result = logic.recordColdTest(state, testRun.answers, testRun.startedAt);
    state = result.state;
    lastResult = result.summary;
    saveState();
    renderResult();
  }

  function renderResult() {
    window.scrollTo(0, 0);
    screenLabel.textContent = "测试结果";
    const accuracy = Math.round((lastResult.score / lastResult.total) * 100);
    const pairs = logic.testConfusionPairs(lastResult.answers);
    const slowest = [...lastResult.answers].sort((first, second) => second.responseMs - first.responseMs).slice(0, 3);
    const wrong = lastResult.answers.filter((answer) => !answer.correct);
    screen.innerHTML = `
      <section class="result-score"><strong>${lastResult.score}</strong><span> / ${lastResult.total}</span><p>本轮 cold test 已锁定，不会被强化训练改写</p></section>
      <div class="metric-row"><div class="metric"><small>正确率</small><strong>${accuracy}%</strong></div><div class="metric"><small>中位反应</small><strong>${(lastResult.medianResponseMs / 1000).toFixed(2)}s</strong></div></div>
      ${Object.keys(pairs).length ? `<h3 class="list-title">本轮混淆</h3><div class="result-list">${Object.entries(pairs).map(([pair, count]) => `<div class="result-row"><span>${escapeHtml(pair.replace("->", " → "))}</span><strong>×${count}</strong></div>`).join("")}</div>` : ""}
      <h3 class="list-title">反应最慢</h3><div class="result-list">${slowest.map((answer) => `<div class="result-row"><span>${escapeHtml(answer.expected)}</span><strong>${(answer.responseMs / 1000).toFixed(2)}s</strong></div>`).join("")}</div>
      <h3 class="list-title">当前总体状态</h3>${renderStatusGrid()}
      ${wrong.length ? `<button id="reinforce" class="primary" type="button">强化本轮错词</button>` : ""}
      <button id="result-home" class="secondary" type="button">返回首页</button>`;
    document.getElementById("reinforce")?.addEventListener("click", startReinforcement);
    document.getElementById("result-home").addEventListener("click", renderHome);
  }

  function startReinforcement() {
    const targets = lastResult.answers.filter((answer) => !answer.correct);
    reinforcement = {
      testId: lastResult.id,
      targets,
      targetIndex: 0,
      queue: [],
      streak: 0,
      attempts: [],
      startedAt: new Date().toISOString(),
      questionStartedAt: 0,
      locked: false,
      seed: `${Date.now()}`,
    };
    scheduleTargetQuestion(true);
    renderReinforcementQuestion();
  }

  function alternateType(type) {
    return type === "sentence" ? "zh-en" : "sentence";
  }

  function targetDetails() {
    const target = reinforcement.targets[reinforcement.targetIndex];
    const group = groupMap.get(target.groupId);
    const expected = group.terms.find((term) => term.term === target.expected);
    return { target, group, expected };
  }

  function scheduleTargetQuestion(initial = false) {
    const { target, group, expected } = targetDetails();
    if (!initial) {
      const distance = 2 + (logic.hashString(`${reinforcement.seed}:${reinforcement.attempts.length}`) % 3);
      const fillers = group.terms.filter((term) => term.term !== expected.term);
      for (let index = 0; index < distance; index += 1) {
        const filler = fillers[index % fillers.length];
        const type = index % 2 ? "en-zh" : "sentence";
        reinforcement.queue.push({ ...logic.makeQuestion(group, filler, type, `${reinforcement.seed}:filler:${reinforcement.attempts.length}:${index}`), isTarget: false });
      }
    }
    reinforcement.queue.push({
      ...logic.makeQuestion(group, expected, alternateType(target.type), `${reinforcement.seed}:target:${reinforcement.attempts.length}`),
      isTarget: true,
    });
  }

  function renderReinforcementQuestion() {
    if (reinforcement.targetIndex >= reinforcement.targets.length) {
      finishReinforcement();
      return;
    }
    if (!reinforcement.queue.length) scheduleTargetQuestion(true);
    window.scrollTo(0, 0);
    screenLabel.textContent = "错词强化";
    const question = reinforcement.queue[0];
    reinforcement.locked = false;
    screen.innerHTML = `<header class="section-head"><div><p class="eyebrow">REINFORCEMENT</p><h2>强化本轮错词</h2><p>换题型练习，目标词需连续答对两次。</p></div><span class="progress-count">${reinforcement.targetIndex + 1}/${reinforcement.targets.length}</span></header>
      <section class="question-card">
        <div class="question-meta"><span>${question.isTarget ? `目标确认 · 连对 ${reinforcement.streak}/2` : "间隔练习"}</span><span>${escapeHtml(question.groupLabel)}</span></div>
        ${questionPrompt(question)}
        <div class="choices">${question.choices.map((choice) => `<button class="choice" data-answer="${escapeHtml(choice.term)}">${choiceMarkup(question, choice)}</button>`).join("")}</div>
        <div id="reinforcement-note" class="inline-note">强化结果不会修改正式成绩</div>
      </section>`;
    document.querySelectorAll("[data-answer]").forEach((button) => button.addEventListener("click", () => finishReinforcementAnswer(button.dataset.answer)));
    reinforcement.questionStartedAt = performance.now();
  }

  function finishReinforcementAnswer(selected) {
    if (reinforcement.locked) return;
    reinforcement.locked = true;
    const question = reinforcement.queue.shift();
    const answer = { ...logic.answerQuestion(question, selected, performance.now() - reinforcement.questionStartedAt), source: "reinforcement", isTarget: question.isTarget };
    reinforcement.attempts.push(answer);
    document.querySelectorAll("[data-answer]").forEach((button) => {
      button.disabled = true;
      if (button.dataset.answer === question.expected) button.classList.add("correct");
      else if (button.dataset.answer === selected) button.classList.add("wrong");
    });
    document.getElementById("reinforcement-note").textContent = answer.correct ? `${question.expected} · 正确` : `正确答案：${question.expected}`;

    if (question.isTarget) {
      reinforcement.streak = answer.correct ? reinforcement.streak + 1 : 0;
      if (reinforcement.streak >= 2) {
        reinforcement.targetIndex += 1;
        reinforcement.streak = 0;
        reinforcement.queue = [];
        if (reinforcement.targetIndex < reinforcement.targets.length) scheduleTargetQuestion(true);
      } else {
        scheduleTargetQuestion(false);
      }
    }
    setTimeout(renderReinforcementQuestion, 620);
  }

  function finishReinforcement() {
    state = logic.recordReinforcement(state, reinforcement.testId, reinforcement.attempts, reinforcement.startedAt);
    saveState();
    screenLabel.textContent = "强化完成";
    screen.innerHTML = `<section class="completion"><div class="completion-icon">${icon("target")}</div><h2>本轮错词已强化</h2><p>每个目标词都已连续答对两次。正式测试的 ${lastResult.score} / ${lastResult.total} 分保持不变。</p><button id="reinforcement-home" class="primary">返回首页</button></section>`;
    document.getElementById("reinforcement-home").addEventListener("click", renderHome);
  }

  function renderFatal(error) {
    screenLabel.textContent = "模块不可用";
    const storageError = error?.message === "storage" || error instanceof SyntaxError;
    screen.innerHTML = `<section class="fatal"><div class="fatal-icon">${icon("warning-circle")}</div><h2>易混词模块加载失败</h2><p>${storageError ? "易混词自己的本地记录无法读取。为保护数据，系统没有自动清除或重建。" : "易混词数据暂时无法加载。IELTS Listening 不受影响，可以直接返回继续使用。"}</p><a class="primary" style="display:grid;place-items:center;text-decoration:none" href="../">返回 IELTS Listening</a></section>`;
  }

  async function init() {
    if (!logic) throw new Error("logic");
    const response = await fetch(`./data/confusions.json?v=${encodeURIComponent(logic.VERSION)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.schemaVersion !== 1 || payload.groupCount !== 32 || payload.termCount !== 84 || !Array.isArray(payload.groups)) {
      throw new Error("data");
    }
    groups = payload.groups;
    groupMap = new Map(groups.map((group) => [group.id, group]));
    state = loadState();
    renderHome();
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" }).catch(() => {});
    }
  }

  init().catch(renderFatal);
})();
