const api = globalThis.browser ?? globalThis.chrome;
let current = { version: 1, events: [] };

async function load() {
  const result = await api.runtime.sendMessage({ type: "GET_DEBUG_LOG" });
  current = result?.log || { version: 1, events: [] };
  document.querySelector("#summary").textContent = `Событий: ${current.events?.length || 0}. Последнее обновление: ${new Date().toLocaleString("ru-RU")}`;
  document.querySelector("#preview").textContent = JSON.stringify(current, null, 2);
}

function download() {
  const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mesh-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.querySelector("#download").addEventListener("click", download);
document.querySelector("#copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(JSON.stringify(current, null, 2));
  document.querySelector("#summary").textContent = "JSON скопирован в буфер обмена.";
});
document.querySelector("#clear").addEventListener("click", async () => {
  await api.runtime.sendMessage({ type: "CLEAR_DEBUG_LOG" });
  await load();
});
load().catch((error) => { document.querySelector("#preview").textContent = String(error); });
