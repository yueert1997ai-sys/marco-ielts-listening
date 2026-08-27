import { escapeHtml, filterItems, findCanonical, lookupDictionary, modesFor } from "./logic.js";

const PAGE_SIZE = 30;
const AUTO_PUBLISH_SECONDS = 30;
const state = {
  items: [], jobs: [], meta: {}, page: 1, query: "", filter: "all",
  mode: localStorage.getItem("marcoAdmin.captureMode") || "recognition",
  dictionary: null, syncDeadline: 0, syncTimer: null, modelWorker: null, modelReady: false,
};

const $ = (selector) => document.querySelector(selector);
const loginView = $("#login-view");
const adminView = $("#admin-view");
const captureMessage = $("#capture-message");
const toast = $("#toast");

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  const value = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (response.status === 401 && path !== "/api/session") showLogin();
  if (!response.ok) throw new Error(value.error || value.detail || `HTTP ${response.status}`);
  return value;
}

function showLogin() {
  loginView.hidden = false;
  adminView.hidden = true;
  $("#password").focus();
}

function showAdmin() {
  loginView.hidden = true;
  adminView.hidden = false;
  setMode(state.mode);
  $("#term-input").focus();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setMode(mode) {
  state.mode = ["recognition", "spelling", "both"].includes(mode) ? mode : "recognition";
  localStorage.setItem("marcoAdmin.captureMode", state.mode);
  document.querySelectorAll("#mode-switch button").forEach((button) => {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function sourceLabel(item) {
  if (item.sourceType === "user") return "同步错词";
  if (item.isRealError) return "真实错词";
  return "飞书基础词";
}

function statusLabel(item) {
  if (item.archived) return '<span class="badge">已停用</span>';
  const status = item.syncStatus || "published";
  const labels = { pending: "待同步", publishing: "发布中", failed: "失败", needs_review: "待补释义", published: "已上线" };
  return `<span class="badge ${escapeHtml(status)}">${labels[status] || "已上线"}</span>`;
}

function render() {
  const filtered = filterItems(state.items, state.query, state.filter);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  $("#visible-count").textContent = `(${filtered.length})`;
  $("#page-label").textContent = `第 ${state.page} / ${pages} 页`;
  $("#prev-page").disabled = state.page <= 1;
  $("#next-page").disabled = state.page >= pages;
  $("#empty-state").hidden = visible.length > 0;
  $("#vocabulary-body").innerHTML = visible.map((item) => `
    <tr class="${item.archived ? "archived" : ""}">
      <td><div class="word-cell">
        <button class="audio-button" type="button" data-audio="${escapeHtml(item.id)}" aria-label="播放 ${escapeHtml(item.term)}">▶</button>
        <div><span class="word-term">${escapeHtml(item.term)}</span>${item.phonetic ? `<span class="phonetic">/${escapeHtml(item.phonetic).replace(/^\/+|\/+$/g, "")}/</span>` : ""}</div>
      </div></td>
      <td>${escapeHtml(item.meaning || "待补释义")}${item.note || item.errorNote ? `<span class="cell-secondary">${escapeHtml(item.errorNote || item.note)}</span>` : ""}</td>
      <td>${(item.modes || []).map((mode) => `<span class="badge ${mode}">${mode === "spelling" ? "听写" : "识词"}</span>`).join("")}</td>
      <td>${sourceLabel(item)}<span class="cell-secondary">${escapeHtml(item.category || "未分类")}${item.userAddedAt ? ` · ${escapeHtml(item.userAddedAt)}` : ""}</span></td>
      <td>${item.numberVariants?.length ? escapeHtml(item.numberVariants.join(" / ")) : "—"}</td>
      <td>${statusLabel(item)}${item.reportedCount ? `<span class="cell-secondary">录入 ${item.reportedCount} 次</span>` : ""}</td>
      <td><div class="row-actions">
        <button type="button" data-edit="${escapeHtml(item.id)}">修改</button>
        <button type="button" class="archive-action" data-${item.archived ? "restore" : "archive"}="${escapeHtml(item.id)}">${item.archived ? "恢复" : "停用"}</button>
      </div></td>
    </tr>`).join("");

  document.querySelectorAll("[data-audio]").forEach((button) => button.addEventListener("click", () => playAudio(button.dataset.audio)));
  document.querySelectorAll("[data-edit]").forEach((button) => button.addEventListener("click", () => openEdit(button.dataset.edit)));
  document.querySelectorAll("[data-archive]").forEach((button) => button.addEventListener("click", () => mutateStatus(button.dataset.archive, "archive")));
  document.querySelectorAll("[data-restore]").forEach((button) => button.addEventListener("click", () => mutateStatus(button.dataset.restore, "restore")));

  const counts = state.jobs.reduce((result, job) => ({ ...result, [job.status]: (result[job.status] || 0) + 1 }), {});
  $("#pending-count").textContent = (counts.pending || 0) + (counts.needs_review || 0);
  $("#publishing-count").textContent = counts.publishing || 0;
  $("#failed-count").textContent = counts.failed || 0;
  $("#training-version").textContent = `训练端 ${state.meta.trainingVersion || "—"}`;
  $("#admin-version").textContent = `后台 ${state.meta.adminVersion || "v1.0.0"}`;
  $("#last-sync").textContent = `最后同步 ${formatDate(state.meta.lastSyncedAt)}`;
}

async function loadVocabulary({ quiet = false } = {}) {
  if (!quiet) captureMessage.textContent = "正在读取最新词库…";
  const value = await api("/api/vocabulary");
  state.items = value.items;
  state.jobs = value.jobs;
  state.meta = value.meta;
  render();
  if (!quiet) captureMessage.textContent = `已载入 ${state.items.filter((item) => !item.archived).length} 个在用词条。`;
}

async function loadDictionary() {
  if (state.dictionary) return state.dictionary;
  const response = await fetch("./data/ecdict-lite.json");
  if (!response.ok) throw new Error("本地词典未加载");
  state.dictionary = await response.json();
  return state.dictionary;
}

function modelEnrich(term) {
  return new Promise((resolve, reject) => {
    if (!state.modelWorker) {
      state.modelWorker = new Worker("./local-ai-worker.js", { type: "module" });
      state.modelWorker.addEventListener("message", (event) => {
        if (event.data.type === "progress") {
          $("#model-progress-bar").style.width = `${Math.max(4, Math.round((event.data.progress || 0) * 100))}%`;
          $("#model-progress-text").textContent = event.data.text || "准备中…";
        }
      });
    }
    const requestId = crypto.randomUUID();
    const onMessage = (event) => {
      if (event.data.requestId !== requestId) return;
      state.modelWorker.removeEventListener("message", onMessage);
      $("#model-dialog").close();
      if (event.data.type === "result") resolve(event.data.value);
      else reject(new Error(event.data.error || "本地模型处理失败"));
    };
    state.modelWorker.addEventListener("message", onMessage);
    $("#model-dialog").showModal();
    state.modelWorker.postMessage({ type: "enrich", requestId, term, preferredModel: "Qwen3-1.7B-q4f16_1-MLC" });
  });
}

async function enrichTerm(term) {
  const existing = findCanonical(state.items, term);
  if (existing) return {
    term, canonicalTerm: existing.term, meaning: existing.meaning, phonetic: existing.phonetic || "",
    reason: `再次录入：${term}`, source: "existing",
  };
  const dictionary = await loadDictionary();
  const entry = lookupDictionary(dictionary, term);
  if (entry) return {
    term, canonicalTerm: entry.word || term, meaning: entry.translation || "", phonetic: entry.phonetic || "",
    reason: "后台录入生词", source: "ecdict",
  };
  const permissionKey = "marcoAdmin.localModelApproved";
  if (localStorage.getItem(permissionKey) !== "yes") {
    const approved = window.confirm("本地词典没找到这个词。是否下载约 1GB 的本地词汇模型？只下载一次，不使用 API。");
    if (!approved) return { term, canonicalTerm: term, meaning: "", phonetic: "", reason: "待补中文释义", source: "manual" };
    localStorage.setItem(permissionKey, "yes");
  }
  if (!navigator.gpu) return { term, canonicalTerm: term, meaning: "", phonetic: "", reason: "当前浏览器不支持 WebGPU，待补释义", source: "manual" };
  return { term, canonicalTerm: term, ...(await modelEnrich(term)), source: "local-model" };
}

function startPublishCountdown() {
  state.syncDeadline = Date.now() + AUTO_PUBLISH_SECONDS * 1000;
  clearInterval(state.syncTimer);
  const update = () => {
    const remaining = Math.max(0, state.syncDeadline - Date.now());
    const progress = (1 - remaining / (AUTO_PUBLISH_SECONDS * 1000)) * 100;
    $("#sync-progress").style.width = `${progress}%`;
    if (remaining <= 0) {
      clearInterval(state.syncTimer);
      publishPending();
    } else {
      captureMessage.textContent = `已保存，${Math.ceil(remaining / 1000)} 秒后自动同步。`;
    }
  };
  update();
  state.syncTimer = setInterval(update, 250);
}

async function captureTerm(term) {
  captureMessage.textContent = `正在识别 ${term}…`;
  const enriched = await enrichTerm(term);
  const value = await api("/api/intake", {
    method: "POST",
    body: JSON.stringify({ ...enriched, modes: modesFor(state.mode), requestId: crypto.randomUUID() }),
  });
  await loadVocabulary({ quiet: true });
  if (value.operation.status === "needs_review") {
    captureMessage.textContent = `${term} 已保存，但需先补中文释义才会发布。`;
    const item = findCanonical(state.items, term);
    if (item) openEdit(item.id);
  } else {
    startPublishCountdown();
    showToast(`${enriched.canonicalTerm} 已加入错词库`);
  }
}

async function publishPending() {
  clearInterval(state.syncTimer);
  $("#sync-progress").style.width = "100%";
  try {
    const value = await api("/api/publish", { method: "POST", body: "{}" });
    captureMessage.textContent = value.published ? `已提交 ${value.published} 项，正在生成词库和读音。` : "没有待同步内容。";
    await loadVocabulary({ quiet: true });
  } catch (error) {
    captureMessage.textContent = `同步未启动：${error.message}`;
  } finally {
    setTimeout(() => { $("#sync-progress").style.width = "0"; }, 700);
  }
}

function playAudio(id) {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return;
  if (item.audioPath && state.meta.trainingBaseUrl) {
    const audio = new Audio(`${state.meta.trainingBaseUrl}/${item.audioPath}`);
    audio.play().catch(() => speak(item.term));
  } else speak(item.term);
}

function speak(term) {
  const utterance = new SpeechSynthesisUtterance(term);
  utterance.lang = "en-GB";
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function openEdit(id) {
  const item = state.items.find((candidate) => candidate.id === id);
  if (!item) return;
  $("#edit-id").value = item.id;
  $("#edit-title").textContent = item.term;
  $("#edit-meaning").value = item.meaning || "";
  $("#edit-category").value = item.category || "";
  $("#edit-reason").value = item.errorNote || item.note || "";
  $("#edit-recognition").checked = item.modes?.includes("recognition");
  $("#edit-spelling").checked = item.modes?.includes("spelling");
  $("#edit-dialog").showModal();
}

async function saveEdit() {
  const id = $("#edit-id").value;
  const modes = [$("#edit-recognition").checked && "recognition", $("#edit-spelling").checked && "spelling"].filter(Boolean);
  if (!modes.length) throw new Error("至少保留一种训练类型");
  await api(`/api/vocabulary/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ meaning: $("#edit-meaning").value, category: $("#edit-category").value, reason: $("#edit-reason").value, modes }),
  });
  $("#edit-dialog").close();
  await loadVocabulary({ quiet: true });
  startPublishCountdown();
  showToast("修改已保存");
}

async function mutateStatus(id, action) {
  const label = action === "archive" ? "停用" : "恢复";
  if (action === "archive" && !window.confirm("停用后这个词不再进入训练，但历史会保留。继续吗？")) return;
  await api(`/api/vocabulary/${encodeURIComponent(id)}/${action}`, {
    method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: "{}",
  });
  await loadVocabulary({ quiet: true });
  startPublishCountdown();
  showToast(`${label}已保存`);
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#login-message");
  message.textContent = "正在验证…";
  try {
    await api("/api/session", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
    $("#password").value = "";
    showAdmin();
    await loadVocabulary();
  } catch (error) {
    message.textContent = error.message === "locked" ? "尝试过多，请 15 分钟后再试。" : "密码不正确。";
  }
});

$("#capture-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#term-input");
  const term = input.value.trim();
  if (!term) return;
  input.disabled = true;
  try {
    await captureTerm(term);
    input.value = "";
  } catch (error) {
    captureMessage.textContent = `录入失败：${error.message}`;
  } finally {
    input.disabled = false;
    input.focus();
  }
});

document.querySelectorAll("#mode-switch button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
$("#search-input").addEventListener("input", (event) => { state.query = event.target.value; state.page = 1; render(); });
$("#filter-select").addEventListener("change", (event) => { state.filter = event.target.value; state.page = 1; render(); });
$("#prev-page").addEventListener("click", () => { state.page -= 1; render(); });
$("#next-page").addEventListener("click", () => { state.page += 1; render(); });
$("#refresh").addEventListener("click", () => loadVocabulary());
$("#publish-now").addEventListener("click", () => publishPending());
$("#close-dialog").addEventListener("click", () => $("#edit-dialog").close());
$("#cancel-edit").addEventListener("click", () => $("#edit-dialog").close());
$("#edit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await saveEdit(); } catch (error) { showToast(error.message); }
});
$("#logout").addEventListener("click", async () => { await api("/api/session", { method: "DELETE", body: "{}" }); showLogin(); });

window.addEventListener("pageshow", async () => {
  try {
    const session = await api("/api/session");
    if (!session.authenticated) return showLogin();
    showAdmin();
    await loadVocabulary();
  } catch (_) { showLogin(); }
});
