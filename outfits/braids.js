"use strict";

const styleSelect = document.querySelector("#braid-style");
const baseSelect = document.querySelector("#braid-base");
const gallery = document.querySelector("#braid-gallery");
const message = document.querySelector("#braid-status");
const retry = document.querySelector("#braid-retry");
const views = {
  braids: {
    title: "Косы на разных лицах", assetPrefix: "rus13-braid",
    dataFile: "./braid-fit.json", link: "#braid-fit-link",
  },
  loose: {
    title: "Распущенные волосы и пучки", assetPrefix: "rus13-hair",
    dataFile: "./loose-hair-fit.json", link: "#loose-hair-fit-link",
  },
  facial: {
    title: "Бороды и усы с бармицей и без", assetPrefix: "rus13-facial-hair",
    dataFile: "./facial-hair-fit.json?v=moustache-lip-fit", link: "#facial-hair-fit-link",
    styleLabel: "Бороды, усы и рост", baseLabel: "Вариант",
  },
  eyes: {
    title: "Глаза, брови и нос", assetPrefix: "rus13-eye-fit",
    dataFile: "./eye-nasal-fit.json", link: "#eye-nasal-fit-link",
    styleLabel: "Группа черт", baseLabel: "Сочетание",
  },
  clothes: {
    title: "Одежда и материалы", assetPrefix: "rus13-clothes",
    dataFile: "./clothing-materials.json?v=image-index-2", link: "#clothing-materials-link",
    styleLabel: "Раздел гардероба", baseLabel: "Вещь",
  },
};
const requestedView = new URLSearchParams(window.location.search).get("view");
const view = Object.hasOwn(views, requestedView) ? views[requestedView] : views.braids;
const { title, assetPrefix, dataFile, link, styleLabel, baseLabel } = view;
const note = document.querySelector("#catalogue-note");
document.title = `${title} · Rus13`;
document.querySelector("#hair-fit-heading").textContent = title;
document.querySelector(link).setAttribute("aria-current", "page");
if (styleLabel) document.querySelector("#braid-style-label").textContent = styleLabel;
if (baseLabel) document.querySelector("#braid-base-label").textContent = baseLabel;

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
  worker = new Worker("./renderer-worker.js?v=image-index-2", { name: "Галерея Rus13" });
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
      const { portrait, card, detail } = pending.get(data.id);
      showArtwork(portrait, data.result.full, `${assetPrefix}-${data.id}-full.svg`);
      showArtwork(card, data.result.card, `${assetPrefix}-${data.id}-32.svg`);
      if (detail && data.result.detail) showArtwork(detail, data.result.detail, `${assetPrefix}-${data.id}-detail.svg`);
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
  note.textContent = group.note ?? "";
  note.hidden = !note.textContent;
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
    const detail = sample.detail ? addArtwork(tile, "garment-detail", "Деталь вещи крупным планом", 320, 200) : null;
    rows.get(sample.face).append(tile);
    const id = `${current}-${index + 1}`;
    pending.set(id, { portrait, card, detail });
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
      const response = await fetch(dataFile);
      if (!response.ok) throw new Error("Каталог недоступен");
      catalogue = await response.json();
      const categories = new Map();
      for (const [id, item] of Object.entries(catalogue.styles)) {
        if (typeof item === "string") {
          styleSelect.append(new Option(item, id));
        } else {
          if (!categories.has(item.category)) {
            const list = document.createElement("optgroup");
            list.label = item.category;
            categories.set(item.category, list);
            styleSelect.append(list);
          }
          categories.get(item.category).append(new Option(item.label, id));
        }
      }
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
