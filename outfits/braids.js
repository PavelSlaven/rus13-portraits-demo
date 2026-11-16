"use strict";

const styleSelect = document.querySelector("#braid-style");
const baseSelect = document.querySelector("#braid-base");
const gallery = document.querySelector("#braid-gallery");
const message = document.querySelector("#braid-status");
const retry = document.querySelector("#braid-retry");

let catalogue;
let worker;
let ready = false;
let current = 0;
let downloads = [];
let pending = new Map();

function fail() {
  ready = false;
  worker?.terminate();
  worker = undefined;
  message.textContent = "Не удалось загрузить портреты.";
  gallery.setAttribute("aria-busy", "false");
  retry.hidden = false;
}

function addArtwork(parent, className, alt, width, height) {
  const link = document.createElement("a");
  link.className = className;
  link.hidden = true;
  const image = document.createElement("img");
  image.width = width;
  image.height = height;
  image.alt = alt;
  link.append(image);
  parent.append(link);
  return { link, image };
}

function showArtwork(target, data, name) {
  const url = URL.createObjectURL(new Blob([data], { type: "image/svg+xml" }));
  downloads.push(url);
  target.link.href = url;
  target.link.download = name;
  target.image.src = url;
  target.link.hidden = false;
}

function startWorker() {
  worker = new Worker("./renderer-worker.js?v=braid-fit", { name: "Галерея Rus13" });
  worker.addEventListener("error", fail);
  worker.addEventListener("message", ({ data }) => {
    if (data.kind === "startup-error") {
      fail();
    } else if (data.kind === "ready") {
      ready = true;
      render();
    } else if (pending.has(data.id)) {
      if (data.kind !== "rendered") {
        fail();
        return;
      }
      const { portrait, card } = pending.get(data.id);
      showArtwork(portrait, data.result.full, `rus13-braid-${data.id}-full.svg`);
      showArtwork(card, data.result.card, `rus13-braid-${data.id}-32.svg`);
      pending.delete(data.id);
      if (!pending.size) {
        message.textContent = "";
        gallery.setAttribute("aria-busy", "false");
      }
    }
  });
}

function render() {
  if (!ready) return;
  const group = catalogue.groups[Number(baseSelect.value)];
  const rows = new Map();
  const next = document.createDocumentFragment();
  pending = new Map();
  current += 1;
  downloads.forEach(url => URL.revokeObjectURL(url));
  downloads = [];
  gallery.setAttribute("aria-busy", "true");
  message.textContent = "Строим портреты…";
  retry.hidden = true;
  for (const [index, sample] of group.cases.entries()) {
    if (!rows.has(sample.face)) {
      const section = document.createElement("section");
      section.className = "braid-row";
      const title = document.createElement("h2");
      title.textContent = sample.face;
      const grid = document.createElement("div");
      grid.className = "braid-grid";
      section.append(title, grid);
      rows.set(sample.face, grid);
      next.append(section);
    }
    const tile = document.createElement("figure");
    tile.className = "braid-slot";
    const portrait = addArtwork(tile, "braid-portrait", `${sample.face}, ${sample.headwear}, в полный рост`, 320, 752);
    const caption = document.createElement("figcaption");
    const card = addArtwork(caption, "braid-card", `Карточка 32 × 32, ${sample.headwear}`, 32, 32);
    const hat = document.createElement("span");
    hat.textContent = sample.headwear;
    caption.append(hat);
    tile.append(caption);
    rows.get(sample.face).append(tile);
    const id = `${current}-${index + 1}`;
    pending.set(id, { portrait, card });
    worker.postMessage({ id, payload: sample.payload });
  }
  gallery.replaceChildren(next);
}

function chooseBase() {
  const options = catalogue.groups.flatMap((group, index) => group.style === styleSelect.value
    ? [new Option(group.base, String(index))] : []);
  baseSelect.replaceChildren(...options);
  render();
}

async function load() {
  retry.hidden = true;
  message.textContent = "Загружаем галерею…";
  gallery.setAttribute("aria-busy", "true");
  try {
    if (!catalogue) {
      const response = await fetch("./braid-fit.json");
      if (!response.ok) throw new Error("Каталог недоступен");
      catalogue = await response.json();
      for (const [id, label] of Object.entries(catalogue.styles)) styleSelect.append(new Option(label, id));
      styleSelect.disabled = baseSelect.disabled = false;
      chooseBase();
    }
    startWorker();
  } catch {
    fail();
  }
}

styleSelect.addEventListener("change", chooseBase);
baseSelect.addEventListener("change", render);
retry.addEventListener("click", load);
load();
