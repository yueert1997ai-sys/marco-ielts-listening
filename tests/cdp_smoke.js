const fs = require("fs");

const CDP_HTTP = "http://127.0.0.1:9223";

async function connect() {
  const existing = await fetch(`${CDP_HTTP}/json`).then((r) => r.json());
  for (const target of existing.filter((item) => item.type === "page")) {
    await fetch(`${CDP_HTTP}/json/close/${target.id}`);
  }
  const target = await fetch(`${CDP_HTTP}/json/new?http://127.0.0.1:4173/tests/reset.html`, { method: "PUT" }).then((r) => r.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  function send(method, params = {}) {
    id += 1;
    const current = id;
    socket.send(JSON.stringify({ id: current, method, params }));
    return new Promise((resolve, reject) => pending.set(current, { resolve, reject }));
  }
  return { socket, send };
}

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function screenshot(send, name) {
  const result = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.writeFileSync(name, Buffer.from(result.data, "base64"));
}

(async () => {
  const { socket, send } = await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate(send, `(async () => {
    localStorage.removeItem('marcoIeltsListening.v1');
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    return true;
  })()`);
  await send("Page.navigate", { url: "http://127.0.0.1:4173/?cdp=2" });
  await new Promise((resolve) => setTimeout(resolve, 1800));

  const home = await evaluate(send, `(() => ({
    innerWidth, innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    start: document.querySelector('#start')?.textContent,
    ticks: document.querySelectorAll('.signal-tick').length,
    appWidth: Math.round(document.querySelector('.app-shell').getBoundingClientRect().width),
    cardWidth: Math.round(document.querySelector('.home-card').getBoundingClientRect().width)
  }))()`);
  const offline = await evaluate(send, `(async () => {
    const registration = await navigator.serviceWorker.ready;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const names = await caches.keys();
    const cache = names.includes('ielts-listening-v5') ? await caches.open('ielts-listening-v5') : null;
    const keys = cache ? await cache.keys() : [];
    return {
      active: registration.active?.state || null,
      names,
      total: keys.length,
      audio: keys.filter((request) => request.url.includes('/audio/') && request.url.endsWith('.mp3')).length
    };
  })()`);
  await screenshot(send, "mobile-cdp-home.png");

  await evaluate(send, "document.querySelector('#browse').click(); true");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const browse = await evaluate(send, `(() => ({
    title: document.querySelector('#screen-title')?.textContent,
    count: document.querySelector('#day-count')?.textContent,
    cards: document.querySelectorAll('.word-card').length,
    filters: document.querySelectorAll('.filter-chip').length,
    audioButtons: document.querySelectorAll('.mini-play').length,
    scrollWidth: document.documentElement.scrollWidth,
    railHidden: getComputedStyle(document.querySelector('#signal-rail')).display === 'none'
  }))()`);
  await screenshot(send, "mobile-cdp-browse.png");
  await evaluate(send, "document.querySelector('#browse-back').click(); true");
  await new Promise((resolve) => setTimeout(resolve, 100));

  await evaluate(send, "document.querySelector('#start').click(); true");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const spelling = await evaluate(send, `(() => {
    const input = document.querySelector('#answer');
    const audioPath = JSON.parse(localStorage.getItem('marcoIeltsListening.v1')).daily.queue[0].key;
    return {
      mode: document.querySelector('.mode-label')?.textContent,
      hasPlay: Boolean(document.querySelector('#play')),
      autocomplete: input?.getAttribute('autocomplete'),
      autocorrect: input?.getAttribute('autocorrect'),
      spellcheck: input?.spellcheck,
      audioPath
    };
  })()`);
  await screenshot(send, "mobile-cdp-spelling.png");

  await evaluate(send, `(() => {
    const input = document.querySelector('#answer');
    input.value = 'wrong';
    document.querySelector('#spelling-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const result = await evaluate(send, `(() => {
    const state = JSON.parse(localStorage.getItem('marcoIeltsListening.v1'));
    return { result: document.querySelector('.result-mark')?.textContent, retries: state.daily.queue.filter(x => x.isRetry).length };
  })()`);
  await evaluate(send, "document.querySelector('#continue').click(); true");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const recognition = await evaluate(send, `(() => ({
    mode: document.querySelector('.mode-label')?.textContent,
    choices: document.querySelectorAll('.choice').length,
    timer: Boolean(document.querySelector('.timer-bar')),
    timerText: document.querySelector('#timer-count')?.textContent
  }))()`);
  await new Promise((resolve) => setTimeout(resolve, 5200));
  recognition.expiredText = await evaluate(send, "document.querySelector('#timer-count')?.textContent");
  await screenshot(send, "mobile-cdp-recognition.png");

  console.log(JSON.stringify({ ok: true, home, offline, browse, spelling, result, recognition }));
  socket.close();
})().catch((error) => { console.error(error); process.exit(1); });
