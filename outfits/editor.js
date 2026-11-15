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
const exampleList = document.querySelector("#examples");
const artwork = ["portrait", "card"].map(view => ({
  view,
  image: document.getElementById(view),
  download: document.getElementById(`save-${view}`),
  url: null,
}));

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
  select.append(new Option(initialLabel, ""));
  for (const [value, title] of Object.entries(definition.values)) {
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
      const wrongAge = appearanceField ? catalog.age_restrictions?.[age]?.[field]?.includes(option.value)
                                       : age === "child" && Boolean(required);
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

function setArtworkSource(item, url, objectUrl = null) {
  item.image.src = url;
  item.download.href = url;
  item.download.removeAttribute("aria-disabled");
  if (item.url) URL.revokeObjectURL(item.url);
  item.url = objectUrl;
}

function showArtwork(result) {
  if (artwork.some(({ view }) => typeof result[view] !== "string" || !result[view])) {
    throw new Error("Генератор вернул неполный портрет.");
  }
  for (const item of artwork) {
    const url = URL.createObjectURL(new Blob([result[item.view]], { type: "image/svg+xml" }));
    setArtworkSource(item, url, url);
  }
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
      } else if (exampleList.querySelector('[aria-pressed="true"]')) {
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
    select.value = example.payload[kind][field] ?? "";
  }
  setActiveExample(example.id);
  updateOptions();
  updateNotes(example.recipe);
  for (const item of artwork) setArtworkSource(item, `./${example.id}-${item.view}.svg`);
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
  for (const { download } of artwork) {
    download.removeAttribute("href");
    download.setAttribute("aria-disabled", "true");
  }
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
    for (const field of ["outfit", "headgear"]) addField(primaryFields, "equipment", field);
    for (const [title, fields] of groups) addGroup(title, "appearance", fields.split(" "));

    const assigned = new Set(Array.from(controls.values(), ({ field }) => field));
    addGroup("Другие черты", "appearance", Object.keys(catalog.appearance).filter(field => !assigned.has(field)));
    addGroup("Экипировка и фон", "equipment", Object.keys(catalog.equipment).filter(field => !assigned.has(field)));

    for (const example of examples) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = example.label;
      button.dataset.example = example.id;
      button.addEventListener("click", () => applyExample(example));
      exampleList.append(button);
    }

    primary.disabled = false;
    detail.hidden = false;
    applyExample(examples[0]);
  } catch {
    setStatus("Не удалось загрузить настройки редактора.", { error: true });
  }
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
