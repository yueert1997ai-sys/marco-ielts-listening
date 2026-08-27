const SESSION_COOKIE = "__Host-marco_vocab_admin";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 5;
const GITHUB_API = "https://api.github.com";

const encoder = new TextEncoder();

function base64Url(bytes) {
  let binary = "";
  new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(first, second) {
  const a = typeof first === "string" ? encoder.encode(first) : new Uint8Array(first);
  const b = typeof second === "string" ? encoder.encode(second) : new Uint8Array(second);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a[index] ^ b[index];
  return result === 0;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function makeSession(secret) {
  const payload = base64Url(encoder.encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    nonce: crypto.randomUUID(),
  })));
  return `${payload}.${await hmac(payload, secret)}`;
}

async function verifySession(token, secret) {
  if (!token || !secret) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !constantTimeEqual(signature, await hmac(payload, secret))) return false;
  try {
    const value = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return Number(value.exp) > Math.floor(Date.now() / 1000);
  } catch (_) {
    return false;
  }
}

function readCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const prefix = `${name}=`;
  return cookies.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix))?.slice(prefix.length) || "";
}

async function verifyPassword(password, stored) {
  const [kind, iterationsText, saltText, hashText] = String(stored || "").split("$");
  const iterations = Number(iterationsText);
  if (kind !== "pbkdf2" || !iterations || !saltText || !hashText) return false;
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: decodeBase64Url(saltText), iterations,
  }, keyMaterial, 256);
  return constantTimeEqual(new Uint8Array(bits), decodeBase64Url(hashText));
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function keyFor(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function singularCandidates(term) {
  const irregular = { children: "child", feet: "foot", geese: "goose", men: "man", mice: "mouse", people: "person", teeth: "tooth", women: "woman" };
  const words = String(term || "").toLowerCase().split(/\s+/);
  const word = words.pop() || "";
  const prefix = words.length ? `${words.join(" ")} ` : "";
  const result = new Set();
  if (irregular[word]) result.add(prefix + irregular[word]);
  if (word.endsWith("ies") && word.length > 3) result.add(prefix + word.slice(0, -3) + "y");
  if (word.endsWith("ves") && word.length > 3) {
    result.add(prefix + word.slice(0, -3) + "f");
    result.add(prefix + word.slice(0, -3) + "fe");
  }
  if (word.endsWith("es") && word.length > 2) {
    result.add(prefix + word.slice(0, -2));
    result.add(prefix + word.slice(0, -1));
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 1) result.add(prefix + word.slice(0, -1));
  return [...result];
}

function findCanonical(items, term) {
  const wanted = keyFor(term);
  const candidates = new Set([wanted, ...singularCandidates(term).map(keyFor)]);
  return items.find((item) => {
    const aliases = [item.id, item.term, ...(item.numberVariants || [])].map(keyFor);
    return aliases.some((alias) => candidates.has(alias));
  }) || null;
}

function validateModes(value) {
  const modes = [...new Set(Array.isArray(value) ? value : [])].sort();
  if (!modes.length || modes.some((mode) => !["spelling", "recognition"].includes(mode))) return null;
  return modes;
}

function validTerm(term) {
  return /^[A-Za-z0-9][A-Za-z0-9 '&-]*$/.test(String(term || "").trim());
}

async function requireSession(request, env) {
  return verifySession(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET);
}

function requireSameOrigin(request) {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

async function loginStatus(env, clientKey) {
  const row = await env.DB.prepare("SELECT attempts, window_started_at, locked_until FROM login_attempts WHERE client_key = ?")
    .bind(clientKey).first();
  return row || { attempts: 0, window_started_at: 0, locked_until: 0 };
}

function nextLoginFailure(previous, now = Date.now()) {
  const sameWindow = now - Number(previous.window_started_at || 0) < LOGIN_WINDOW_MS;
  const attempts = sameWindow ? Number(previous.attempts || 0) + 1 : 1;
  const windowStartedAt = sameWindow ? Number(previous.window_started_at) : now;
  const lockedUntil = attempts >= LOGIN_LIMIT ? now + LOGIN_WINDOW_MS : 0;
  return { attempts, windowStartedAt, lockedUntil };
}

async function recordLoginFailure(env, clientKey, previous) {
  const now = Date.now();
  const { attempts, windowStartedAt, lockedUntil } = nextLoginFailure(previous, now);
  await env.DB.prepare(`INSERT INTO login_attempts (client_key, attempts, window_started_at, locked_until)
    VALUES (?, ?, ?, ?) ON CONFLICT(client_key) DO UPDATE SET
    attempts=excluded.attempts, window_started_at=excluded.window_started_at, locked_until=excluded.locked_until`)
    .bind(clientKey, attempts, windowStartedAt, lockedUntil).run();
  return lockedUntil;
}

async function handleLogin(request, env) {
  if (!requireSameOrigin(request)) return json({ ok: false, error: "invalid_origin" }, 403);
  const clientKey = request.headers.get("CF-Connecting-IP") || "local";
  const status = await loginStatus(env, clientKey);
  if (Number(status.locked_until) > Date.now()) return json({ ok: false, error: "locked" }, 429);
  const body = await request.json().catch(() => ({}));
  if (!await verifyPassword(String(body.password || ""), env.ADMIN_PASSWORD_HASH)) {
    const lockedUntil = await recordLoginFailure(env, clientKey, status);
    return json({ ok: false, error: lockedUntil ? "locked" : "invalid_password" }, lockedUntil ? 429 : 401);
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE client_key = ?").bind(clientKey).run();
  const token = await makeSession(env.SESSION_SECRET);
  return json({ ok: true }, 200, {
    "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
  });
}

async function fetchJson(url, fallback = null) {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
    headers: { "User-Agent": "marco-vocabulary-admin" },
  });
  if (response.status === 404 && fallback !== null) return fallback;
  if (!response.ok) throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
  return response.json();
}

function githubRawUrl(env, path) {
  return `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/main/${path}`;
}

async function listPending(env) {
  const result = await env.DB.prepare(`SELECT id, request_id, operation, target_id, payload_json, status,
    batch_id, issue_number, error_message, created_at, updated_at
    FROM pending_operations ORDER BY created_at DESC LIMIT 500`).all();
  return (result.results || []).map((row) => ({ ...row, payload: JSON.parse(row.payload_json) }));
}

function mergePending(items, overrides, operations) {
  const merged = items.map((item) => ({ ...item, syncStatus: "published" }));
  const archived = new Map((overrides || []).filter((item) => item.archived).map((item) => [item.id, item]));
  archived.forEach((override, id) => {
    const snapshot = override.snapshot || {};
    if (!merged.some((item) => item.id === id)) {
      merged.push({ ...snapshot, id, term: snapshot.term || id, archived: true, syncStatus: "published" });
    }
  });
  for (const row of [...operations].reverse()) {
    const operation = row.payload;
    const target = findCanonical(merged, operation.canonicalTerm || operation.term || operation.targetId || operation.id);
    if (row.operation === "intake") {
      if (target) {
        target.isRealError = true;
        target.modes = [...new Set([...(target.modes || []), ...(operation.modes || [])])].sort();
        target.reportedCount = Number(target.reportedCount || 0) + 1;
        target.lastReportedAt = operation.lastReportedAt || operation.addedAt;
        target.syncStatus = row.status;
      } else {
        merged.unshift({
          id: keyFor(operation.canonicalTerm || operation.term), term: operation.canonicalTerm || operation.term,
          meaning: operation.meaning, phonetic: operation.phonetic, modes: operation.modes,
          category: "我的同步错词", isRealError: true, sourceType: "user", syncStatus: row.status,
          userAddedAt: operation.addedAt, reportedCount: 1,
        });
      }
    } else if (target) {
      if (row.operation === "patch") Object.assign(target, operation.patch || {}, { syncStatus: row.status });
      if (row.operation === "archive") Object.assign(target, { archived: true, syncStatus: row.status });
      if (row.operation === "restore") Object.assign(target, { archived: false, syncStatus: row.status });
    }
  }
  return merged.sort((a, b) => String(a.term).localeCompare(String(b.term), "en"));
}

async function refreshPublishing(env) {
  if (!env.GITHUB_TOKEN) return;
  const rows = await env.DB.prepare("SELECT DISTINCT issue_number FROM pending_operations WHERE status = 'publishing' AND issue_number IS NOT NULL").all();
  for (const row of rows.results || []) {
    const issue = await githubRequest(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${row.issue_number}`);
    let status = issue.state === "closed" ? "published" : "publishing";
    if (status === "publishing") {
      const comments = await githubRequest(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${row.issue_number}/comments`);
      if (comments.some((comment) => String(comment.body || "").includes("marco-sync:failed"))) status = "failed";
    }
    if (status !== "publishing") {
      await env.DB.prepare("UPDATE pending_operations SET status = ?, updated_at = ? WHERE issue_number = ?")
        .bind(status, new Date().toISOString(), row.issue_number).run();
    }
  }
}

async function vocabularyResponse(env) {
  await refreshPublishing(env);
  const base = String(env.TRAINING_BASE_URL || "").replace(/\/$/, "");
  const [items, audit, version, overrides, pending] = await Promise.all([
    fetchJson(`${base}/data/listening.json`),
    fetchJson(`${base}/data/audit.json`),
    fetchJson(`${base}/version.json`),
    fetchJson(githubRawUrl(env, "source/vocabulary_overrides.json"), []),
    listPending(env),
  ]);
  return json({
    ok: true,
    items: mergePending(items, overrides, pending.filter((item) => item.status !== "published")),
    jobs: pending,
    meta: {
      trainingVersion: version.version,
      releasedAt: version.releasedAt,
      entries: audit.uniqueEntries,
      sourceRevision: audit.sourceRevision,
      lastSyncedAt: pending.find((item) => item.status === "published")?.updated_at || null,
      adminVersion: "v1.0.0",
      trainingBaseUrl: base,
    },
  });
}

async function saveOperation(env, operation, payload, requestId, targetId = null) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const status = payload.meaning === "" && operation === "intake" ? "needs_review" : "pending";
  await env.DB.prepare(`INSERT INTO pending_operations
    (id, request_id, operation, target_id, payload_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING`)
    .bind(id, requestId, operation, targetId, JSON.stringify(payload), status, now, now).run();
  const row = await env.DB.prepare("SELECT * FROM pending_operations WHERE request_id = ?").bind(requestId).first();
  return { ...row, payload: JSON.parse(row.payload_json) };
}

async function handleIntake(request, env) {
  const body = await request.json().catch(() => ({}));
  const term = String(body.term || "").trim();
  const modes = validateModes(body.modes);
  if (!validTerm(term) || !modes) return json({ ok: false, error: "invalid_entry" }, 400);
  const payload = {
    op: "intake",
    term,
    canonicalTerm: String(body.canonicalTerm || term).trim(),
    meaning: String(body.meaning || "").trim(),
    phonetic: String(body.phonetic || "").trim(),
    modes,
    reason: String(body.reason || "后台录入错词").trim(),
    source: String(body.source || "manual").trim(),
    addedAt: new Date().toISOString().slice(0, 10),
    lastReportedAt: new Date().toISOString(),
  };
  const operation = await saveOperation(env, "intake", payload, String(body.requestId || crypto.randomUUID()));
  return json({ ok: true, operation }, 201);
}

async function handleVocabularyMutation(request, env, id, action) {
  const requestId = request.headers.get("Idempotency-Key") || crypto.randomUUID();
  let payload;
  if (action === "patch") {
    const body = await request.json().catch(() => ({}));
    const patch = {};
    if (body.meaning !== undefined) patch.meaning = String(body.meaning).trim();
    if (body.category !== undefined) patch.category = String(body.category).trim();
    if (body.reason !== undefined) patch.reason = String(body.reason).trim();
    if (body.phonetic !== undefined) patch.phonetic = String(body.phonetic).trim();
    if (body.modes !== undefined) {
      patch.modes = validateModes(body.modes);
      if (!patch.modes) return json({ ok: false, error: "invalid_modes" }, 400);
    }
    if (patch.meaning === "") return json({ ok: false, error: "meaning_required" }, 400);
    const reviewRows = await env.DB.prepare(
      "SELECT * FROM pending_operations WHERE operation = 'intake' AND status = 'needs_review' ORDER BY created_at DESC LIMIT 100"
    ).all();
    const reviewRow = (reviewRows.results || []).find((row) => {
      const review = JSON.parse(row.payload_json);
      return keyFor(review.canonicalTerm || review.term) === keyFor(id);
    });
    if (reviewRow) {
      const review = JSON.parse(reviewRow.payload_json);
      for (const [field, value] of Object.entries(patch)) review[field] = value;
      review.category = review.category || "我的同步错词";
      const now = new Date().toISOString();
      await env.DB.prepare("UPDATE pending_operations SET payload_json = ?, status = 'pending', updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(review), now, reviewRow.id).run();
      return json({ ok: true, operation: { ...reviewRow, payload: review, status: "pending", updated_at: now } });
    }
    payload = { op: "patch", targetId: id, patch };
  } else {
    payload = { op: action, targetId: id };
  }
  const operation = await saveOperation(env, action, payload, requestId, id);
  return json({ ok: true, operation }, 201);
}

async function githubRequest(env, path, options = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "marco-vocabulary-admin",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function publishPending(env, { includeFailed = false } = {}) {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured");
  const statuses = includeFailed ? "status IN ('pending', 'failed')" : "status = 'pending'";
  const result = await env.DB.prepare(`SELECT * FROM pending_operations WHERE ${statuses} ORDER BY created_at LIMIT 100`).all();
  const rows = result.results || [];
  if (!rows.length) return { ok: true, published: 0 };
  const batchId = crypto.randomUUID();
  const operations = rows.map((row) => JSON.parse(row.payload_json));
  const packageValue = { version: 2, batchId, operations };
  const date = new Date().toISOString().slice(0, 10);
  let issue;
  try {
    issue = await githubRequest(env, `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: `[词库管理] ${date} ${rows.length}项`,
        body: `由词库管理后台自动提交。\n\n\`\`\`json\n${JSON.stringify(packageValue, null, 2)}\n\`\`\``,
      }),
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    await env.DB.batch(rows.map((row) => env.DB.prepare(
      "UPDATE pending_operations SET status='failed', error_message=?, updated_at=? WHERE id=?"
    ).bind(error.message, failedAt, row.id)));
    throw error;
  }
  const now = new Date().toISOString();
  await env.DB.batch(rows.map((row) => env.DB.prepare(`UPDATE pending_operations SET
    status='publishing', batch_id=?, issue_number=?, error_message=NULL, updated_at=? WHERE id=? AND status IN ('pending', 'failed')`)
    .bind(batchId, issue.number, now, row.id)));
  return { ok: true, published: rows.length, batchId, issueNumber: issue.number };
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' https://esm.run; style-src 'self'; img-src 'self' data:; connect-src 'self' https://huggingface.co https://cdn-lfs.huggingface.co https://raw.githubusercontent.com https://github.com https://mlc.ai; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/session" && request.method === "POST") return handleLogin(request, env);
  if (url.pathname === "/api/session" && request.method === "GET") return json({ ok: true, authenticated: await requireSession(request, env) });
  if (url.pathname === "/api/session" && request.method === "DELETE") {
    if (!requireSameOrigin(request)) return json({ ok: false, error: "invalid_origin" }, 403);
    return json({ ok: true }, 200, { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
  }

  if (url.pathname.startsWith("/api/")) {
    if (!await requireSession(request, env)) return json({ ok: false, error: "unauthorized" }, 401);
    if (request.method !== "GET" && !requireSameOrigin(request)) return json({ ok: false, error: "invalid_origin" }, 403);
    if (url.pathname === "/api/vocabulary" && request.method === "GET") return vocabularyResponse(env);
    if (url.pathname === "/api/intake" && request.method === "POST") return handleIntake(request, env);
    if (url.pathname === "/api/publish" && request.method === "POST") return json(await publishPending(env, { includeFailed: true }));
    const match = url.pathname.match(/^\/api\/vocabulary\/([^/]+)(?:\/(archive|restore))?$/);
    if (match && request.method === "PATCH" && !match[2]) return handleVocabularyMutation(request, env, decodeURIComponent(match[1]), "patch");
    if (match && request.method === "POST" && match[2]) return handleVocabularyMutation(request, env, decodeURIComponent(match[1]), match[2]);
    return json({ ok: false, error: "not_found" }, 404);
  }

  return env.ASSETS ? withSecurityHeaders(await env.ASSETS.fetch(request)) : new Response("Not found", { status: 404 });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env).catch((error) => json({ ok: false, error: "server_error", detail: error.message }, 500));
  },
  async scheduled(_controller, env, context) {
    context.waitUntil(Promise.all([publishPending(env), refreshPublishing(env)]));
  },
};

export {
  constantTimeEqual, findCanonical, keyFor, makeSession, mergePending, nextLoginFailure,
  singularCandidates, validateModes, validTerm, verifyPassword, verifySession,
};
