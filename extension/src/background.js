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

async function submitAnswer(payload) {
  const latest = await getLatestExam();
  const tabId = Number(payload?.sourceTabId || latest?.sourceTabId);
  if (!tabId) return { ok: false, error: "Не найдена исходная вкладка теста. Открой тест заново и обнови snapshot." };
  try { return await api.tabs.sendMessage(tabId, { type: payload?.__complete ? "COMPLETE_ATTEMPT" : "SUBMIT_ANSWER", payload }); }
  catch { return { ok: false, error: "Не удалось связаться с исходной страницей теста. Открой её заново после установки расширения." }; }
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

function appendDebugEvent(event, sourceTabId = null) {
  debugWriteQueue = debugWriteQueue.then(async () => {
    const result = await api.storage.local.get(DEBUG_KEY);
    const log = result[DEBUG_KEY] || { version: 1, startedAt: new Date().toISOString(), events: [] };
    log.events = [...(log.events || []), { timestamp: new Date().toISOString(), ...event }].slice(-MAX_DEBUG_EVENTS);
    const update = { [DEBUG_KEY]: log };
    if (event.response && /\/challenge\/[^/]+\/start-attempt(?:\?|$)/.test(event.url || "")) {
      update.latestExam = {
        capturedAt: new Date().toISOString(),
        sourceTabId,
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

function providerConfig(settings) {
  const host = String(settings.host || "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!host) throw new Error("В настройках не указан хост.");
  const protocol = settings.protocol === "http" ? "http" : "https";
  const port = String(settings.port || "").trim();
  const origin = `${protocol}://${host}${port ? `:${port}` : ""}`;
  const chatPath = String(settings.path || "/v1/chat/completions").trim() || "/v1/chat/completions";
  const modelsPath = String(settings.modelsPath || "/v1/models").trim() || "/v1/models";
  return { origin, chatUrl: `${origin}${chatPath.startsWith("/") ? chatPath : `/${chatPath}`}`, modelsUrl: `${origin}${modelsPath.startsWith("/") ? modelsPath : `/${modelsPath}`}`, originPattern: `${origin}/*` };
}
function providerHeaders(settings) {
  const headers = { "Content-Type": "application/json" };
  if (settings.authType === "bearer" && settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  if (settings.authType === "x-api-key" && settings.apiKey) headers["X-API-Key"] = settings.apiKey;
  return headers;
}
async function providerFetch(url, settings, init = {}) {
  const config = providerConfig(settings);
  return fetch(url, { ...init, headers: { ...providerHeaders(settings), ...(init.headers || {}) } });
}
function detectVision(model) {
  const data = model || {}; const id = String(data.id || data.name || "").toLowerCase();
  const modalities = JSON.stringify(data.architecture || data.capabilities || data.input_modalities || data.modalities || "").toLowerCase();
  if (/vision|vl|llava|qwen2\.5-vl|qwen-vl|pixtral|gemini|claude-3|claude-4|gpt-4o|gpt-4\.1|o[1-4](-|$)/.test(id)) return true;
  return /image|vision|multimodal/.test(modalities);
}
function normalizeModels(data) {
  const models = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : Array.isArray(data) ? data : [];
  return models.map((model) => ({ id: String(model.id || model.name || ""), owned_by: model.owned_by || model.provider || "", vision: detectVision(model), raw: { capabilities: model.capabilities || model.input_modalities || model.modalities || null } })).filter((model) => model.id);
}
async function listProviderModels() {
  const stored = await api.storage.local.get("autoSolve"); const settings = stored.autoSolve || {}; const config = providerConfig(settings);
  const response = await providerFetch(config.modelsUrl, settings, { method: "GET" }); const raw = await response.text();
  if (!response.ok) throw new Error(`Endpoint вернул HTTP ${response.status}: ${raw.slice(0, 300)}`);
  let data; try { data = JSON.parse(raw); } catch { throw new Error("Endpoint вернул невалидный JSON."); }
  return { ok: true, models: normalizeModels(data), url: config.modelsUrl };
}
async function testProviderConnection() {
  const started = Date.now(); const result = await listProviderModels(); return { ...result, latencyMs: Date.now() - started };
}
async function imageDataParts(imageUrls, maxKb) {
  const limit = Math.max(64, Math.min(Number(maxKb) || 1024, 4096)) * 1024; const parts = [];
  for (const url of [...new Set(Array.isArray(imageUrls) ? imageUrls : [])].slice(0, 12)) {
    try { const response = await fetch(url); if (!response.ok) continue; const blob = await response.blob(); if (blob.size > limit) continue; const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); parts.push({ type: "image_url", image_url: { url: `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}` } }); } catch { /* omit inaccessible media */ }
  }
  return parts;
}
async function autoSolve(prompt, imageUrls) {
  const result = await api.storage.local.get("autoSolve"); const settings = result.autoSolve || {}; const config = providerConfig(settings);
  const content = [{ type: "text", text: String(prompt || "") }];
  const selectedModel = (Array.isArray(settings.models) ? settings.models : []).find((item) => item.id === settings.model);
  const visionEnabled = settings.sendImages !== false && (settings.vision === "on" || (settings.vision === "auto" && (selectedModel?.vision === true || detectVision({ id: settings.model }))));
  if (visionEnabled) content.push(...await imageDataParts(imageUrls, settings.maxImageSizeKb));
  const response = await providerFetch(config.chatUrl, settings, { method: "POST", body: JSON.stringify({ model: settings.model || "gpt-4o-mini", temperature: 0, messages: [{ role: "system", content: "Return only valid JSON. Do not include Markdown fences or explanations." }, { role: "user", content }] }) });
  const raw = await response.text(); if (!response.ok) return { ok: false, error: `Endpoint вернул HTTP ${response.status}: ${raw.slice(0, 300)}` };
  let data; try { data = JSON.parse(raw); } catch { return { ok: false, error: "Endpoint вернул невалидный JSON." }; }
  const answer = data?.choices?.[0]?.message?.content ?? data?.output_text ?? data?.content ?? data; return { ok: true, content: typeof answer === "string" ? answer : JSON.stringify(answer), imagesSent: content.length - 1 };
}

async function getLatestExam() {
  const result = await api.storage.local.get("latestExam");
  return result.latestExam || null;
}

api.runtime.onMessage.addListener(async (message, sender) => {
  if (message?.type === "STORE_TASKS") {
    return api.storage.local.set({ tasks: message.tasks || [], source: message.source || "" });
  }
  if (message?.type === "SCAN_ACTIVE_TAB") return scanActiveTab();
  if (message?.type === "OPEN_TASKS") return openTasks();
  if (message?.type === "OPEN_DEBUG") return openDebug();
  if (message?.type === "OPEN_EXAM") return openExam();
  if (message?.type === "OPEN_EXAM_PRINT") return openExam(true);
  if (message?.type === "SUBMIT_EXAM_ANSWER") return submitAnswer(message.payload);
  if (message?.type === "COMPLETE_EXAM_ATTEMPT") return submitAnswer({ ...message.payload, __complete: true });
  if (message?.type === "DEBUG_EVENT") return appendDebugEvent(message.event || {}, sender?.tab?.id || null);
  if (message?.type === "GET_DEBUG_LOG") return { log: await getDebugLog() };
  if (message?.type === "GET_LATEST_EXAM") return { exam: await getLatestExam() };
  if (message?.type === "LIST_MODELS") { try { return await listProviderModels(); } catch (error) { return { ok: false, error: error?.message || String(error) }; } }
  if (message?.type === "TEST_PROVIDER") { try { return await testProviderConnection(); } catch (error) { return { ok: false, error: error?.message || String(error) }; } }
  if (message?.type === "AUTO_SOLVE") { try { return await autoSolve(message.prompt, message.imageUrls); } catch (error) { return { ok: false, error: error?.message || String(error) }; } }
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
