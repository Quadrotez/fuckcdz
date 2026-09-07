(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const MARKER = "data-mesh-tasks-extension";

  function text(element) {
    return element?.textContent?.replace(/\s+/g, " ").trim() || "";
  }

  function firstText(root, selectors) {
    for (const selector of selectors) {
      const value = text(root.querySelector(selector));
      if (value) return value;
    }
    return "";
  }

  function closestCard(element) {
    let current = element;
    for (let i = 0; current && current !== document.body && i < 6; i += 1, current = current.parentElement) {
      const value = text(current);
      if (value.length >= 20 && value.length <= 2500 && current.querySelector("a, button")) return current;
    }
    return element.parentElement;
  }

  function extractFromDom() {
    const selectors = [
      "[data-testid*=homework]", "[data-testid*=assignment]", "[data-testid*=task]",
      "[class*=homework]", "[class*=Homework]", "[class*=assignment]", "[class*=Assignment]",
      "[class*=task]", "[class*=Task]", "article"
    ];
    const candidates = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
    const tasks = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const card = closestCard(candidate);
      if (!card || card[MARKER] || card.closest("nav, header, footer")) continue;
      const raw = text(card);
      if (raw.length < 20 || raw.length > 3000) continue;
      const links = [...card.querySelectorAll("a[href]")].map((link) => ({
        title: text(link) || "Материал",
        url: link.href
      })).filter((item) => item.url.startsWith("http"));
      const title = firstText(card, ["h1", "h2", "h3", "h4", "[class*=title]", "[class*=name]"]) || raw.slice(0, 120);
      const subject = firstText(card, ["[class*=subject]", "[data-testid*=subject]"]);
      const dueDate = firstText(card, ["time", "[class*=date]", "[class*=deadline]", "[data-testid*=date]"]);
      const key = `${title}|${subject}|${links.map((item) => item.url).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({
        id: `dom-${tasks.length}-${btoa(unescape(encodeURIComponent(key))).slice(0, 32)}`,
        title,
        subject,
        dueDate,
        description: raw === title ? "" : raw.slice(0, 500),
        status: /выполн|заверш|done|completed/i.test(raw) ? "done" : "new",
        materials: links,
        sourceUrl: location.href
      });
    }
    return tasks
      .filter((task) => task.materials.length > 0)
      .sort((a, b) => {
        const left = Date.parse(a.dueDate || "") || Number.MAX_SAFE_INTEGER;
        const right = Date.parse(b.dueDate || "") || Number.MAX_SAFE_INTEGER;
        return left - right || a.title.localeCompare(b.title, "ru");
      });
  }

  async function scan() {
    const tasks = extractFromDom();
    await api.runtime.sendMessage({ type: "STORE_TASKS", tasks, source: location.href });
    return { count: tasks.length };
  }

  api.runtime.onMessage.addListener((message) => {
    if (message?.type === "SCAN_PAGE") return scan();
  });

})();
