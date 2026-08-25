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
    review: document.querySelector('#review')?.textContent.trim(),
    reviewDisabled: document.querySelector('#review')?.disabled,
    ticks: document.querySelectorAll('.signal-tick').length,
    appWidth: Math.round(document.querySelector('.app-shell').getBoundingClientRect().width),
    cardWidth: Math.round(document.querySelector('.home-card').getBoundingClientRect().width)
  }))()`);
  const offline = await evaluate(send, `(async () => {
    const registration = await navigator.serviceWorker.ready;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const names = await caches.keys();
    const cache = names.includes('ielts-listening-v16') ? await caches.open('ielts-listening-v16') : null;
    const keys = cache ? await cache.keys() : [];
    return {
      active: registration.active?.state || null,
      names,
      total: keys.length,
      audio: keys.filter((request) => request.url.includes('/audio/') && request.url.endsWith('.mp3')).length,
      directionAudio: keys.filter((request) => request.url.includes('/audio/directions/') && request.url.endsWith('.mp3')).length
    };
  })()`);
  await screenshot(send, "mobile-cdp-home.png");

  const dailyBeforeDirection = await evaluate(send, "JSON.stringify(JSON.parse(localStorage.getItem('marcoIeltsListening.v1')).daily)");
  await evaluate(send, "document.querySelector('#direction').click(); true");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const directionIntro = await evaluate(send, `(() => ({
    title: document.querySelector('#screen-title')?.textContent,
    previewTargets: document.querySelectorAll('.direction-target-preview').length,
    rules: document.querySelectorAll('.direction-rules span').length,
    ticks: document.querySelectorAll('.signal-tick').length,
    scrollWidth: document.documentElement.scrollWidth
  }))()`);
  await evaluate(send, "document.querySelector('[data-direction-mode=hard]').click(); true");
  await new Promise((resolve) => setTimeout(resolve, 100));
  directionIntro.hard = await evaluate(send, `(() => ({
    previewTargets: document.querySelectorAll('.direction-target-preview').length,
    activeMode: document.querySelector('.direction-mode-option.active')?.textContent.trim(),
    diagonalBoard: document.querySelector('.direction-board')?.classList.contains('direction-board-diagonal'),
    scrollWidth: document.documentElement.scrollWidth
  }))()`);
  await evaluate(send, "document.querySelector('#direction-start').click(); true");
  await new Promise((resolve) => setTimeout(resolve, 350));
  const directionSession = await evaluate(send, `(() => ({
    targets: document.querySelectorAll('button.direction-target').length,
    timer: document.querySelector('#direction-timer-count')?.textContent,
    timerDuration: document.querySelector('#direction-timer-bar')?.style.animationDuration,
    mode: document.querySelector('.timer-label span')?.textContent,
    diagonalBoard: document.querySelector('.direction-board')?.classList.contains('direction-board-diagonal'),
    replayVisible: !document.querySelector('#direction-audio-retry')?.hidden,
    boardWidth: Math.round(document.querySelector('.direction-board').getBoundingClientRect().width),
    boardHeight: Math.round(document.querySelector('.direction-board').getBoundingClientRect().height),
    scrollWidth: document.documentElement.scrollWidth
  }))()`);
  await screenshot(send, "mobile-cdp-direction.png");
  await evaluate(send, "document.querySelector('#direction-exit').click(); true");
  await new Promise((resolve) => setTimeout(resolve, 100));
  directionSession.dailyUnchanged = await evaluate(send,
    `JSON.stringify(JSON.parse(localStorage.getItem('marcoIeltsListening.v1')).daily) === ${JSON.stringify(dailyBeforeDirection)}`);

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
    return {
      result: document.querySelector('.result-mark')?.textContent,
      note: document.querySelector('.note')?.textContent,
      learningRetries: state.daily.queue.filter(x => x.isRetry).length,
      reviewPending: state.reviewDaily.queue.length
    };
  })()`);
  await evaluate(send, "document.querySelector('#result-home').click(); true");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const reviewHome = await evaluate(send, `(() => ({
    text: document.querySelector('#review')?.textContent.trim(),
    disabled: document.querySelector('#review')?.disabled,
    newProgress: document.querySelector('#day-count')?.textContent
  }))()`);
  await evaluate(send, "document.querySelector('#start').click(); true");
  await evaluate(send, `(async () => {
    for (let index = 0; index < 12 && !document.querySelector('.choice'); index += 1) {
      document.querySelector('#spelling-dont-know')?.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      document.querySelector('#continue')?.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return Boolean(document.querySelector('.choice'));
  })()`);
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

  if (home.scrollWidth > 390 || directionIntro.previewTargets !== 8
    || directionIntro.hard.previewTargets !== 4 || !directionIntro.hard.diagonalBoard
    || directionSession.targets !== 4 || directionSession.timerDuration !== "1000ms"
    || !directionSession.mode.includes("1.4×")
    || !directionSession.diagonalBoard || directionSession.scrollWidth > 390
    || !directionSession.dailyUnchanged || result.learningRetries !== 0
    || result.reviewPending < 1 || !result.note.includes('高频复习')
    || reviewHome.disabled || !reviewHome.text.includes('待复习')) {
    throw new Error("Mobile direction mode smoke check failed");
  }

  console.log(JSON.stringify({ ok: true, home, offline, directionIntro, directionSession, browse, spelling, result, reviewHome, recognition }));
  socket.close();
})().catch((error) => { console.error(error); process.exit(1); });
