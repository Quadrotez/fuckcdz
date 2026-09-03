const api = globalThis.browser ?? globalThis.chrome;
let activeTab = null;

function send(type) { return api.runtime.sendMessage({ type }); }
function setHint(text) { document.querySelector("#hint").textContent = text; }
function isDiary() { return /^https:\/\/(school|dnevnik)\.mos\.ru\//.test(activeTab?.url || ""); }
function isExam() { return /^https:\/\/uchebnik\.mos\.ru\//.test(activeTab?.url || ""); }

async function init() {
  [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
  const status = document.querySelector("#status");
  status.textContent = activeTab?.url ? new URL(activeTab.url).hostname : "Активная вкладка не определена";
  document.querySelector("#scan").disabled = !isDiary();
  document.querySelector("#exam").disabled = !isExam();
  document.querySelector("#print").disabled = !isExam();
  setHint(isDiary() ? "На этой вкладке можно собрать задания дневника." : isExam() ? "На этой вкладке доступен snapshot текущего теста." : "Открой school.mos.ru или uchebnik.mos.ru.");
}

async function run(action, successText) {
  try { await action(); setHint(successText); } catch (error) { setHint(`Ошибка: ${error?.message || error}`); }
}

document.querySelector("#scan").addEventListener("click", () => run(async () => {
  const result = await send("SCAN_ACTIVE_TAB");
  if (result?.error) throw new Error(result.error);
  await send("OPEN_TASKS");
}, "Задания собраны."));
document.querySelector("#exam").addEventListener("click", () => run(() => send("OPEN_EXAM"), "Открываю все задания теста."));
document.querySelector("#debug").addEventListener("click", () => run(() => send("OPEN_DEBUG"), "Открываю debug-лог."));
document.querySelector("#print").addEventListener("click", () => run(() => send("OPEN_EXAM_PRINT"), "Открываю диалог печати PDF."));
document.querySelector("#clear").addEventListener("click", () => run(() => send("CLEAR_DEBUG_LOG"), "Локальные данные очищены."));
init().catch((error) => setHint(String(error)));
