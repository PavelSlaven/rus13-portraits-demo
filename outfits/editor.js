"use strict";

const editor = document.querySelector("#editor");
const primary = document.querySelector("#primary");
const primaryFields = document.querySelector("#primary-fields");
const detail = document.querySelector("#detail");
const seed = document.querySelector("#seed");
const profile = document.querySelector("#profile");
const profileNote = document.querySelector("#profile-note");
const estate = document.querySelector("#estate");
const estateNote = document.querySelector("#estate-note");
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
  { field: "shield_region", select: document.querySelector("#shield-examples") },
  { field: "armour_group", select: document.querySelector("#armour-examples") },
  { field: "weapon_region", select: document.querySelector("#eurasian-weapon-examples") },
].filter(({ select }) => select);
const groupedExamples = new Map();
const artworkViews = ["full", "portrait", "card"];
const outfitDetailFields = [
  "cloak", "weapon", "carry", "shield", "shield_carry", "bow", "bow_case", "quiver",
  "belt", "belt_pouch", "jewelry", "trousers", "leg_wraps", "footwear",
];
const handheldNames = { weapon: "оружие", shield: "щит", bow: "лук" };
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
let lastRecipe;
let presetControls;
let timer;
let renderId = 0;
let renderer;
let ready = false;
let pendingRender;
let sampleModes = {};
let presetAccessory;
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
  select.append(new Option("По seed", ""));
  const optionGroups = field === "weapon" ? catalog.weapon_groups ?? {} : {};
  const groupedValues = new Set(Object.values(optionGroups).flat());
  for (const [value, title] of Object.entries(definition.values)) {
    if (value === "auto" || groupedValues.has(value)) continue;
    select.append(new Option(title, value));
  }
  for (const [title, values] of Object.entries(optionGroups)) {
    const group = document.createElement("optgroup");
    group.label = title;
    for (const value of values) group.append(new Option(definition.values[value], value));
    select.append(group);
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
  controls.set(select, { kind, field, definition, note, wrapper });
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
  const selected = profile.value || lastRecipe?.profile;
  const memberships = catalog.memberships?.[field]?.[value];
  return selected && selected !== "free" && Array.isArray(memberships) && !memberships.includes(selected);
}

function outsideEstate(field, value) {
  const selected = estate.value || lastRecipe?.estate;
  const memberships = catalog.equipment_estates?.[field]?.[value];
  return selected && Array.isArray(memberships) && !memberships.includes(selected);
}

function updateOptions() {
  const generated = !presetControls;
  const restrictions = generated ? catalog.generated_age_restrictions : catalog.age_restrictions;
  const equipmentCasts = generated ? catalog.generated_equipment_casts : catalog.equipment_casts;
  const wardrobes = catalog.profile_cultures;
  const cultures = generated && profile.value !== "free"
    ? wardrobes[profile.value] ?? Object.values(wardrobes).flat()
    : [null];
  const cast = document.getElementById("appearance-cast").value;
  const age = document.getElementById("appearance-age").value;
  const length = document.getElementById("appearance-hair_length").value;
  const hairstyles = catalog.hair_styles_by_length?.[length];
  const visibleAge = age || lastRecipe?.appearance?.age;
  const visibleCast = cast || lastRecipe?.appearance?.cast;
  const childLabels = visibleAge === "child" ? { men: "Мальчик", women: "Девочка" } : {};
  const bases = (cast ? [cast] : Object.keys(catalog.appearance.cast.values)).flatMap(base =>
    (age ? [age] : Object.keys(catalog.appearance.age.values)).flatMap(years =>
      cultures.map(culture => ({ base, years, culture }))));

  function fits({ kind, field }, value, { base, years, culture }) {
    const groups = kind === "appearance" ? catalog.exclusive_traits : equipmentCasts;
    const required = groups?.[field]?.[value];
    const itemCultures = kind === "equipment" && culture && catalog.equipment_cultures[field][value];
    return (!required || required === base)
      && !restrictions[years]?.[field]?.includes(value)
      && (!itemCultures || itemCultures.includes(culture))
      && (field !== "hair_style" || !hairstyles || hairstyles.includes(value));
  }

  let compatible = bases;
  for (const [select, control] of controls) {
    if (!select.value) continue;
    const matching = compatible.filter(base => fits(control, select.value, base));
    if (matching.length) compatible = matching;
    else select.value = "";
  }
  const pinned = Array.from(controls).filter(([select]) => select.value);
  for (const [select, control] of controls) {
    const { kind, field, definition, wrapper } = control;
    const restricted = restrictions[visibleAge]?.[field] ?? [];
    const hidden = kind === "equipment" && Object.keys(definition.values).every(value =>
      value === "auto" || value === "none" || restricted.includes(value)
      || (generated && visibleCast === "women" && equipmentCasts[field]?.[value] === "men"));
    wrapper.hidden = select.disabled = hidden;
    const possible = bases.filter(base => pinned.every(([other, entry]) =>
      other === select || fits(entry, other.value, base)));
    for (const option of select.options) {
      if (!option.value) continue;
      const baseControl = field === "cast" || field === "age" || field === "hair_length";
      option.disabled = option.hidden = !baseControl && !possible.some(base => fits(control, option.value, base));
      const title = (field === "cast" && childLabels[option.value]) || definition.values[option.value];
      const outside = kind === "appearance" ? outsideProfile(field, option.value) : outsideEstate(field, option.value);
      const label = kind === "appearance" ? "вне автонабора" : "вне сословного набора";
      option.textContent = outside ? title + " · " + label : title;
    }
  }
}

function updateNotes(recipe) {
  for (const [select, names, note, value] of [
    [profile, catalog.profiles, profileNote, recipe?.profile],
    [estate, catalog.estates, estateNote, recipe?.estate],
  ]) {
    note.textContent = select.value ? "" : names[value] ?? "";
    note.hidden = !note.textContent;
  }
  const culture = catalog.cultures[recipe?.culture];
  if (culture) {
    profileNote.textContent = [profileNote.textContent, culture].filter(Boolean).join(" · ");
    profileNote.hidden = false;
  }
  const gear = recipe?.equipment ?? {};
  const { outfit, cloak, headgear, bow = "none", bow_case: bowCase, carry } = gear;
  const carried = carry !== "held";
  const holdingBow = !carried && bow !== "none";
  const cased = carried && bow === "novgorod_composite" && bowCase !== "none";
  const jewelryHidden = catalog.jewelry_hidden_by?.includes(outfit);
  for (const [select, { kind, field, definition, note }] of controls) {
    const automatic = definition.values[recipe?.[kind]?.[field]];
    let message = "";
    if (kind === "appearance" && select.value && outsideProfile(field, select.value)) {
      message = "Вне автонабора профиля";
    }
    if (jewelryHidden && field === "jewelry" && select.value && select.value !== "none") {
      message = "Доспех закрывает украшение";
    }
    if (field === "cloak") {
      message = catalog.cloak_coverage?.[cloak] ?? message;
    }
    if (field === "headgear") {
      message = catalog.headgear_coverage?.[headgear] ?? message;
    }
    const item = gear[field];
    if (kind === "equipment" && item && item !== "none" && handheldNames[field]) {
      if (field === "weapon" && (carried || item === "sheathed_sword")) {
        if (catalog.sheathed_weapons?.includes(item)) message = "В ножнах на левом бедре";
        else if (catalog.back_weapons?.includes(item)) message = "На перевязи за плечом";
        else message = "Подвешено у пояса";
      } else if (field === "bow" && carried) {
        message = cased ? "В налучье у пояса" : "За плечом, без тетивы";
      } else if (field === "shield" && gear.shield_carry === "back") {
        message = "На перевязи за спиной";
      } else if (field === "weapon" && holdingBow) {
        message = "Кисть занята луком";
      } else if (catalog.handheld_hidden_by?.[field]?.includes(cloak)) {
        message = `Плащ закрывает кисть и скрывает ${handheldNames[field]}`;
      }
    }
    if (kind === "equipment" && field === "bow_case" && cased && bowCase === undefined) {
      message = "Кожаное налучье с луком";
    }
    const estateWarning = kind === "equipment" && select.value && outsideEstate(field, select.value)
      ? "Вне сословного набора" : "";
    note.textContent = [!select.value && automatic, message, estateWarning].filter(Boolean).join(" · ");
    note.hidden = !note.textContent;
  }
}

function selection() {
  const payload = { ...sampleModes, seed: seed.value, generate: !presetControls, appearance: {}, equipment: {} };
  if (profile.value) payload.profile = profile.value;
  if (estate.value) payload.estate = estate.value;
  if (presetAccessory) payload.equipment.accessory = presetAccessory;
  for (const [select, { kind, field }] of controls) {
    if (select.value && !select.disabled) payload[kind][field] = select.value;
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
  const worker = new Worker("./renderer-worker.js?v=waist-crop", { name: "Rus13" });
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
      if (data.kind !== "rendered") throw new Error(data.error || "Проверьте настройки и попробуйте снова.");
      showArtwork(data.result);
      lastRecipe = data.result.recipe;
      updateOptions();
      updateNotes(lastRecipe);
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
  presetAccessory = example.payload.equipment?.accessory;
  for (const flag of ["extended", "expanded_hair", "distinct_bases", "cast_traits"]) {
    if (typeof example.payload[flag] === "boolean") sampleModes[flag] = example.payload[flag];
  }
  seed.value = example.payload.seed;
  profile.value = example.payload.profile ?? catalog.default_profile;
  estate.value = "";
  presetControls = new Set([profile, estate, ...controls.keys()]);
  for (const [select, { kind, field }] of controls) {
    const value = example.payload[kind]?.[field];
    select.value = value === "auto" ? "" : value ?? "";
  }
  setActiveExample(example.id);
  lastRecipe = example.recipe;
  updateOptions();
  updateNotes(lastRecipe);
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
    const response = await fetch("./studio.json?v=cultural-wardrobes");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { catalog: data, examples } = await response.json();
    profile.replaceChildren(new Option("По seed", ""));
    for (const [id, label] of Object.entries(data.profiles)) profile.append(new Option(label, id));
    estate.replaceChildren(new Option("По seed", ""));
    for (const [id, label] of Object.entries(data.estates)) estate.append(new Option(label, id));
    catalog = data;

    for (const field of ["cast", "age", "body"]) addField(primaryFields, "appearance", field);
    for (const field of ["outfit", "cloth_color", ...outfitDetailFields, "headgear", "background"]) {
      addField(primaryFields, "equipment", field);
    }
    for (const [title, fields] of groups) addGroup(title, "appearance", fields.split(" "));

    const assigned = new Set(Array.from(controls.values(), ({ field }) => field));
    addGroup("Другие черты", "appearance", Object.keys(catalog.appearance).filter(field => !assigned.has(field)));

    const groupsByLabel = new Map();
    for (const example of examples) {
      const picker = presetPickers.find(({ field }) => example[field]);
      if (picker) {
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
    updateOptions();
    scheduleRender();
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

function useAutomatic(changed) {
  if (!presetControls) return;
  for (const select of presetControls) {
    if (select !== changed) select.value = "";
  }
  presetControls = undefined;
  presetAccessory = undefined;
  sampleModes = {};
}

function reseed(delay = 0) {
  useAutomatic();
  updateOptions();
  scheduleRender(delay);
}

seed.addEventListener("input", () => reseed(180));
randomize.addEventListener("click", () => {
  seed.value = "rus13-" + Array.from(crypto.getRandomValues(new Uint32Array(2)), part => part.toString(36)).join("-");
  reseed();
});
editor.addEventListener("change", event => {
  const target = event.target;
  const control = controls.get(target);
  if (!control && target !== profile && target !== estate) return;
  if (target === profile || target === estate) useAutomatic(target);
  else presetControls?.delete(target);
  updateOptions();
  if (outfitDetailFields.includes(control?.field)) setPortraitView("full");
  scheduleRender();
});
reset.addEventListener("click", () => {
  useAutomatic();
  for (const select of [profile, estate, ...controls.keys()]) select.value = "";
  lastRecipe = undefined;
  updateOptions();
  scheduleRender();
});
retry.addEventListener("click", () => {
  if (catalog) scheduleRender();
  else loadCatalog();
});

const linkedSection = document.getElementById(window.location.hash.slice(1));
if (linkedSection instanceof HTMLDetailsElement) linkedSection.open = true;
loadCatalog();
