"use strict";

const el = id => document.getElementById(id);
const picker = el("picker");
const select = el("item");
const status = el("status");
let items = [];
let worker;
let ready = false;
let pending;
let jobId = 0;
let urls = {};
let view = "full";
let controller;

function message(text, error = false) {
  status.textContent = text;
  status.dataset.error = String(error);
}

function selectedItem() {
  return items.find(item => item.id === select.value);
}

function fillItems(preferred) {
  const selected = select.value;
  const target = preferred ?? selected;
  const query = el("search").value.trim().toLocaleLowerCase("ru");
  const category = el("category").value;
  const filtered = items.filter(item => (!category || item.category === category)
    && `${item.id} ${item.label}`.toLocaleLowerCase("ru").includes(query));
  select.replaceChildren(...filtered.map(item => new Option(item.label, item.id)));
  if (filtered.some(item => item.id === target)) select.value = target;
  else if (filtered.length) select.value = filtered[0].id;
  el("count").textContent = `${filtered.length} из ${items.length} вещей`;
  select.disabled = !filtered.length;
  if (!filtered.length) message("По этому запросу вещей нет.");
  else if (select.value !== selected) render();
}

function sourceDetails(item) {
  el("sources").replaceChildren();
  item.sources.forEach((source, index) => {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `Источник ${index + 1} · ${source.accuracy || "описание INDEX"}`;
    details.append(summary);
    for (const text of [source.description, [source.date, source.place].filter(Boolean).join(" · "),
      source.appearance_description, source.distinction]) {
      if (!text) continue;
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      details.append(paragraph);
    }
    const match = source.url?.match(/https?:\/\/[^\s;,]+/);
    if (match) {
      const paragraph = document.createElement("p");
      const link = document.createElement("a");
      link.href = match[0];
      link.textContent = "Страница источника";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      paragraph.append(link);
      details.append(paragraph);
    }
    el("sources").append(details);
  });
}

function show(result) {
  const previous = urls;
  urls = Object.fromEntries(["full", "portrait", "card", "detail"].map(key => [key,
    URL.createObjectURL(new Blob([result[key]], {type:"image/svg+xml"}))]));
  updateView();
  el("card").src = urls.card;
  el("card64").src = urls.card;
  el("object").src = urls.detail;
  el("save-card").href = urls.card;
  el("save-object").href = urls.detail;
  el("preview").hidden = false;
  Object.values(previous).forEach(url => URL.revokeObjectURL(url));
  message("Вещь обновлена.");
}

function updateView() {
  if (!urls[view]) return;
  el("portrait").src = urls[view];
  el("portrait").height = view === "full" ? 752 : 440;
  el("save-portrait").href = urls[view];
  el("save-portrait").download = `rus13-${view}.svg`;
  for (const button of document.querySelectorAll("[data-view]")) button.setAttribute("aria-pressed", String(button.dataset.view === view));
}

async function render() {
  const item = selectedItem();
  if (!item) return;
  const id = ++jobId;
  el("item-title").textContent = item.label;
  el("item-id").textContent = `${item.id} · ${item.category}`;
  el("item-note").textContent = [item.integration_status === "research_only"
    ? "Исследовательский просмотр. Предмет исключён из автоматического подбора." : "", item.note].filter(Boolean).join(" ");
  sourceDetails(item);
  const appearance = {body:el("body").value};
  if (el("skull").value) appearance.skull = el("skull").value;
  const equipment = {};
  if (el("cloak").value) equipment.cloak = el("cloak").value;
  const payload = {seed:el("seed").value, catalog_item:item.id, appearance, equipment};
  const location = new URL(window.location.href);
  location.searchParams.set("item", item.id);
  history.replaceState(null, "", location);
  message("Рисуем вещь…");
  if (document.body.dataset.runtime === "browser") {
    pending = {id,payload};
    if (ready) worker.postMessage(pending);
    return;
  }
  controller?.abort();
  controller = new AbortController();
  try {
    const response = await fetch("./api/render", {method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),signal:controller.signal});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Не удалось нарисовать вещь.");
    if (id === jobId) show(result);
  } catch (error) {
    if (error.name !== "AbortError" && id === jobId) message(error.message, true);
  }
}

async function start() {
  try {
    const response = await fetch("./image-inventory.json?v=izyaslav-armhole-1");
    if (!response.ok) throw new Error("Каталог INDEX недоступен.");
    items = await response.json();
    for (const category of new Set(items.map(item => item.category))) el("category").append(new Option(category, category));
    if (document.body.dataset.runtime === "browser") {
      worker = new Worker("./renderer-worker.js?v=wrist-fit-1", {name:"Rus13 · INDEX"});
      worker.addEventListener("message", ({data}) => {
        if (data.kind === "ready") {ready = true; if (pending) worker.postMessage(pending);}
        else if (data.id === jobId && data.kind === "rendered") show(data.result);
        else if (data.id === jobId && data.kind === "render-error") message(data.error || "Не удалось нарисовать вещь.", true);
        else if (data.kind === "startup-error") message("Не удалось загрузить генератор. Обновите страницу.", true);
      });
      worker.addEventListener("error", () => message("Ошибка загрузки генератора. Обновите страницу.", true));
    }
    const requested = new URL(window.location.href).searchParams.get("item");
    fillItems(requested);
  } catch (error) {message(error.message, true);}
}

picker.addEventListener("submit", event => {event.preventDefault();render();});
el("search").addEventListener("input", () => fillItems());
el("category").addEventListener("change", () => fillItems());
for (const id of ["item", "body", "skull", "cloak"]) el(id).addEventListener("change", render);
document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {view = button.dataset.view;updateView();}));
start();
