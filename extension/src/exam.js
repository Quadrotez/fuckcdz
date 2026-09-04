const api = globalThis.browser ?? globalThis.chrome;
const ANSWERS_KEY = "examAnswers";
const state = { snapshot: null, answers: {}, dragId: null };

const TYPE_HELP = {
  "answer/single": "Выберите один вариант ответа.",
  "answer/multiple": "Выберите все подходящие варианты ответа.",
  "answer/free": "Введите ответ текстом. Если нужно, используйте несколько строк.",
  "answer/string": "Введите текстовый ответ в поле.",
  "answer/number": "Введите числовой ответ.",
  "answer/order": "Расположите шаги решения в правильной последовательности: от исходного условия к итоговому ответу.",
  "answer/match": "Сопоставьте элементы левой и правой части. Для каждого элемента выберите соответствующую пару.",
  "answer/groups": "Распределите варианты по подходящим группам.",
  "answer/table": "Заполните ячейки таблицы или выберите подходящие значения.",
  "answer/gap/match/text": "Перетащите варианты в поля пропусков. В каждом поле должно оказаться подходящее слово или число."
};

function textNode(value) { return document.createTextNode(String(value)); }
function isObject(value) { return value && typeof value === "object"; }
function optionLabel(option) {
  if (!isObject(option)) return String(option ?? "");
  const parts = [];
  if (option.text) parts.push(String(option.text));
  if (Array.isArray(option.content)) parts.push(option.content.map(contentToPlain).join(""));
  return parts.join(" ").trim() || "Без текста";
}
function contentToPlain(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(contentToPlain).join("");
  if (!isObject(value)) return "";
  return [value.text, value.content].filter(Boolean).map(contentToPlain).join("");
}

function mathElement(latex, display = false) {
  const span = document.createElement("span");
  span.className = `math ${display ? "math-display" : ""}`;
  span.setAttribute("role", "math");
  span.title = String(latex);
  span.textContent = normalizeMath(String(latex));
  return span;
}
function normalizeMath(value) {
  return value
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
    .replace(/\\cdot|\\times/g, "·")
    .replace(/\\neq/g, "≠")
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\pm/g, "±")
    .replace(/\\infty/g, "∞")
    .replace(/\\(alpha|beta|gamma|delta|lambda|mu|pi|sigma|omega)/gi, (_, name) => ({ alpha: "α", beta: "β", gamma: "γ", delta: "δ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", omega: "ω" }[name.toLowerCase()] || name))
    .replace(/\\left|\\right/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\/g, "");
}

function appendRich(parent, value) {
  if (value == null) return;
  if (Array.isArray(value)) { value.forEach((item) => appendRich(parent, item)); return; }
  if (typeof value === "string" || typeof value === "number") { parent.append(textNode(value)); return; }
  if (!isObject(value)) return;
  const type = String(value.type || "");
  if (type.includes("math")) { parent.append(mathElement(value.content ?? value.text ?? "", Boolean(value.is_multiline))); return; }
  if (type.includes("table")) { parent.append(renderTableValue(value.table)); return; }
  if (value.text) parent.append(textNode(value.text));
  if (value.content != null) appendRich(parent, value.content);
}
function renderTableValue(table) {
  const wrapper = document.createElement("div"); wrapper.className = "table-wrap";
  if (!table?.cells) { wrapper.textContent = "Таблица не распознана"; return wrapper; }
  const html = document.createElement("table");
  const rows = Number(table.rows || 0); const cols = Number(table.columns || 0);
  for (let r = 0; r < rows; r += 1) {
    const tr = document.createElement("tr");
    for (let c = 0; c < cols; c += 1) {
      const cell = document.createElement(r === 0 || c === 0 ? "th" : "td");
      const values = table.cells?.[String(r)]?.[String(c)] || [];
      cell.textContent = values.join(" "); tr.append(cell);
    }
    html.append(tr);
  }
  wrapper.append(html); return wrapper;
}
function renderMedia(element) {
  const url = element.relative_url || element.preview_url;
  if (!url) return null;
  const media = document.createElement("div"); media.className = "media-box";
  const type = `${element.atomic_type || ""} ${url}`.toLowerCase();
  if (type.includes("video") || /\.(mp4|webm|ogg)(\?|$)/.test(type)) {
    const video = document.createElement("video"); video.controls = true; video.preload = "metadata"; video.src = url; media.append(video);
  } else if (type.includes("audio") || /\.(mp3|wav|ogg)(\?|$)/.test(type)) {
    const audio = document.createElement("audio"); audio.controls = true; audio.src = url; media.append(audio);
  } else {
    const image = document.createElement("img"); image.loading = "lazy"; image.alt = element.description || "Иллюстрация к заданию"; image.src = url; media.append(image);
  }
  if (element.description) { const caption = document.createElement("div"); caption.className = "media-caption"; caption.textContent = element.description; media.append(caption); }
  return media;
}
function renderQuestion(parent, elements) {
  const wrapper = document.createElement("div"); wrapper.className = "question-content";
  for (const element of Array.isArray(elements) ? elements : []) {
    if (!isObject(element)) continue;
    const media = renderMedia(element); if (media) { wrapper.append(media); continue; }
    const block = document.createElement("div"); block.className = "content-block";
    if (element.text) block.append(textNode(element.text));
    if (element.content) appendRich(block, element.content);
    if (!block.textContent.trim() && !block.querySelector(".math, table")) continue;
    wrapper.append(block);
  }
  if (!wrapper.textContent.trim() && !wrapper.querySelector(".media-box, table")) wrapper.append(textNode("Текст вопроса не найден в snapshot."));
  parent.append(wrapper);
}
function makeChoice(option, inputType, taskId, value, labelPrefix = "") {
  const label = document.createElement("label"); label.className = "choice";
  const input = document.createElement("input"); input.type = inputType; input.name = `task-${taskId}`; input.value = value;
  input.checked = inputType === "checkbox" ? (state.answers[taskId] || []).includes(value) : state.answers[taskId] === value;
  input.addEventListener("change", () => {
    if (inputType === "checkbox") {
      const values = [...document.querySelectorAll(`input[name="task-${taskId}"]:checked`)].map((node) => node.value); state.answers[taskId] = values;
    } else state.answers[taskId] = value;
    persistAnswers();
  });
  const body = document.createElement("span"); if (labelPrefix) { const prefix = document.createElement("b"); prefix.textContent = labelPrefix; body.append(prefix, textNode(" ")); } appendRich(body, option);
  label.append(input, body); return label;
}
function renderSimpleOptions(container, task, multiple = false) {
  const options = task.answer?.options || [];
  const list = document.createElement("div"); list.className = "choice-list";
  options.forEach((option, index) => list.append(makeChoice(option, multiple ? "checkbox" : "radio", task.id, String(option.id ?? index), `${index + 1}.`)));
  container.append(list);
}
function renderTextInput(container, task, numeric = false) {
  const input = document.createElement("input"); input.className = "text-answer"; input.type = numeric ? "number" : "text"; input.placeholder = numeric ? "Введите число" : "Введите ответ"; input.value = state.answers[task.id] || "";
  input.addEventListener("input", () => { state.answers[task.id] = input.value; persistAnswers(); }); container.append(input);
}
function renderOrder(container, task) {
  const list = document.createElement("div"); list.className = "order-list";
  const values = Array.isArray(state.answers[task.id]) ? state.answers[task.id] : (task.answer?.options || []).map((_, index) => String(index));
  const options = task.answer?.options || [];
  function redraw() { list.replaceChildren(); values.forEach((value, index) => {
    const row = document.createElement("div"); row.className = "order-row"; row.draggable = true; row.dataset.index = index;
    const grip = document.createElement("span"); grip.className = "grip"; grip.textContent = "↕";
    const body = document.createElement("span"); appendRich(body, options[Number(value)] || options.find((item) => String(item.id) === value) || value);
    const controls = document.createElement("span"); controls.className = "order-controls";
    [["↑", -1], ["↓", 1]].forEach(([caption, delta]) => { const button = document.createElement("button"); button.type = "button"; button.className = "tiny"; button.textContent = caption; button.disabled = index + delta < 0 || index + delta >= values.length; button.addEventListener("click", () => { [values[index], values[index + delta]] = [values[index + delta], values[index]]; state.answers[task.id] = values; persistAnswers(); redraw(); }); controls.append(button); });
    row.addEventListener("dragstart", () => { state.dragId = index; }); row.addEventListener("dragover", (event) => event.preventDefault()); row.addEventListener("drop", (event) => { event.preventDefault(); const from = state.dragId; if (from == null || from === index) return; const [item] = values.splice(from, 1); values.splice(index, 0, item); state.answers[task.id] = values; persistAnswers(); redraw(); state.dragId = null; });
    row.append(grip, body, controls); list.append(row);
  }); }
  redraw(); container.append(list);
}
function renderMatch(container, task) {
  const answer = task.answer || {}; const sources = answer.mix_source || answer.sources || [];
  const targets = answer.mix_target || answer.targets || [];
  const options = answer.options || [];
  const left = sources.length ? sources : options.slice(0, Math.ceil(options.length / 2));
  const right = targets.length ? targets : options.slice(Math.ceil(options.length / 2));
  const values = state.answers[task.id] || {};
  const table = document.createElement("div"); table.className = "match-list";
  left.forEach((source, index) => { const row = document.createElement("label"); row.className = "match-row"; const sourceNode = document.createElement("span"); appendRich(sourceNode, source); const select = document.createElement("select"); select.innerHTML = `<option value="">Выберите соответствие…</option>`; right.forEach((target, targetIndex) => { const option = document.createElement("option"); option.value = String(target.id ?? targetIndex); option.textContent = optionLabel(target); select.append(option); }); select.value = values[String(source.id ?? index)] || ""; select.addEventListener("change", () => { values[String(source.id ?? index)] = select.value; state.answers[task.id] = values; persistAnswers(); }); row.append(sourceNode, select); table.append(row); });
  container.append(table);
}
function renderGroups(container, task) {
  const answer = task.answer || {};
  const all = answer.options || [];
  const explicitGroups = all.filter((item) => String(item?.type || "").includes("group"));
  const groups = answer.groups || answer.targets || explicitGroups;
  const options = explicitGroups.length ? all.filter((item) => !String(item?.type || "").includes("group")) : all;
  if (!groups.length) { renderSimpleOptions(container, task, true); return; }
  const values = state.answers[task.id] || {};
  const list = document.createElement("div"); list.className = "group-rows";
  options.forEach((option, index) => {
    const row = document.createElement("label"); row.className = "group-row";
    const statement = document.createElement("span"); statement.textContent = optionLabel(option);
    const select = document.createElement("select"); select.innerHTML = `<option value="">Выберите группу…</option>`;
    groups.forEach((group, groupIndex) => { const item = document.createElement("option"); item.value = String(group.id ?? groupIndex); item.textContent = optionLabel(group); select.append(item); });
    select.value = values[String(option.id ?? index)] || "";
    select.addEventListener("change", () => { values[String(option.id ?? index)] = select.value; state.answers[task.id] = values; persistAnswers(); });
    row.append(statement, select); list.append(row);
  });
  container.append(list);
}
function renderTableAnswer(container, task) {
  const answer = task.answer || {}; const options = (answer.options || []).slice(); const tableOption = options.find((item) => item.content?.some?.((content) => content.type === "content/table"));
  if (tableOption) options.splice(options.indexOf(tableOption), 1);
  if (tableOption) { const content = tableOption.content.find((item) => item.type === "content/table"); container.append(renderTableValue(content.table)); }
  if (options.length) renderSimpleOptions(container, { ...task, answer: { ...answer, options } }, false);
}
function renderGap(container, task) {
  const answer = task.answer || {}; const options = answer.options || []; const element = (task.question_elements || []).find((item) => typeof item?.text === "string" && item.text.length > 100) || task.question_elements?.[0];
  const source = element?.text || ""; const positions = [...(answer.text_position || [])].map((item, index) => ({ ...item, index })).sort((a, b) => a.position - b.position);
  const body = document.createElement("div"); body.className = "gap-text"; let cursor = 0;
  positions.forEach((position) => { body.append(textNode(source.slice(cursor, position.position))); const select = document.createElement("select"); select.className = "gap-slot"; select.dataset.slot = position.index; select.innerHTML = `<option value="">выберите</option>`; options.forEach((option, optionIndex) => { const item = document.createElement("option"); item.value = String(option.id ?? optionIndex); item.textContent = optionLabel(option); select.append(item); }); const current = state.answers[task.id]?.[position.index]; if (current) select.value = current; select.addEventListener("change", () => { const values = state.answers[task.id] || {}; values[position.index] = select.value; state.answers[task.id] = values; persistAnswers(); }); body.append(select); cursor = position.position; });
  body.append(textNode(source.slice(cursor))); container.append(body);
  const bank = document.createElement("div"); bank.className = "option-bank"; options.forEach((option, index) => { const chip = document.createElement("span"); chip.className = "chip"; chip.textContent = optionLabel(option); chip.title = "Выберите этот вариант в поле выше"; chip.draggable = true; chip.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", String(option.id ?? index)); }); bank.append(chip); }); container.append(bank);
}
function renderAnswer(container, task) {
  const type = task.answer?.type || "unknown"; const help = document.createElement("p"); help.className = "instruction"; help.textContent = TYPE_HELP[type] || "Заполните ответ в соответствии с условием задания."; container.append(help);
  if (type === "answer/single") renderSimpleOptions(container, task, false);
  else if (type === "answer/multiple") renderSimpleOptions(container, task, true);
  else if (type === "answer/free" || type === "answer/string") renderTextInput(container, task, false);
  else if (type === "answer/number") renderTextInput(container, task, true);
  else if (type === "answer/order") renderOrder(container, task);
  else if (type === "answer/match") renderMatch(container, task);
  else if (type === "answer/groups") renderGroups(container, task);
  else if (type === "answer/table") renderTableAnswer(container, task);
  else if (type === "answer/gap/match/text") renderGap(container, task);
  else { const note = document.createElement("p"); note.className = "unsupported"; note.textContent = `Тип ${type} пока отображается в режиме просмотра.`; container.append(note); renderSimpleOptions(container, task, false); }
}
function buildSubmitPayload(task) {
  const type = task.answer?.type;
  const value = state.answers[task.id];
  if (type === "answer/single") return value ? { "@answer_type": type, id: value } : null;
  if (type === "answer/free" || type === "answer/string") return value != null && String(value).trim() ? { "@answer_type": type, string: String(value) } : null;
  if (type === "answer/number") return value != null && String(value).trim() ? { "@answer_type": type, number: Number(value) } : null;
  return null;
}
async function submitTask(task, button, status) {
  const answer = buildSubmitPayload(task);
  if (!answer) { status.textContent = "Для этого типа ответа отправка пока не подключена или поле пустое."; return; }
  button.disabled = true; status.textContent = "Отправляю…";
  const result = await api.runtime.sendMessage({ type: "SUBMIT_EXAM_ANSWER", payload: { challenge_task_id: task.id, challenge_attempt_id: state.snapshot.response.challenge_attempt_id, answer } });
  button.disabled = false;
  status.textContent = result?.ok ? `Отправлено (${result.status})` : `Ошибка: ${result?.error || `HTTP ${result?.status || "неизвестно"}`}`;
  status.className = `submit-status ${result?.ok ? "success" : "error"}`;
}
function renderTask(task, index) {
  const card = document.createElement("article"); card.className = "question"; card.id = `task-${task.id}`;
  const head = document.createElement("div"); head.className = "question-head"; const title = document.createElement("h2"); title.textContent = `Задание ${index + 1}`; const type = document.createElement("span"); type.className = "type-pill"; type.textContent = task.answer?.type || "неизвестный тип"; head.append(title, type); card.append(head);
  const question = document.createElement("div"); renderQuestion(question, task.question_elements); card.append(question);
  const answer = document.createElement("section"); answer.className = "answer-area"; renderAnswer(answer, task);
  const footer = document.createElement("div"); footer.className = "submit-footer"; const button = document.createElement("button"); button.type = "button"; button.className = "primary submit-answer"; button.textContent = "Отправить ответ"; const status = document.createElement("span"); status.className = "submit-status"; button.addEventListener("click", () => submitTask(task, button, status).catch((error) => { button.disabled = false; status.className = "submit-status error"; status.textContent = String(error?.message || error); })); footer.append(button, status); answer.append(footer); card.append(answer);
  return card;
}
function getTasks(snapshot) { return (snapshot?.response?.challenge_test_groups || []).flatMap((group) => group.challenge_tasks || []).filter((task) => task && typeof task === "object").sort((a, b) => (a.task_order ?? 0) - (b.task_order ?? 0)); }
function persistAnswers() { if (!state.snapshot?.response?.challenge_attempt_id) return; const all = JSON.parse(localStorage.getItem(ANSWERS_KEY) || "{}"); all[state.snapshot.response.challenge_attempt_id] = state.answers; localStorage.setItem(ANSWERS_KEY, JSON.stringify(all)); }
function restoreAnswers() { const id = state.snapshot?.response?.challenge_attempt_id; if (!id) return {}; const all = JSON.parse(localStorage.getItem(ANSWERS_KEY) || "{}"); return all[id] || {}; }
function withoutAnswerKeys(value) {
  if (Array.isArray(value)) return value.map(withoutAnswerKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["right_answer", "reference_right_answer", "user_answer"].includes(key)).map(([key, item]) => [key, withoutAnswerKeys(item)]));
  return value;
}
function exportPayload() {
  const response = state.snapshot?.response || {};
  const tasks = getTasks(state.snapshot).map((task) => ({ id: task.id, order: task.task_order ?? 0, type: task.answer?.type || "unknown", question_elements: withoutAnswerKeys(task.question_elements || []), answer: withoutAnswerKeys(task.answer || {}) }));
  return { schema: "mesh-tasks/test-export", version: 1, exported_at: new Date().toISOString(), source: { url: state.snapshot?.url || "", challenge_id: String(state.snapshot?.url || "").match(/challenge\/(\d+)/)?.[1] || null, attempt_id: response.challenge_attempt_id ?? null }, tasks, answers: state.answers || {} };
}
function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importAnswers(file) {
  const data = JSON.parse(await file.text());
  if (!data || typeof data !== "object") throw new Error("JSON должен быть объектом.");
  if (data.schema && data.schema !== "mesh-tasks/test-export") throw new Error("Неизвестная схема JSON.");
  const expected = String(state.snapshot?.response?.challenge_attempt_id ?? ""); const importedAttempt = String(data.source?.attempt_id ?? data.attempt_id ?? expected);
  if (importedAttempt && expected && importedAttempt !== expected) throw new Error(`Ответы относятся к попытке ${importedAttempt}, а открыта попытка ${expected}.`);
  const imported = data.answers && typeof data.answers === "object" ? data.answers : data;
  const known = new Set(getTasks(state.snapshot).map((task) => String(task.id)));
  const next = {};
  for (const [taskId, answer] of Object.entries(imported)) { if (!known.has(String(taskId))) continue; next[taskId] = answer; }
  if (!Object.keys(next).length) throw new Error("В JSON не найдено ответов для заданий текущей попытки.");
  state.answers = next; persistAnswers(); await load();
}
async function load() {
  const result = await api.runtime.sendMessage({ type: "GET_LATEST_EXAM" }); state.snapshot = result?.exam; state.answers = restoreAnswers();
  const notice = document.querySelector("#notice"); const container = document.querySelector("#questions"); container.replaceChildren(); notice.hidden = true;
  if (!state.snapshot?.response) { notice.hidden = false; notice.textContent = "Snapshot ещё не найден. Открой тест, начни попытку и дождись start-attempt."; return; }
  const groups = state.snapshot.response.challenge_test_groups || []; const tasks = getTasks(state.snapshot);
  document.querySelector("#meta").textContent = `Попытка ${state.snapshot.response.challenge_attempt_id ?? "—"} · ${new Date(state.snapshot.capturedAt).toLocaleString("ru-RU")}`;
  document.querySelector("#summary").textContent = `Групп: ${groups.length}. Заданий: ${tasks.length}. Ответы сохраняются локально в этом браузере.`;
  tasks.forEach((task, index) => container.append(renderTask(task, index)));
}
document.querySelector("#refresh").addEventListener("click", () => load());
document.querySelector("#debug").addEventListener("click", () => api.runtime.sendMessage({ type: "OPEN_DEBUG" }));
document.querySelector("#print").addEventListener("click", () => window.print());
document.querySelector("#finish").addEventListener("click", async () => {
  const challengeId = String(state.snapshot?.url || "").match(/challenge\/(\d+)/)?.[1];
  if (!challengeId) { alert("Не найден ID теста. Открой попытку заново."); return; }
  if (!window.confirm("Ответы уже отправлены? После подтверждения попытка будет завершена официально.")) return;
  const button = document.querySelector("#finish"); button.disabled = true; button.textContent = "Завершаю…";
  const result = await api.runtime.sendMessage({ type: "COMPLETE_EXAM_ATTEMPT", payload: { challenge_id: challengeId } });
  button.disabled = false; button.textContent = result?.ok ? "Тестирование завершено" : "Подтвердить и завершить тестирование";
  if (!result?.ok) alert(`Не удалось завершить тест: ${result?.error || `HTTP ${result?.status || "неизвестно"}`}`);
});
document.querySelector("#copy").addEventListener("click", async () => { const text = [...document.querySelectorAll(".question")].map((node) => node.innerText).join("\n\n"); await navigator.clipboard.writeText(text); document.querySelector("#copy").textContent = "Скопировано"; setTimeout(() => { document.querySelector("#copy").textContent = "Копировать текст"; }, 1500); });
document.querySelector("#export").addEventListener("click", () => { if (!state.snapshot?.response) return alert("Сначала открой тест и начни попытку."); const challenge = String(state.snapshot.url || "").match(/challenge\/(\d+)/)?.[1] || "test"; downloadJson(`mesh-test-${challenge}.json`, exportPayload()); });
document.querySelector("#import").addEventListener("click", () => document.querySelector("#import-file").click());
document.querySelector("#import-file").addEventListener("change", async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { await importAnswers(file); alert("Ответы импортированы и сохранены локально."); } catch (error) { alert(`Не удалось импортировать ответы: ${error?.message || error}`); } });
load().then(() => {
  if (new URLSearchParams(location.search).get("print") === "1") setTimeout(() => window.print(), 350);
}).catch((error) => { const notice = document.querySelector("#notice"); notice.hidden = false; notice.textContent = String(error?.message || error); });
