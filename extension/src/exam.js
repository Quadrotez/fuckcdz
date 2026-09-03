const api = globalThis.browser ?? globalThis.chrome;

function appendContent(parent, content) {
  if (content == null) return;
  if (Array.isArray(content)) {
    content.forEach((item) => appendContent(parent, item));
    return;
  }
  if (typeof content === "string" || typeof content === "number") {
    parent.append(document.createTextNode(String(content)));
    return;
  }
  if (typeof content !== "object") return;
  if (content.content != null) {
    const type = String(content.type || "");
    const node = document.createElement(type.includes("math") ? "span" : "span");
    if (type.includes("math")) node.className = "math";
    appendContent(node, content.content);
    parent.append(node);
  }
  if (content.text) parent.append(document.createTextNode(String(content.text)));
}

function renderRich(parent, elements) {
  const wrapper = document.createElement("div");
  for (const element of Array.isArray(elements) ? elements : []) appendContent(wrapper, element);
  if (!wrapper.textContent.trim()) wrapper.textContent = "[Текст вопроса не найден в ответе API]";
  parent.append(wrapper);
}

function renderTask(task, index) {
  const card = document.createElement("article");
  card.className = "question";
  const head = document.createElement("div");
  head.className = "question-head";
  head.innerHTML = `<span>Задание ${index + 1}</span><span>ID: ${String(task.id ?? "—")}</span>`;
  card.append(head);

  const text = document.createElement("div");
  text.className = "question-text";
  renderRich(text, task.question_elements);
  card.append(text);

  const options = Array.isArray(task.answer?.options) ? task.answer.options : [];
  if (options.length) {
    const list = document.createElement("ol");
    list.className = "options";
    for (const option of options) {
      const item = document.createElement("li");
      item.className = "option";
      const number = document.createElement("span");
      number.className = "option-index";
      number.textContent = `${item.parentElement?.children.length + 1 || list.children.length + 1}.`;
      const body = document.createElement("span");
      appendContent(body, option);
      item.append(number, body);
      list.append(item);
    }
    card.append(list);
  }
  const type = document.createElement("div");
  type.className = "question-type";
  type.textContent = `Тип ответа: ${task.answer?.type || "не указан"}`;
  card.append(type);
  return card;
}

async function load() {
  const result = await api.runtime.sendMessage({ type: "GET_LATEST_EXAM" });
  const snapshot = result?.exam;
  const container = document.querySelector("#questions");
  container.replaceChildren();
  if (!snapshot?.response) {
    document.querySelector("#notice").hidden = false;
    document.querySelector("#notice").textContent = "Snapshot ещё не найден. Открой тест заново, начни попытку и дождись запроса start-attempt.";
    document.querySelector("#meta").textContent = "Нет сохранённого ответа start-attempt";
    return;
  }
  const groups = Array.isArray(snapshot.response.challenge_test_groups) ? snapshot.response.challenge_test_groups : [];
  const tasks = groups.flatMap((group) => Array.isArray(group.challenge_tasks) ? group.challenge_tasks : []);
  document.querySelector("#meta").textContent = `Источник: ${snapshot.url || "uchebnik.mos.ru"} · попытка: ${snapshot.response.challenge_attempt_id ?? "—"}`;
  document.querySelector("#summary").textContent = `Групп: ${groups.length}. Всего заданий: ${tasks.length}. Это локальная копия ответа start-attempt.`;
  if (!tasks.length) {
    container.innerHTML = "<div class=\"empty\">В snapshot нет challenge_tasks.</div>";
    return;
  }
  tasks.sort((a, b) => (a.task_order ?? 0) - (b.task_order ?? 0));
  tasks.forEach((task, index) => container.append(renderTask(task, index)));
}

document.querySelector("#refresh").addEventListener("click", load);
document.querySelector("#debug").addEventListener("click", () => api.runtime.sendMessage({ type: "OPEN_DEBUG" }));
load().catch((error) => { document.querySelector("#notice").hidden = false; document.querySelector("#notice").textContent = String(error); });
