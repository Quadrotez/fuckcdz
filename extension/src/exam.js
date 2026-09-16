const api = globalThis.browser ?? globalThis.chrome;
const ANSWERS_KEY = "examAnswers";
const state = { snapshot: null, answers: {}, dragId: null, importController: null };

const TYPE_HELP = {
  "answer/single": "Выберите один вариант ответа.",
  "answer/multiple": "Выберите все подходящие варианты ответа.",
  "answer/free": "Введите ответ текстом. Если нужно, используйте несколько строк.",
  "answer/string": "Введите текстовый ответ в поле.",
  "answer/string/multiple": "Введите один или несколько текстовых ответов. Добавьте отдельное поле для каждого ответа.",
  "answer/number": "Введите числовой ответ.",
  "answer/order": "Расположите шаги решения в правильной последовательности: от исходного условия к итоговому ответу.",
  "answer/match": "Сопоставьте элементы левой и правой части. Для каждого элемента выберите соответствующую пару.",
  "answer/groups": "Распределите варианты по подходящим группам.",
  "answer/table": "Заполните ячейки таблицы или выберите подходящие значения.",
  "answer/gap/match/text": "Перетащите варианты в поля пропусков. В каждом поле должно оказаться подходящее слово или число.",
  "answer/gap/text/input": "Введите ответы в текстовые поля внутри условия. Заполняйте поля по порядку слева направо."
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
  const source = String(latex);
  if (/\\(?:sqrt|frac)|\^\{|_\{/.test(source)) appendTeXMarkup(span, source);
  else appendMathMarkup(span, normalizeMath(source));
  return span;
}
function readTeXGroup(source, start) {
  if (source[start] !== "{") return null;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") { depth -= 1; if (!depth) return { value: source.slice(start + 1, index), end: index + 1 }; }
  }
  return null;
}
function appendTeXMarkup(parent, source) {
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("\\sqrt", index)) {
      index += 5; let degree = "";
      if (source[index] === "[") { const end = source.indexOf("]", index + 1); if (end >= 0) { degree = source.slice(index + 1, end); index = end + 1; } }
      const group = readTeXGroup(source, index);
      if (group) {
        const root = document.createElement("span"); root.className = "math-root";
        if (degree) { const degreeNode = document.createElement("sup"); degreeNode.className = "root-degree"; appendTeXMarkup(degreeNode, degree); root.append(degreeNode); }
        const symbol = document.createElement("span"); symbol.className = "root-symbol"; symbol.textContent = "√";
        const body = document.createElement("span"); body.className = "root-body"; appendTeXMarkup(body, group.value); root.append(symbol, body); parent.append(root); index = group.end; continue;
      }
      parent.append(textNode("√")); continue;
    }
    if (source.startsWith("\\frac", index)) {
      const numerator = readTeXGroup(source, index + 5); const denominator = numerator && readTeXGroup(source, numerator.end);
      if (numerator && denominator) { const fraction = document.createElement("span"); fraction.className = "math-fraction"; const top = document.createElement("span"); top.className = "fraction-top"; const bottom = document.createElement("span"); bottom.className = "fraction-bottom"; appendTeXMarkup(top, numerator.value); appendTeXMarkup(bottom, denominator.value); fraction.append(top, bottom); parent.append(fraction); index = denominator.end; continue; }
    }
    if (source[index] === "^" || source[index] === "_") {
      const node = document.createElement(source[index] === "^" ? "sup" : "sub"); const group = readTeXGroup(source, index + 1);
      if (group) { appendTeXMarkup(node, group.value); parent.append(node); index = group.end; continue; }
    }
    const command = source.slice(index).match(/^\\(cdot|times|neq|leq|geq|pm|infty|alpha|beta|gamma|delta|lambda|mu|pi|sigma|omega|left|right)(?:\b|$)/i);
    if (command) { appendTextWithMath(parent, normalizeMath(command[0])); index += command[0].length; continue; }
    parent.append(textNode(source[index])); index += 1;
  }
}
function appendMathMarkup(parent, value) {
  const source = String(value);
  const pattern = /(\^|_)(?:\(([^()]*)\)|([^\s,.;!?+={}\[\]()]+))/g;
  let cursor = 0; let match;
  while ((match = pattern.exec(source))) {
    if (match.index > cursor) parent.append(textNode(source.slice(cursor, match.index)));
    const mark = document.createElement(match[1] === "^" ? "sup" : "sub"); mark.textContent = match[2] ?? match[3]; parent.append(mark); cursor = pattern.lastIndex;
  }
  if (cursor < source.length) parent.append(textNode(source.slice(cursor)));
}
function appendPositionedContent(parent, text, content) {
  const items = content.filter((item) => isObject(item) && Number.isFinite(Number(item.position))).sort((a, b) => Number(a.position) - Number(b.position));
  let cursor = 0;
  items.forEach((item) => { const rawPosition = Number(item.position); const source = String(text); const position = Math.max(cursor, Math.min(source.length, rawPosition)); if (position > cursor) parent.append(textNode(source.slice(cursor, position))); if (rawPosition > source.length && cursor === source.length && source && !/\s$/.test(source)) parent.append(textNode(" ")); appendRich(parent, item); cursor = position; });
  if (cursor < String(text).length) parent.append(textNode(String(text).slice(cursor)));
}
function appendTextWithMath(parent, value) {
  const text = String(value ?? "");
  if (/\\(?:sqrt|frac|cdot|times|neq|leq|geq|pm|infty|left|right|[a-z]+)|\bsqrt(?:\[|\{|\d)/i.test(text)) {
    const hasMathCommand = /\\(?:sqrt|frac|cdot|times|neq|leq|geq|pm|infty)|\bsqrt(?:\[|\{|\d)/i.test(text);
    if (hasMathCommand && !/[.!?]\s+[А-ЯЁA-Z]/.test(text)) { parent.append(mathElement(text)); return; }
  }
  const pattern = /(\\\(|\\\[|\$\$?|\\begin\{math\})([\s\S]*?)(?:\\\)|\\\]|\$\$?|\\end\{math\})/g;
  let cursor = 0; let match;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) parent.append(textNode(text.slice(cursor, match.index)));
    parent.append(mathElement(match[2], match[1] === "\\[" || match[1] === "$$")); cursor = pattern.lastIndex;
  }
  if (cursor < text.length) parent.append(textNode(text.slice(cursor)));
}
function normalizeMath(value) {
  return value
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/\\text\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\sqrt\s*\[([^\]]+)\]\s*\{([^{}]*)\}/g, "($2)^(1/$1)")
    .replace(/\\sqrt\s*\[([^\]]+)\]\s*([^\s,.;!?+={}\[\]()]+)/g, "($2)^(1/$1)")
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
    .replace(/\\sqrt\s*([^\s,.;!?+={}\[\]()]+)/g, "√($1)")
    .replace(/(^|[^\\])\bsqrt\s*\[([^\]]+)\]\s*([^\s,.;!?+={}\[\]()]+)/gi, "$1($3)^(1/$2)")
    .replace(/(^|[^\\])\bsqrt\s*\{([^{}]*)\}/gi, "$1√($2)")
    .replace(/\^\{([^{}]+)\}/g, "^($1)")
    .replace(/_\{([^{}]+)\}/g, "_($1)")
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

function mathSource(value) {
  if (!isObject(value)) return null;
  const type = String(value.type || value.atomic_type || value.kind || "").toLowerCase();
  const source = value.latex ?? value.LaTeX ?? value.tex ?? value.formula ?? value.expression ?? value.math ?? value.mathml;
  if (source != null && (/(latex|tex|math|formula|equation)/i.test(type) || typeof source === "string")) return source;
  if (/(latex|tex|math|formula|equation)/i.test(type)) return value.content ?? value.text ?? value.value ?? null;
  return null;
}

function appendRich(parent, value) {
  if (value == null) return;
  if (Array.isArray(value)) { value.forEach((item) => appendRich(parent, item)); return; }
  if (typeof value === "string" || typeof value === "number") { appendTextWithMath(parent, value); return; }
  if (!isObject(value)) return;
  const formula = mathSource(value);
  if (formula != null) { parent.append(mathElement(Array.isArray(formula) ? formula.map(contentToPlain).join("") : formula, Boolean(value.display || value.displayMode))); return; }
  const type = String(value.type || "");
  if (type.includes("table")) { parent.append(renderTableValue(value.table)); return; }
  if (value.text && Array.isArray(value.content) && value.content.some((item) => isObject(item) && Number.isFinite(Number(item.position)))) appendPositionedContent(parent, value.text, value.content);
  else {
    if (value.text) appendTextWithMath(parent, value.text);
    if (value.content != null) appendRich(parent, value.content);
  }
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
function appendOptionContent(parent, option) {
  if (!isObject(option)) { appendRich(parent, option); return; }
  const hasPositions = Array.isArray(option.content) && option.content.some((item) => isObject(item) && Number.isFinite(Number(item.position)));
  if (option.text && hasPositions) {
    appendPositionedContent(parent, option.text, option.content);
    for (const content of option.content) { const media = renderMedia(content); if (media) parent.append(media); }
    return;
  }
  if (option.text) appendTextWithMath(parent, option.text);
  for (const content of Array.isArray(option.content) ? option.content : []) {
    const media = renderMedia(content);
    if (media) parent.append(media); else appendRich(parent, content);
  }
}
function renderQuestion(parent, elements) {
  const wrapper = document.createElement("div"); wrapper.className = "question-content";
  for (const element of Array.isArray(elements) ? elements : []) {
    if (!isObject(element)) continue;
    const media = renderMedia(element); if (media) { wrapper.append(media); continue; }
    const block = document.createElement("div"); block.className = "content-block";
    const content = Array.isArray(element.content) ? element.content : [];
    const positioned = content.some((item) => isObject(item) && Number.isFinite(Number(item.position)));
    if (element.text) { if (positioned) appendPositionedContent(block, element.text, content); else appendTextWithMath(block, element.text); }
    if (!positioned) content.forEach((item) => { const contentMedia = renderMedia(item); if (contentMedia) block.append(contentMedia); else appendRich(block, item); });
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
  const body = document.createElement("span"); if (labelPrefix) { const prefix = document.createElement("b"); prefix.textContent = labelPrefix; body.append(prefix, textNode(" ")); } appendOptionContent(body, option);
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
function renderMultipleStringInputs(container, task) {
  const list = document.createElement("div"); list.className = "string-multiple-list";
  const values = Array.isArray(state.answers[task.id]) ? [...state.answers[task.id]] : [""];
  function redraw() {
    list.replaceChildren();
    values.forEach((value, index) => {
      const row = document.createElement("div"); row.className = "string-multiple-row";
      const input = document.createElement("input"); input.className = "text-answer"; input.type = "text"; input.placeholder = `Ответ ${index + 1}`; input.value = value || "";
      input.addEventListener("input", () => { values[index] = input.value; state.answers[task.id] = values; persistAnswers(); });
      row.append(input);
      if (values.length > 1) { const remove = document.createElement("button"); remove.type = "button"; remove.className = "tiny"; remove.textContent = "Удалить"; remove.addEventListener("click", () => { values.splice(index, 1); if (!values.length) values.push(""); state.answers[task.id] = values; persistAnswers(); redraw(); }); row.append(remove); }
      list.append(row);
    });
  }
  const add = document.createElement("button"); add.type = "button"; add.className = "tiny add-string-answer"; add.textContent = "Добавить ответ"; add.addEventListener("click", () => { values.push(""); state.answers[task.id] = values; persistAnswers(); redraw(); });
  redraw(); container.append(list, add);
}
function createRichSelect(options, selectedValue, placeholder, onChange) {
  const root = document.createElement("div"); root.className = "rich-select";
  const trigger = document.createElement("button"); trigger.type = "button"; trigger.className = "rich-select-trigger"; trigger.setAttribute("aria-haspopup", "listbox"); trigger.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div"); menu.className = "rich-select-menu"; menu.setAttribute("role", "listbox"); menu.hidden = true;
  let current = String(selectedValue || "");
  function setOpen(open) { menu.hidden = !open; trigger.setAttribute("aria-expanded", String(open)); root.classList.toggle("open", open); }
  function renderTrigger() {
    trigger.replaceChildren();
    const selected = options.find((item) => String(item.value) === current);
    if (selected) appendOptionContent(trigger, selected.option);
    else { const text = document.createElement("span"); text.className = "rich-select-placeholder"; text.textContent = placeholder; trigger.append(text); }
  }
  options.forEach((item) => {
    const option = document.createElement("button"); option.type = "button"; option.className = "rich-select-option"; option.setAttribute("role", "option"); option.dataset.value = String(item.value);
    option.setAttribute("aria-selected", String(String(item.value) === current)); appendOptionContent(option, item.option);
    option.addEventListener("click", () => { current = String(item.value); renderTrigger(); menu.querySelectorAll(".rich-select-option").forEach((node) => node.setAttribute("aria-selected", String(node.dataset.value === current))); setOpen(false); onChange(current); });
    menu.append(option);
  });
  trigger.addEventListener("click", () => setOpen(menu.hidden));
  trigger.addEventListener("keydown", (event) => { if (["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); setOpen(true); menu.querySelector(".rich-select-option")?.focus(); } });
  document.addEventListener("click", (event) => { if (!root.contains(event.target)) setOpen(false); });
  renderTrigger(); root.append(trigger, menu); return root;
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
  const answer = task.answer || {}; const sides = matchSides(answer); const left = sides.sources; const right = sides.targets;
  const values = state.answers[task.id] || {};
  const table = document.createElement("div"); table.className = "match-list";
  left.forEach((source, index) => { const row = document.createElement("div"); row.className = "match-row"; const sourceNode = document.createElement("span"); appendOptionContent(sourceNode, source); const picker = createRichSelect(right.map((target, targetIndex) => ({ value: String(target.id ?? targetIndex), option: target })), values[String(source.id ?? index)], "Выберите соответствие…", (value) => { values[String(source.id ?? index)] = value; state.answers[task.id] = values; persistAnswers(); }); row.append(sourceNode, picker); table.append(row); });
  container.append(table);
  const printOptions = document.createElement("div"); printOptions.className = "print-answer-options";
  printOptions.textContent = `Варианты соответствия: ${right.map((item, index) => `${index + 1}. ${optionLabel(item)}`).join("; ")}`;
  container.append(printOptions);
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
    const row = document.createElement("div"); row.className = "group-row";
    const statement = document.createElement("span"); statement.textContent = optionLabel(option);
    const picker = createRichSelect(groups.map((group, groupIndex) => ({ value: String(group.id ?? groupIndex), option: group })), values[String(option.id ?? index)], "Выберите группу…", (value) => { values[String(option.id ?? index)] = value; state.answers[task.id] = values; persistAnswers(); });
    row.append(statement, picker); list.append(row);
  });
  container.append(list);
  const printOptions = document.createElement("div"); printOptions.className = "print-answer-options";
  printOptions.textContent = `Группы для выбора: ${groups.map((item, index) => `${index + 1}. ${optionLabel(item)}`).join("; ")}`;
  container.append(printOptions);
}
function renderTableAnswer(container, task) {
  const answer = task.answer || {}; const options = (answer.options || []).slice(); const tableOption = options.find((item) => item.content?.some?.((content) => content.type === "content/table"));
  if (tableOption) options.splice(options.indexOf(tableOption), 1);
  if (tableOption) { const content = tableOption.content.find((item) => item.type === "content/table"); container.append(renderTableValue(content.table)); }
  if (options.length) renderSimpleOptions(container, { ...task, answer: { ...answer, options } }, false);
}
function gapBankOptions(position) { return position?.options && position.options.length ? position.options : null; }
function renderGap(container, task) {
  const answer = task.answer || {}; const element = (task.question_elements || []).find((item) => typeof item?.text === "string" && item.text.length > 100) || task.question_elements?.[0]; const source = element?.text || ""; const positions = [...(answer.text_position || [])].map((item, index) => ({ ...item, index })).sort((a, b) => a.position - b.position); const body = document.createElement("div"); body.className = "gap-text"; let cursor = 0;
  positions.forEach((position) => { body.append(textNode(source.slice(cursor, position.position))); const select = document.createElement("select"); select.className = "gap-slot"; select.dataset.slot = position.index; select.innerHTML = `<option value="">выберите</option>`; const localOptions = gapBankOptions(position); const options = localOptions || answer.options || []; options.forEach((option, optionIndex) => { const item = document.createElement("option"); item.value = String(option.id ?? optionIndex); item.textContent = optionLabel(option); select.append(item); }); const current = state.answers[task.id]?.[position.index]; if (current) select.value = current; select.addEventListener("change", () => { const values = state.answers[task.id] || {}; values[position.index] = select.value; state.answers[task.id] = values; persistAnswers(); }); body.append(select); cursor = position.position; });
  body.append(textNode(source.slice(cursor))); container.append(body);
  const bankOptions = answer.options?.length ? answer.options : positions.flatMap((position) => position?.options || []);
  if (bankOptions.length) { const bank = document.createElement("div"); bank.className = "option-bank"; bankOptions.forEach((option, index) => { const chip = document.createElement("span"); chip.className = "chip"; chip.textContent = optionLabel(option); chip.title = "Выберите этот вариант в поле выше"; chip.draggable = true; chip.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/plain", String(option.id ?? index)); }); bank.append(chip); }); container.append(bank); }
}
function renderGapTextInput(container, task) {
  const answer = task.answer || {};
  const elements = Array.isArray(task.question_elements) ? task.question_elements : [];
  // У этого типа первое длинное поле — обычное условие, а пропуски принадлежат code/text element.
  const element = elements.find((item) => typeof item?.text === "string" && item.text.includes("\n") && item.type !== "content/text")
    || elements.find((item) => typeof item?.text === "string" && item.text.includes("\n"))
    || elements.find((item) => typeof item?.text === "string" && item.type !== "content/text")
    || elements.find((item) => typeof item?.text === "string");
  const source = element?.text || "";
  const positions = [...(answer.text_position || [])].map((item, index) => ({ ...item, index })).sort((a, b) => a.position - b.position);
  const values = state.answers[task.id] || {};
  const body = document.createElement("div"); body.className = "gap-text gap-code";
  let cursor = 0;
  positions.forEach((position) => {
    body.append(textNode(source.slice(cursor, position.position)));
    const input = document.createElement("input"); input.type = "text"; input.className = "gap-input"; input.placeholder = "введите ответ";
    // expected_length в API МЭШ не является ограничением длины поля для этого типа.
    input.value = values[position.index] || "";
    input.addEventListener("input", () => { const next = state.answers[task.id] || {}; next[position.index] = input.value; state.answers[task.id] = next; persistAnswers(); });
    body.append(input); cursor = position.position;
  });
  body.append(textNode(source.slice(cursor))); container.append(body);
  const note = document.createElement("p"); note.className = "muted"; note.textContent = `Полей для ввода: ${positions.length}. Ограничение длины: ${answer.text_input_rules === "nolimits" ? "нет" : "не задано API"}.`; container.append(note);
}
function detectGapMatchType(task) {
  const answer = task.answer || {};
  if (task.answer?.type && /gap\/match/.test(String(task.answer.type))) return true;
  const positions = answer.text_position || [];
  return positions.length > 0 && positions.some((position) => Array.isArray(position?.options) && position.options.length > 0);
}
function renderAnswer(container, task) {
  const type = task.answer?.type || "unknown"; const help = document.createElement("p"); help.className = "instruction"; help.textContent = TYPE_HELP[type] || "Заполните ответ в соответствии с условием задания."; container.append(help);
  if (type === "answer/single") renderSimpleOptions(container, task, false);
  else if (type === "answer/multiple") renderSimpleOptions(container, task, true);
  else if (type === "answer/free" || type === "answer/string") renderTextInput(container, task, false);
  else if (type === "answer/string/multiple") renderMultipleStringInputs(container, task);
  else if (type === "answer/number") renderTextInput(container, task, true);
  else if (type === "answer/order") renderOrder(container, task);
  else if (type === "answer/match") renderMatch(container, task);
  else if (type === "answer/groups") renderGroups(container, task);
  else if (type === "answer/table") renderTableAnswer(container, task);
  else if (type === "answer/gap/text/input") renderGapTextInput(container, task);
  else if (type === "answer/gap/match/text" || detectGapMatchType(task)) renderGap(container, task);
  else { const note = document.createElement("p"); note.className = "unsupported"; note.textContent = `Тип ${type} пока отображается в режиме просмотра.`; container.append(note); renderSimpleOptions(container, task, false); }
}
function buildSubmitPayload(task) {
  const type = task.answer?.type;
  const value = state.answers[task.id];
  const asSetMap = (input) => Object.fromEntries(Object.entries(input || {}).map(([key, item]) => [String(key), Array.isArray(item) ? item.map(String) : [String(item)]]));
  if (type === "answer/single") return value ? { "@answer_type": type, id: value } : null;
  if (type === "answer/free" || type === "answer/string") return value != null && String(value).trim() ? { "@answer_type": type, string: String(value) } : null;
  if (type === "answer/string/multiple") { const answers = Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : []; return answers.length ? { "@answer_type": type, answers } : null; }
  if (type === "answer/number") return value != null && String(value).trim() ? { "@answer_type": type, number: Number(value) } : null;
  if (["answer/multiple", "answer/order"].includes(type)) return Array.isArray(value) && value.length ? { "@answer_type": type, ids: value } : null;
  if (type === "answer/match") return value && Object.keys(value).length ? { "@answer_type": type, match: asSetMap(value) } : null;
  if (type === "answer/groups") return value && Object.keys(value).length ? { "@answer_type": type, groups: asSetMap(value) } : null;
  if (type === "answer/gap/text" || type === "answer/gap/match/text" || type === "answer/gap/text/input") return value && Object.keys(value).length ? { "@answer_type": type, answers: value } : null;
  if (type === "answer/table") return value ? { "@answer_type": type, answer: value } : null;
  return null;
}
async function submitTask(task, button, status) {
  const answer = buildSubmitPayload(task);
  if (!answer) { status.textContent = "Для этого типа ответа отправка пока не подключена или поле пустое."; return { ok: false, error: "пустой или неподдерживаемый ответ" }; }
  button.disabled = true; status.textContent = "Отправляю…";
  const result = await api.runtime.sendMessage({ type: "SUBMIT_EXAM_ANSWER", payload: { challenge_task_id: task.id, challenge_attempt_id: state.snapshot.response.challenge_attempt_id, answer } });
  button.disabled = false;
  const trace = result?.traceId ? ` · trace ${String(result.traceId).split(":").at(-1)?.slice(0, 8)}` : "";
  status.textContent = result?.ok ? `Отправлено (${result.status})${trace}` : `Ошибка: ${result?.error || `HTTP ${result?.status || "неизвестно"}`}${trace}`;
  status.className = `submit-status ${result?.ok ? "success" : "error"}`;
  return result;
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
function normalizeAnswerText(value) {
  return String(value ?? "").replace(/```[a-zA-Z]*\n?|```/g, "").replace(/\s+/g, " ").trim().replace(/^\d+\.\s*/, "").toLowerCase();
}
function findOptionId(task, value) {
  const options = Array.isArray(task.answer?.options) ? task.answer.options : [];
  const raw = String(value?.id ?? value?.value ?? value ?? "").trim();
  if (options.some((option, index) => String(option.id ?? index) === raw)) return raw;
  const wanted = normalizeAnswerText(raw);
  const match = options.find((option) => normalizeAnswerText(optionLabel(option)) === wanted);
  return match ? String(match.id ?? options.indexOf(match)) : null;
}
function matchSides(answer) {
  const options = Array.isArray(answer?.options) ? answer.options : [];
  const sources = Array.isArray(answer?.mix_source) ? answer.mix_source : Array.isArray(answer?.sources) ? answer.sources : options.filter((item) => String(item?.type || "").includes("/source"));
  const targets = Array.isArray(answer?.mix_target) ? answer.mix_target : Array.isArray(answer?.targets) ? answer.targets : Array.isArray(answer?.groups) ? answer.groups : options.filter((item) => String(item?.type || "").includes("/target"));
  return { sources: sources.length ? sources : options, targets: targets.length ? targets : options };
}
function normalizeImportedAnswer(task, value) {
  const type = task.answer?.type;
  if (type === "answer/single") {
    const id = findOptionId(task, value);
    if (id == null) throw new Error(`не найден вариант для задания ${task.id}`);
    return id;
  }
  if (type === "answer/multiple" || type === "answer/order") {
    if (!Array.isArray(value)) throw new Error(`для задания ${task.id} нужен массив`);
    return value.map((item) => { const id = findOptionId(task, item); if (id == null) throw new Error(`не найден вариант для задания ${task.id}`); return id; });
  }
  if (type === "answer/number") return value === null || value === "" ? "" : String(value);
  if (type === "answer/string/multiple") {
    if (!Array.isArray(value)) throw new Error(`для задания ${task.id} нужен массив строк`);
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  if (["answer/free", "answer/string"].includes(type)) return String(value ?? "");
  if (type === "answer/match" || type === "answer/groups") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`для задания ${task.id} нужен объект соответствий`);
    const { sources, targets } = matchSides(task.answer || {});
    const resolve = (items, item) => {
      const raw = String(item?.id ?? item?.value ?? item ?? "").trim();
      const exact = items.find((candidate, index) => String(candidate?.id ?? index) === raw);
      if (exact) return String(exact.id ?? items.indexOf(exact));
      const wanted = normalizeAnswerText(raw);
      const found = items.find((candidate) => normalizeAnswerText(optionLabel(candidate)) === wanted);
      return found ? String(found.id ?? items.indexOf(found)) : raw;
    };
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [resolve(sources, key), (Array.isArray(item) ? item : [item]).map((target) => resolve(targets, target))]));
  }
  if (type === "answer/gap/text" || type === "answer/gap/match/text" || type === "answer/gap/text/input") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`для задания ${task.id} нужен объект полей`);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [String(key), typeof item === "object" && item !== null ? String(item.id ?? item.value ?? "") : String(item ?? "")]));
  }
  return value;
}
function parseImportedText(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const data = JSON.parse(cleaned);
  if (!data || typeof data !== "object") throw new Error("JSON должен быть объектом.");
  if (data.schema && data.schema !== "mesh-tasks/test-export") throw new Error("Неизвестная схема JSON.");
  const expected = String(state.snapshot?.response?.challenge_attempt_id ?? ""); const importedAttempt = String(data.source?.attempt_id ?? data.attempt_id ?? data.challenge_attempt_id ?? expected);
  if (importedAttempt && expected && importedAttempt !== expected) throw new Error(`Ответы относятся к попытке ${importedAttempt}, а открыта попытка ${expected}.`);
  const imported = data.answers && typeof data.answers === "object" ? data.answers : data;
  const tasks = getTasks(state.snapshot); const byId = new Map(tasks.map((task) => [String(task.id), task]));
  const next = {}; const unknown = []; const errors = [];
  for (const [taskId, answer] of Object.entries(imported)) {
    const task = byId.get(String(taskId)); if (!task) { unknown.push(taskId); continue; }
    try { next[String(taskId)] = normalizeImportedAnswer(task, answer); } catch (error) { errors.push(error.message); }
  }
  if (!Object.keys(next).length) throw new Error(`Не импортировано ни одного ответа. ${errors.join(" ") || "Проверь ID заданий и текущую попытку."}`);
  parseImportedText.lastReport = { imported: Object.keys(next).length, total: tasks.length, unknown, errors };
  return next;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function importSettings() { return api.storage.local.get("autoSolve").then((result) => Math.max(0, Math.min(60000, Number(result.autoSolve?.importIntervalMs ?? 1000)))); }
function openImportProgress(total) { const dialog = document.querySelector("#import-progress-dialog"); document.querySelector("#import-progress").max = total; document.querySelector("#import-progress").value = 0; document.querySelector("#import-progress-label").textContent = `Подготовка: 0 из ${total}`; dialog.showModal(); return dialog; }
async function applyImportedAnswers(next) {
  const tasks = getTasks(state.snapshot); const byId = new Map(tasks.map((task) => [String(task.id), task])); const entries = Object.entries(next); const dialog = openImportProgress(entries.length); const interval = await importSettings(); const controller = new AbortController(); const failures = []; state.importController = controller;
  try {
    for (let index = 0; index < entries.length; index += 1) {
      if (controller.signal.aborted) throw new DOMException("Импорт отменён", "AbortError");
      const [taskId, answer] = entries[index]; state.answers[taskId] = answer; persistAnswers();
      const task = byId.get(taskId); const button = document.querySelector(`#task-${CSS.escape(taskId)} .submit-answer`); const status = button?.parentElement?.querySelector(".submit-status");
      if (!task || !button || !status) failures.push(`${taskId}: элемент задания или кнопка отправки не найдены`);
      else { const result = await submitTask(task, button, status); if (!result?.ok) failures.push(`${taskId}: ${result?.error || `HTTP ${result?.status || "неизвестно"}`}`); }
      document.querySelector("#import-progress").value = index + 1; document.querySelector("#import-progress-label").textContent = `Обработано: ${index + 1} из ${entries.length}`;
      if (interval && index < entries.length - 1) await sleep(interval);
    }
    await load(); const report = parseImportedText.lastReport; alert(failures.length ? `Импорт завершён с ошибками: подтверждено ${entries.length - failures.length} из ${entries.length}.\n\n${failures.join("\n")}` : `Импорт и подтверждение завершены: ${report?.imported || entries.length} из ${report?.total || "?"}.`);
  } catch (error) { if (error.name === "AbortError") alert("Импорт отменён. Уже отправленные ответы сохранены."); else throw error; }
  finally { state.importController = null; if (dialog.open) dialog.close(); }
}
async function importAnswers(file) { await applyImportedAnswers(parseImportedText(await file.text())); }
async function importAnswersText(text) { await applyImportedAnswers(parseImportedText(text)); }
async function load() {
  const result = await api.runtime.sendMessage({ type: "GET_LATEST_EXAM" }); state.snapshot = result?.exam; state.answers = restoreAnswers();
  const notice = document.querySelector("#notice"); const container = document.querySelector("#questions"); container.replaceChildren(); notice.hidden = true;
  if (!state.snapshot?.response) { notice.hidden = false; notice.textContent = "Snapshot ещё не найден. Открой тест, начни попытку и дождись start-attempt."; return; }
  const groups = state.snapshot.response.challenge_test_groups || []; const tasks = getTasks(state.snapshot);
  document.querySelector("#meta").textContent = `Попытка ${state.snapshot.response.challenge_attempt_id ?? "—"} · ${new Date(state.snapshot.capturedAt).toLocaleString("ru-RU")}`;
  document.querySelector("#summary").textContent = `Групп: ${groups.length}. Заданий: ${tasks.length}. Ответы сохраняются локально в этом браузере.`;
  tasks.forEach((task, index) => container.append(renderTask(task, index)));
}
function buildAutoSolvePrompt() {
  const payload = exportPayload(); payload.answers = {};
  const blankAnswer = (type) => {
    if (type === "answer/multiple" || type === "answer/order" || type === "answer/string/multiple") return [];
    if (type === "answer/match" || type === "answer/groups" || type === "answer/gap/text/input") return {};
    if (type === "answer/number") return null;
    return "";
  };
  const answerTemplate = Object.fromEntries(payload.tasks.map((task) => [String(task.id), blankAnswer(task.type)]));
  return `Реши тест по данным ниже. Верни ровно один JSON-объект и ничего кроме него: {"answers": ${JSON.stringify(answerTemplate)}}. Сохрани точные ID заданий. Для answer/single укажи ID варианта; для answer/multiple и answer/order — массив ID; для answer/free и answer/string — строку; для answer/string/multiple — массив строк; для answer/number — число; для answer/match и answer/groups — объект ID-to-ID; для answer/gap/text/input — объект с индексами полей. Не добавляй объяснения, решения или дополнительные ключи.\n\nДанные теста:\n${JSON.stringify(payload, null, 2)}`;
}
function runAutoSolve() {
  if (!state.snapshot?.response) { alert("Сначала открой тест и начни попытку."); return; }
  const permissionPromise = api.permissions?.request ? api.permissions.request({ origins: ["http://*/*", "https://*/*"] }) : Promise.resolve(true);
  const status = document.querySelector("#auto-solve-status"); const button = document.querySelector("#auto-solve");
  button.disabled = true; status.textContent = "Проверяю разрешение endpoint…";
  (async () => {
  try {
    if (!(await permissionPromise)) throw new Error("Браузер не разрешил сетевой адрес endpoint.");
    const settingsResult = await api.storage.local.get("autoSolve");
    status.textContent = "Отправляю тест на выбранный endpoint…";
    const imageUrls = [...document.querySelectorAll(".question img")].map((image) => image.currentSrc || image.src).filter(Boolean);
    const result = await api.runtime.sendMessage({ type: "AUTO_SOLVE", prompt: buildAutoSolvePrompt(), imageUrls });
    if (!result?.ok) throw new Error(result?.error || "Не удалось получить ответ от endpoint.");
    const cleaned = String(result.content || "").trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
    const data = JSON.parse(cleaned); const imported = data.answers && typeof data.answers === "object" ? data.answers : data;
    const tasks = getTasks(state.snapshot); const byId = new Map(tasks.map((task) => [String(task.id), task])); const next = {}; const errors = [];
    for (const [taskId, answer] of Object.entries(imported || {})) { const task = byId.get(String(taskId)); if (!task) continue; try { next[taskId] = normalizeImportedAnswer(task, answer); } catch (error) { errors.push(error.message); } }
    if (!Object.keys(next).length) throw new Error("Endpoint не вернул ни одного подходящего ответа.");
    state.answers = { ...state.answers, ...next }; persistAnswers(); await load();
    status.textContent = `Подставлено ответов: ${Object.keys(next).length}${errors.length ? `. Пропущено: ${errors.length}.` : ". Проверьте ответы перед отправкой."}`;
  } catch (error) { status.textContent = `Авторешение не выполнено: ${error?.message || error}`; }
  finally { button.disabled = false; }
  })();
}

document.querySelector("#refresh").addEventListener("click", async () => {
  const button = document.querySelector("#refresh"); button.disabled = true; button.textContent = "Обновляю…";
  try {
    const result = await api.runtime.sendMessage({ type: "REFRESH_LATEST_EXAM" });
    if (result?.error) throw new Error(result.error);
    await load();
  } catch (error) { const notice = document.querySelector("#notice"); notice.hidden = false; notice.textContent = `Не удалось обновить snapshot: ${error.message}`; }
  finally { button.disabled = false; button.textContent = "Обновить snapshot"; }
});
document.querySelector("#auto-solve").addEventListener("click", () => runAutoSolve());
document.querySelector("#debug").addEventListener("click", () => api.runtime.sendMessage({ type: "OPEN_DEBUG" }));
document.querySelector("#print").addEventListener("click", () => window.print());
document.querySelector("#finish").addEventListener("click", async () => {
  const challengeId = String(state.snapshot?.url || "").match(/challenge\/(\d+)/)?.[1];
  if (!challengeId) { alert("Не найден ID теста. Открой попытку заново."); return; }
  if (!window.confirm("Ответы уже отправлены? После подтверждения попытка будет завершена официально.")) return;
  const button = document.querySelector("#finish"); button.disabled = true; button.textContent = "Завершаю…";
  const result = await api.runtime.sendMessage({ type: "COMPLETE_EXAM_ATTEMPT", payload: { challenge_id: challengeId } });
  button.disabled = false; button.textContent = result?.ok ? "Тестирование завершено" : "Подтвердить и завершить тестирование";
  if (result?.ok) {
    let latest = await api.runtime.sendMessage({ type: "GET_LATEST_EXAM" });
    let assignmentUrl = String(latest?.exam?.assignmentUrl || state.snapshot?.assignmentUrl || state.snapshot?.response?.assignment?.url || "").replace(/\/$/, "");
    if (!assignmentUrl) { await sleep(750); latest = await api.runtime.sendMessage({ type: "GET_LATEST_EXAM" }); assignmentUrl = String(latest?.exam?.assignmentUrl || "").replace(/\/$/, ""); }
    const results = document.querySelector("#results");
    if (assignmentUrl) { results.href = assignmentUrl; results.hidden = false; results.textContent = "Перейти к результатам"; }
    else alert("Тест завершён, но URL контекста результатов ещё не найден. Открой страницу МЭШ с результатами из истории попыток.");
  }
  else alert(`Не удалось завершить тест: ${result?.error || `HTTP ${result?.status || "неизвестно"}`}`);
});
document.querySelector("#copy").addEventListener("click", async () => { const text = [...document.querySelectorAll(".question")].map((node) => node.innerText).join("\n\n"); await navigator.clipboard.writeText(text); document.querySelector("#copy").textContent = "Скопировано"; setTimeout(() => { document.querySelector("#copy").textContent = "Копировать текст"; }, 1500); });
document.querySelector("#export").addEventListener("click", () => { if (!state.snapshot?.response) return alert("Сначала открой тест и начни попытку."); const challenge = String(state.snapshot.url || "").match(/challenge\/(\d+)/)?.[1] || "test"; downloadJson(`mesh-test-${challenge}.json`, exportPayload()); });
document.querySelector("#prompt").addEventListener("click", () => { if (!state.snapshot?.response) return alert("Сначала открой тест и начни попытку."); const payload = exportPayload(); payload.answers = {}; const blankAnswer = (type) => { if (type === "answer/multiple" || type === "answer/order" || type === "answer/string/multiple") return []; if (type === "answer/match" || type === "answer/groups" || type === "answer/gap/text/input") return {}; if (type === "answer/number") return null; return ""; }; const answerTemplate = Object.fromEntries(payload.tasks.map((task) => [String(task.id), blankAnswer(task.answer?.type)])); const instructions = `Ты решаешь тест по данным ниже. Твоя задача — вернуть ответы для последующего импорта в расширение FuckCDZ. Ответ должен содержать РОВНО один JSON-объект и ничего больше: без Markdown, тройных кавычек, пояснений, приветствия, правильных решений вне JSON и дополнительных ключей.\n\nСтрогий формат:\n{\n  "answers": ${JSON.stringify(answerTemplate, null, 2)}\n}\n\nИспользуй этот шаблон как обязательную структуру: сохрани каждый ключ-ID без изменений и замени только значения. Ключи answers должны быть только точными ID заданий из входного JSON; нельзя менять, сокращать или нумеровать эти ID. Для answer/single укажи строковый ID выбранного варианта, а не номер варианта и не текст объяснения. Для answer/multiple укажи массив строковых ID вариантов. Для answer/free и answer/string укажи одну строку. Для answer/string/multiple укажи массив строковых ответов. Для answer/number укажи число. Для answer/order укажи массив строковых ID в правильном порядке. Для answer/match и answer/groups укажи объект, где ключи и значения — строковые ID элементов из задания. Для answer/gap/text/input укажи объект с индексами полей (например, {"0":"ответ", "1":"ответ"}). Если ответ невозможно определить, оставь значение пустым согласно типу. Не добавляй ключи right_answer, explanation, solution, confidence, tasks или другие поля. Перед отправкой проверь, что результат является валидным JSON и начинается с {, а не с текста.`; document.querySelector("#prompt-text").value = `${instructions}\n\nДанные теста:\n${JSON.stringify(payload, null, 2)}`; document.querySelector("#prompt-dialog").showModal(); });
document.querySelector("#copy-prompt").addEventListener("click", async () => { await navigator.clipboard.writeText(document.querySelector("#prompt-text").value); document.querySelector("#copy-prompt").textContent = "Скопировано"; setTimeout(() => { document.querySelector("#copy-prompt").textContent = "Копировать промпт"; }, 1500); });
document.querySelector("#import").addEventListener("click", () => document.querySelector("#import-file").click());
document.querySelector("#cancel-import").addEventListener("click", () => state.importController?.abort());
document.querySelector("#import-file").addEventListener("change", async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { await importAnswers(file); } catch (error) { alert(`Не удалось импортировать ответы: ${error?.message || error}`); } });
document.querySelector("#paste").addEventListener("click", () => { document.querySelector("#paste-text").value = ""; document.querySelector("#paste-dialog").showModal(); });
document.querySelector("#paste-import").addEventListener("click", async () => { const text = document.querySelector("#paste-text").value; try { await importAnswersText(text); document.querySelector("#paste-dialog").close(); } catch (error) { alert(`Не удалось импортировать ответы: ${error?.message || error}`); } });
load().then(() => {
  if (new URLSearchParams(location.search).get("print") === "1") setTimeout(() => window.print(), 350);
}).catch((error) => { const notice = document.querySelector("#notice"); notice.hidden = false; notice.textContent = String(error?.message || error); });
