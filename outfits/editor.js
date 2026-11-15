"use strict";

const editor = document.querySelector("#editor");
const primary = document.querySelector("#primary");
const primaryFields = document.querySelector("#primary-fields");
const detail = document.querySelector("#detail");
const seed = document.querySelector("#seed");
const profile = document.querySelector("#profile");
const randomize = document.querySelector("#randomize");
const reset = document.querySelector("#reset");
const retry = document.querySelector("#retry");
const status = document.querySelector("#status");
const images = document.querySelector("#images");
const portrait = document.querySelector("#portrait");
const portraitFrame = portrait.parentElement;
const portraitDownload = document.querySelector("#save-portrait");
const card = document.querySelector("#card");
const cardDownload = document.querySelector("#save-card");
const portraitViewButtons = document.querySelectorAll("[data-portrait-view]");
const exampleList = document.querySelector("#examples");
const presetPickers = [
  { field: "estate", select: document.querySelector("#adult-estates") },
  { field: "region", select: document.querySelector("#northwest-examples") },
].filter(({ select }) => select);
const groupedExamples = new Map();
const artworkViews = ["full", "portrait", "card"];
const legwearFields = ["trousers", "leg_wraps", "footwear"];
const portraitLabels = {
  full: { alt: "Персонаж анфас в полный рост", download: "Скачать персонажа в полный рост в SVG" },
  portrait: { alt: "Портрет персонажа анфас по пояс", download: "Скачать портрет по пояс в SVG" },
};

const groups = [
  ["Форма лица", "skull forehead forehead_outline cheekbone cheeks cheek_relief jaw jaw_width jaw_height chin chin_height chin_width chin_mark neck"],
  ["Уши", "ear_size ear_outset ear_height ear_rim earlobe"],
  ["Кожа и приметы", "skin marks freckle_pattern asymmetry skin_state"],
  ["Глаза и веки", "eye_shape eye_spacing eye_width eye_height eye_tilt eyelid lower_lid inner_fold iris iris_size gaze"],
  ["Брови", "brow_shape brow_weight brow_height brow_length brow_gap brow_tail"],
  ["Нос", "nose_bridge nose_root nose_length nose_width nose_wings nose_tip nose_tip_height nostril_shape"],
  ["Рот и губы", "mouth_width mouth_height mouth_corners lip_volume upper_lip lower_lip lip_shape lip_border philtrum expression"],
  ["Причёска", "hair_length hair_style hair_texture hairline hair_density part hair_color graying"],
  ["Борода и усы", "beard beard_growth moustache moustache_growth"],
];

const controls = new Map();
let catalog;
let timer;
let renderId = 0;
let renderer;
let ready = false;
let pendingRender;
let sampleModes = {};
let portraitView = "full";
let artworkSources = exampleArtwork("man");
let artworkAvailable = true;

function setStatus(message, { error = false, busy = false } = {}) {
  status.textContent = message;
  status.classList.toggle("error", error);
  retry.hidden = !error;
  images.setAttribute("aria-busy", busy);
}

function addField(container, kind, field) {
  const definition = catalog[kind][field];
  if (!definition) return;

  const label = document.createElement("label");
  label.className = "field";
  const name = document.createElement("span");
  name.textContent = definition.label;
  const select = document.createElement("select");
  select.name = field;
  select.id = `${kind}-${field}`;
  label.htmlFor = select.id;
  let initialLabel = kind === "appearance" ? "По seed" : "По умолчанию";
  if (field === "beard_growth" || field === "moustache_growth") initialLabel = "Полный рост (по умолчанию)";
  if (field === "hair_length") initialLabel = "По причёске";
  const isLegwear = kind === "equipment" && legwearFields.includes(field);
  if (isLegwear) initialLabel = "По комплекту";
  select.append(new Option(initialLabel, ""));
  for (const [value, title] of Object.entries(definition.values)) {
    if (isLegwear && value === "auto") continue;
    select.append(new Option(title, value));
  }

  const note = document.createElement("small");
  note.id = `${select.id}-note`;
  note.hidden = true;
  select.setAttribute("aria-describedby", note.id);
  label.append(name, select);
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  wrapper.append(label, note);
  container.append(wrapper);
  controls.set(select, { kind, field, definition, note });
}

function addGroup(title, kind, fields) {
  const group = document.createElement("details");
  const summary = document.createElement("summary");
  const container = document.createElement("div");
  summary.textContent = title;
  container.className = "fields";
  for (const field of fields) addField(container, kind, field);
  if (!container.childElementCount) return;
  group.append(summary, container);
  detail.append(group);
}

function outsideProfile(field, value) {
  const memberships = catalog.memberships?.[field]?.[value];
  return profile.value !== "free" && Array.isArray(memberships) && !memberships.includes(profile.value);
}

function updateOptions() {
  const cast = document.getElementById("appearance-cast").value;
  const age = document.getElementById("appearance-age").value || "adult";
  const length = document.getElementById("appearance-hair_length")?.value ?? "";
  const hairstyles = catalog.hair_styles_by_length?.[length || "default"];
  const childLabels = age === "child" ? {men: "Мальчик", women: "Девочка"} : {};
  for (const [select, { kind, field, definition }] of controls) {
    const appearanceField = kind === "appearance";
    const castRestrictions = appearanceField ? catalog.exclusive_traits?.[field] : catalog.equipment_casts?.[field];
    if (!appearanceField && !castRestrictions) continue;
    for (const option of select.options) {
      if (!option.value) continue;
      const required = castRestrictions?.[option.value];
      const wrongAge = catalog.age_restrictions?.[age]?.[field]?.includes(option.value)
        || (!appearanceField && age === "child" && Boolean(required));
      const wrongLength = field === "hair_style" && hairstyles && !hairstyles.includes(option.value);
      option.disabled = option.hidden = Boolean(wrongAge || wrongLength || (required && required !== cast));
      const title = (field === "cast" && childLabels[option.value]) || definition.values[option.value];
      option.textContent = appearanceField && outsideProfile(field, option.value) ? `${title} · вне автонабора` : title;
    }
    if (select.selectedOptions[0]?.disabled) select.value = "";
  }
}

function updateNotes(recipe) {
  for (const [select, { kind, field, definition, note }] of controls) {
    const automatic = definition.values[recipe?.[kind]?.[field]];
    let message = "";
    if (!select.value && automatic) message = automatic;
    if (kind === "appearance" && select.value && outsideProfile(field, select.value)) {
      message = "Вне автонабора профиля";
    }
    note.textContent = message;
    note.hidden = !message;
  }
}

function selection() {
  const payload = { ...sampleModes, seed: seed.value, profile: profile.value, appearance: {}, equipment: {} };
  for (const [select, { kind, field }] of controls) {
    if (select.value) payload[kind][field] = select.value;
  }
  return payload;
}

function exampleArtwork(id) {
  return Object.fromEntries(artworkViews.map(view => [view, `./${id}-${view}.svg`]));
}

function setArtworkSource(image, download, url) {
  if (image.getAttribute("src") !== url) image.src = url;
  if (artworkAvailable) {
    download.href = url;
    download.removeAttribute("aria-disabled");
  } else {
    download.removeAttribute("href");
    download.setAttribute("aria-disabled", "true");
  }
}

function updatePortrait() {
  setArtworkSource(portrait, portraitDownload, artworkSources[portraitView]);
}

function replaceArtwork(sources) {
  const previousSources = artworkSources;
  artworkSources = sources;
  artworkAvailable = true;
  updatePortrait();
  setArtworkSource(card, cardDownload, sources.card);
  for (const url of Object.values(previousSources)) {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  }
}

function showArtwork(result) {
  if (artworkViews.some(view => typeof result[view] !== "string" || !result[view])) {
    throw new Error("Генератор вернул неполный портрет.");
  }
  replaceArtwork(Object.fromEntries(artworkViews.map(view => [
    view, URL.createObjectURL(new Blob([result[view]], { type: "image/svg+xml" })),
  ])));
}

function setPortraitView(view) {
  portraitView = view;
  portraitFrame.dataset.view = view;
  portrait.alt = portraitLabels[view].alt;
  portraitDownload.download = `rus13-${view}.svg`;
  portraitDownload.setAttribute("aria-label", portraitLabels[view].download);
  for (const button of portraitViewButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.portraitView === view));
  }
  updatePortrait();
}

function startRenderer() {
  if (renderer) return;
  const worker = new Worker("./renderer-worker.js", { name: "Rus13" });
  renderer = worker;
  function fail() {
    worker.terminate();
    renderer = null;
    ready = false;
    pendingRender = null;
    setStatus("Не удалось запустить генератор в браузере.", { error: true });
  }
  worker.addEventListener("error", fail);
  worker.addEventListener("message", ({ data }) => {
    if (data.kind === "startup-error") {
      fail();
      return;
    }
    if (data.kind === "ready") {
      ready = true;
      if (pendingRender) {
        worker.postMessage(pendingRender);
        pendingRender = null;
      } else if (presetPickers.some(({ select }) => select.value) || exampleList.querySelector('[aria-pressed="true"]')) {
        setStatus("");
      }
      return;
    }
    if (data.id !== renderId) return;
    try {
      if (data.kind !== "rendered") throw new Error("Проверьте настройки и попробуйте снова.");
      showArtwork(data.result);
      updateNotes(data.result.recipe);
      setStatus("Портрет обновлён.");
    } catch (error) {
      setStatus(`Не удалось построить портрет. ${error.message}`, { error: true });
    }
  });
}

function setActiveExample(active) {
  const grouped = groupedExamples.get(active);
  for (const { field, select } of presetPickers) select.value = grouped?.[field] ? active : "";
  for (const button of exampleList.children) {
    button.setAttribute("aria-pressed", String(button.dataset.example === active));
  }
}

function applyExample(example) {
  clearTimeout(timer);
  renderId += 1;
  pendingRender = null;
  sampleModes = {};
  for (const flag of ["extended", "expanded_hair", "distinct_bases", "cast_traits"]) {
    if (typeof example.payload[flag] === "boolean") sampleModes[flag] = example.payload[flag];
  }
  seed.value = example.payload.seed;
  profile.value = example.payload.profile;
  for (const [select, { kind, field }] of controls) {
    const value = example.payload[kind][field];
    select.value = kind === "equipment" && legwearFields.includes(field) && value === "auto" ? "" : value ?? "";
  }
  setActiveExample(example.id);
  updateOptions();
  updateNotes(example.recipe);
  replaceArtwork(exampleArtwork(example.id));
  setStatus(ready ? "" : "Загружаем генератор…", { busy: !ready });
  try {
    startRenderer();
  } catch {
    setStatus("Не удалось запустить генератор в браузере.", { error: true });
  }
}

function render(id) {
  try {
    startRenderer();
    const job = { id, payload: selection() };
    if (ready) renderer.postMessage(job);
    else pendingRender = job;
  } catch {
    setStatus("Не удалось запустить генератор в браузере.", { error: true });
  }
}

function scheduleRender(delay = 0) {
  const id = ++renderId;
  clearTimeout(timer);
  pendingRender = null;
  setActiveExample(null);
  artworkAvailable = false;
  updatePortrait();
  setArtworkSource(card, cardDownload, artworkSources.card);
  updateNotes();
  if (!seed.value) {
    setStatus("Введите seed, чтобы обновить портрет.");
    return;
  }
  setStatus("Строим портрет…", { busy: true });
  timer = setTimeout(() => render(id), delay);
}

async function loadCatalog() {
  setStatus("Загружаем редактор…", { busy: true });
  try {
    const response = await fetch("./studio.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { catalog: data, examples } = await response.json();
    for (const [id, label] of Object.entries(data.profiles)) profile.append(new Option(label, id));
    profile.value = data.default_profile;
    catalog = data;

    for (const field of ["cast", "age", "body"]) addField(primaryFields, "appearance", field);
    for (const field of ["outfit", ...legwearFields, "headgear"]) addField(primaryFields, "equipment", field);
    for (const [title, fields] of groups) addGroup(title, "appearance", fields.split(" "));

    const assigned = new Set(Array.from(controls.values(), ({ field }) => field));
    addGroup("Другие черты", "appearance", Object.keys(catalog.appearance).filter(field => !assigned.has(field)));
    addGroup("Экипировка и фон", "equipment", Object.keys(catalog.equipment).filter(field => !assigned.has(field)));

    const groupsByLabel = new Map();
    for (const example of examples) {
      if (example.estate || example.region) {
        const picker = presetPickers.find(({ field }) => example[field]);
        if (!picker) continue;
        const label = example[picker.field];
        const key = `${picker.field}/${label}`;
        if (!groupsByLabel.has(key)) {
          const group = document.createElement("optgroup");
          group.label = label;
          groupsByLabel.set(key, group);
          picker.select.append(group);
        }
        groupsByLabel.get(key).append(new Option(example.label, example.id));
        groupedExamples.set(example.id, example);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = example.label;
      button.dataset.example = example.id;
      button.addEventListener("click", () => applyExample(example));
      exampleList.append(button);
    }

    primary.disabled = false;
    for (const { select } of presetPickers) select.disabled = select.options.length <= 1;
    detail.hidden = false;
    applyExample(examples[0]);
  } catch {
    setStatus("Не удалось загрузить настройки редактора.", { error: true });
  }
}

for (const { select } of presetPickers) {
  select.addEventListener("change", () => {
    const example = groupedExamples.get(select.value);
    if (example) applyExample(example);
  });
}

for (const button of portraitViewButtons) {
  button.addEventListener("click", () => setPortraitView(button.dataset.portraitView));
}

seed.addEventListener("input", () => scheduleRender(180));
randomize.addEventListener("click", () => {
  seed.value = `rus13-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
  scheduleRender();
});
editor.addEventListener("change", event => {
  if (event.target === profile || ["appearance-cast", "appearance-age", "appearance-hair_length"].includes(event.target.id)) {
    updateOptions();
  }
  if (legwearFields.includes(controls.get(event.target)?.field)) setPortraitView("full");
  if (event.target === profile || controls.has(event.target)) scheduleRender();
});
reset.addEventListener("click", () => {
  sampleModes = {};
  for (const select of controls.keys()) select.value = "";
  updateOptions();
  scheduleRender();
});
retry.addEventListener("click", () => {
  if (catalog) scheduleRender();
  else loadCatalog();
});

loadCatalog();
