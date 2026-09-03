const api = globalThis.browser ?? globalThis.chrome;
const TASKS_PAGE = "tasks.html";
const DEBUG_PAGE = "debug.html";
const EXAM_PAGE = "exam.html";
const DEBUG_KEY = "debugLog";
const MAX_DEBUG_EVENTS = 300;
let debugWriteQueue = Promise.resolve();

function queryActiveTab() {
  return api.tabs.query({ active: true, currentWindow: true });
}

async function scanActiveTab() {
  const [tab] = await queryActiveTab();
  if (!tab?.id || !/^https:\/\/(school|dnevnik)\.mos\.ru\//.test(tab.url || "")) {
    return { error: "Открой страницу МЭШ на school.mos.ru или dnevnik.mos.ru и повтори сканирование." };
  }
  try {
    return await api.tabs.sendMessage(tab.id, { type: "SCAN_PAGE" });
  } catch {
    return { error: "Не удалось подключиться к странице. Перезагрузи вкладку МЭШ и повтори попытку." };
  }
}

async function openPage(page) {
  const url = api.runtime.getURL(page);
  const tabs = await api.tabs.query({ url });
  if (tabs[0]?.id) {
    await api.tabs.update(tabs[0].id, { active: true });
    return;
  }
  await api.tabs.create({ url });
}

async function openTasks() {
  return openPage(TASKS_PAGE);
}

async function openDebug() {
  return openPage(DEBUG_PAGE);
}

async function openExam(print = false) {
  return openPage(print ? `${EXAM_PAGE}?print=1` : EXAM_PAGE);
}

function appendDebugEvent(event) {
  debugWriteQueue = debugWriteQueue.then(async () => {
    const result = await api.storage.local.get(DEBUG_KEY);
    const log = result[DEBUG_KEY] || { version: 1, startedAt: new Date().toISOString(), events: [] };
    log.events = [...(log.events || []), { timestamp: new Date().toISOString(), ...event }].slice(-MAX_DEBUG_EVENTS);
    const update = { [DEBUG_KEY]: log };
    if (event.response && /\/challenge\/[^/]+\/start-attempt(?:\?|$)/.test(event.url || "")) {
      update.latestExam = {
        capturedAt: new Date().toISOString(),
        url: event.url,
        response: event.response,
      };
    }
    await api.storage.local.set(update);
  });
  return debugWriteQueue;
}

async function getDebugLog() {
  const result = await api.storage.local.get(DEBUG_KEY);
  return result[DEBUG_KEY] || { version: 1, events: [] };
}

async function getLatestExam() {
  const result = await api.storage.local.get("latestExam");
  return result.latestExam || null;
}

api.runtime.onMessage.addListener(async (message) => {
  if (message?.type === "STORE_TASKS") {
    return api.storage.local.set({ tasks: message.tasks || [], source: message.source || "" });
  }
  if (message?.type === "SCAN_ACTIVE_TAB") return scanActiveTab();
  if (message?.type === "OPEN_TASKS") return openTasks();
  if (message?.type === "OPEN_DEBUG") return openDebug();
  if (message?.type === "OPEN_EXAM") return openExam();
  if (message?.type === "OPEN_EXAM_PRINT") return openExam(true);
  if (message?.type === "DEBUG_EVENT") return appendDebugEvent(message.event || {});
  if (message?.type === "GET_DEBUG_LOG") return { log: await getDebugLog() };
  if (message?.type === "GET_LATEST_EXAM") return { exam: await getLatestExam() };
  if (message?.type === "CLEAR_DEBUG_LOG") return api.storage.local.remove([DEBUG_KEY, "latestExam"]);
  return undefined;
});

const actionEvents = api.action ?? api.browserAction;
if (actionEvents?.onClicked) {
  actionEvents.onClicked.addListener(async () => {
    const result = await scanActiveTab();
    if (!result?.error) await openTasks();
  });
}
