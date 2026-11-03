const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const MITCHELL = { lat: 43.71, lng: -98.03, zoom: 9 };
const MARK_GROUPS = ["Body", "Fins & tail", "Mouth & head", "Eye"];

const state = {
  view: "map",
  region: "all",
  species: "all",
  queries: { map: "", guide: "" },
  marks: new Set(),
  origin: null,
};

let map = null;
let mapReady = false;
let markers = [];
const markerById = new Map();
let hereMarker = null;
let pendingMapId = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function speciesById(id) {
  return CASTSD.species.find((species) => species.id === id);
}

function speciesName(id) {
  return speciesById(id)?.name || id;
}

function waterById(id) {
  return CASTSD.waters.find((water) => water.id === id);
}

function plural(count, singular, pluralWord) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function milesBetween(a, b) {
  const earth = 3958.8;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatMiles(miles) {
  if (miles < 1) return "<1 mi";
  return `${Math.round(miles)} mi`;
}

function handbookLink() {
  return `<a href="${CASTSD.handbook}">See SD GFP handbook</a>`;
}

function limitsHtml(species) {
  const limits = species.limits;
  if (!limits || (limits.daily == null && limits.possession == null && !limits.note)) {
    return handbookLink();
  }
  const parts = [];
  if (limits.daily != null) parts.push(`Daily ${limits.daily}`);
  if (limits.possession != null) parts.push(`possession ${limits.possession}`);
  const note = limits.note ? `${parts.length ? ". " : ""}${limits.note}` : "";
  return `${escapeHtml(parts.join(" · "))}${escapeHtml(note)} ${handbookLink()}`;
}

function filteredWaters() {
  const query = state.queries.map.trim().toLowerCase();
  const list = CASTSD.waters.filter((water) => {
    const regionOk = state.region === "all" || water.region === state.region;
    const speciesOk = state.species === "all" || water.species.includes(state.species);
    const haystack = [
      water.name,
      water.county,
      water.kind,
      water.region,
      water.species.map(speciesName).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return regionOk && speciesOk && (!query || haystack.includes(query));
  });

  if (!state.origin) return list;
  return list
    .map((water) => ({ water, miles: milesBetween(state.origin, water) }))
    .sort((a, b) => a.miles - b.miles)
    .map((entry) => entry.water);
}

function setView(name) {
  state.view = name;
  $$(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === name));
  $$(".tab").forEach((tab) => {
    const on = tab.dataset.view === name;
    tab.classList.toggle("on", on);
    if (on) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  if (name === "map" && map) setTimeout(() => map.invalidateSize(), 80);
}

function hidePanel() {
  const panel = $("#detail");
  panel.classList.remove("open");
  panel.innerHTML = "";
}

function renderPanel(kind, id) {
  if (kind === "water") renderWater(id);
  else renderSpeciesDetail(id);
}

function openPanel(kind, id) {
  renderPanel(kind, id);
  const current = history.state;
  if (!current || current.castsd !== kind || current.id !== id) {
    history.pushState({ castsd: kind, id }, "", `#${kind}-${id}`);
  }
}

function closePanelFromUI() {
  if (history.state && history.state.castsd && history.length > 1) {
    history.back();
    return;
  }
  history.replaceState(null, "", location.pathname + location.search);
  hidePanel();
}

function renderWater(id) {
  const water = waterById(id);
  const panel = $("#detail");
  if (!water) {
    hidePanel();
    return;
  }
  const miles = state.origin ? formatMiles(milesBetween(state.origin, water)) : "";
  const alert = water.alert
    ? `<p class="alert-banner">${escapeHtml(water.alert)}</p>`
    : "";
  const access = water.access
    ? `<div class="fact"><b>Public access</b>${escapeHtml(water.access)}</div>`
    : "";
  panel.classList.add("open");
  panel.innerHTML = `
    <button class="back" type="button">Back</button>
    <p class="kicker">${escapeHtml(water.region)} · ${escapeHtml(water.kind)}</p>
    <h1>${escapeHtml(water.name)}</h1>
    <p class="latin">${escapeHtml(water.county)}</p>
    ${alert}
    <p class="prose">${escapeHtml(water.notes)}</p>
    <div class="badges">
      <span class="badge">${escapeHtml(water.acres)} ac</span>
      <span class="badge">Checked ${escapeHtml(water.checked)}</span>
      ${miles ? `<span class="badge">${escapeHtml(miles)}</span>` : ""}
    </div>
    <div class="grid-facts">
      ${access}
      <div class="fact"><b>Species in this guide</b>${water.species.map((speciesId) => escapeHtml(speciesName(speciesId))).join(" · ")}</div>
      <div class="fact"><b>Source</b><a href="${water.sourceUrl}">${escapeHtml(water.source)}</a></div>
      <div class="fact"><b>Field note</b>Confirm seasons and limits in the ${handbookLink()} before you keep fish.</div>
    </div>
    <div class="id-actions">
      <button class="primary" type="button" data-show-map="${escapeHtml(water.id)}">Show on map</button>
      <a class="ghost" href="https://www.google.com/maps/dir/?api=1&destination=${water.lat},${water.lng}" target="_blank" rel="noopener">Directions</a>
    </div>`;
  panel.querySelector(".back").addEventListener("click", closePanelFromUI);
  panel.querySelector("[data-show-map]").addEventListener("click", () => showOnMap(water.id));
}

function renderSpeciesDetail(id) {
  const species = speciesById(id);
  const panel = $("#detail");
  if (!species) {
    hidePanel();
    return;
  }
  const waters = CASTSD.waters.filter((water) => water.species.includes(id));
  const markLabels = species.marks
    .map((markId) => CASTSD.marks.find((mark) => mark.id === markId)?.label || markId)
    .map(escapeHtml)
    .join(" · ");
  panel.classList.add("open");
  panel.innerHTML = `
    <button class="back" type="button">Back</button>
    <p class="kicker">${escapeHtml(species.group)}</p>
    <h1>${escapeHtml(species.name)}</h1>
    <p class="latin">${escapeHtml(species.latin)}</p>
    <p class="prose">${escapeHtml(species.sd)}</p>
    <div class="grid-facts">
      <div class="fact"><b>Field marks</b>${markLabels}</div>
      <div class="fact"><b>Where it lives</b>${escapeHtml(species.habitat)}</div>
      <div class="fact"><b>How to fish it</b>${escapeHtml(species.how)}</div>
      <div class="fact"><b>Season</b>${escapeHtml(species.season)}</div>
      <div class="fact"><b>Statewide limit</b>${limitsHtml(species)}</div>
      <div class="fact"><b>Waters in this guide</b>${waters.length ? waters.map((water) => escapeHtml(water.name)).join(" · ") : handbookLink()}</div>
    </div>`;
  panel.querySelector(".back").addEventListener("click", closePanelFromUI);
}

function showOnMap(id) {
  pendingMapId = id;
  if (history.state && history.state.castsd) history.back();
  else focusWater(id);
}

function focusWater(id) {
  pendingMapId = null;
  hidePanel();
  setView("map");
  const water = waterById(id);
  if (!map || !water) return;
  map.setView([water.lat, water.lng], 12);
  const marker = markerById.get(id);
  if (marker) {
    window.setTimeout(() => marker.openPopup(), 80);
    return;
  }
  const popup = L.popup({
    closeButton: true,
    autoPanPaddingTopLeft: [16, 96],
    autoPanPaddingBottomRight: [16, 24],
  })
    .setLatLng([water.lat, water.lng])
    .setContent(popupHtml(water))
    .openOn(map);
  const button = popup.getElement()?.querySelector(".popup-go");
  if (button) button.onclick = () => openPanel("water", water.id);
}

function popupHtml(water) {
  return `<p class="popup-name">${escapeHtml(water.name)}</p><p class="popup-sub">${escapeHtml(water.kind)}</p><button class="popup-go" type="button">Open field card</button>`;
}

function fitWaters(list) {
  if (!map || !list.length) return;
  const bounds = L.latLngBounds(list.map((water) => [water.lat, water.lng]));
  map.fitBounds(bounds, {
    paddingTopLeft: [28, 72],
    paddingBottomRight: [28, 28],
    maxZoom: 11,
  });
}

function renderWaters() {
  const list = filteredWaters();
  $("#water-count").textContent = plural(list.length, "water", "waters");
  if (!list.length) {
    $("#water-list").innerHTML = `<p class="empty">No waters match.</p>`;
  } else {
    $("#water-list").innerHTML = list
      .map((water) => {
        const miles = state.origin ? `<span class="badge">${formatMiles(milesBetween(state.origin, water))}</span>` : "";
        const alert = water.alert ? `<span class="badge alert">${escapeHtml(water.alert)}</span>` : "";
        return `<button class="water-card" data-water="${escapeHtml(water.id)}" type="button">
          <h3>${escapeHtml(water.name)}</h3>
          <div class="meta">${escapeHtml(water.kind)} · ${escapeHtml(water.county)}</div>
          <div class="badges">
            <span class="badge">${escapeHtml(water.acres)} ac</span>
            <span class="badge">Checked ${escapeHtml(water.checked)}</span>
            <span class="badge">SD GFP</span>
            ${miles}
            ${alert}
          </div>
          <div class="tags">${water.species
            .slice(0, 4)
            .map((id) => `<span class="tag">${escapeHtml(speciesName(id))}</span>`)
            .join("")}</div>
        </button>`;
      })
      .join("");
  }

  if (!map) return;
  markers.forEach((marker) => map.removeLayer(marker));
  markers = [];
  markerById.clear();
  list.forEach((water) => {
    const marker = L.circleMarker([water.lat, water.lng], {
      radius: 7,
      color: "#1a2420",
      weight: 1,
      fillColor: "#c4a574",
      fillOpacity: 0.95,
    }).addTo(map);
    marker.bindPopup(popupHtml(water), {
      autoPan: true,
      autoPanPaddingTopLeft: [16, 96],
      autoPanPaddingBottomRight: [16, 24],
    });
    marker.on("popupopen", () => {
      const button = marker.getPopup().getElement()?.querySelector(".popup-go");
      if (button) button.onclick = () => openPanel("water", water.id);
    });
    markers.push(marker);
    markerById.set(water.id, marker);
  });
}

function renderSpecies() {
  const query = state.queries.guide.trim().toLowerCase();
  const list = CASTSD.species.filter((species) => {
    if (!query) return true;
    return `${species.name} ${species.latin} ${species.group}`.toLowerCase().includes(query);
  });
  if (!list.length) {
    $("#species-grid").innerHTML = `<p class="empty">No species match.</p>`;
    return;
  }
  $("#species-grid").innerHTML = list
    .map(
      (species) => `<button class="sp-card" data-sp="${escapeHtml(species.id)}" type="button">
        <h3>${escapeHtml(species.name)}</h3>
        <div class="meta">${escapeHtml(species.latin)}</div>
        <div class="tags"><span class="tag">${escapeHtml(species.group)}</span></div>
      </button>`
    )
    .join("");
}

function renderMarks() {
  const byGroup = new Map(MARK_GROUPS.map((group) => [group, []]));
  CASTSD.marks.forEach((mark) => {
    if (!byGroup.has(mark.group)) byGroup.set(mark.group, []);
    byGroup.get(mark.group).push(mark);
  });
  $("#marks").innerHTML = MARK_GROUPS.map((group) => {
    const chips = (byGroup.get(group) || [])
      .map((mark) => {
        const on = state.marks.has(mark.id);
        return `<button class="mark-chip${on ? " on" : ""}" type="button" data-mark="${escapeHtml(mark.id)}" aria-pressed="${on ? "true" : "false"}">${escapeHtml(mark.label)}</button>`;
      })
      .join("");
    return `<section class="mark-group"><h3>${escapeHtml(group)}</h3><div class="marks">${chips}</div></section>`;
  }).join("");
}

function scoreId() {
  const picked = [...state.marks];
  const box = $("#id-result");
  box.classList.add("show");
  if (!picked.length) {
    box.innerHTML = `<p class="low-conf">Low confidence — check with <a href="${CASTSD.handbook}">SD GFP</a></p>`;
    return;
  }

  const ranked = CASTSD.species
    .map((species) => ({
      species,
      hits: species.marks.filter((markId) => picked.includes(markId)).length,
    }))
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.species.name.localeCompare(b.species.name))
    .slice(0, 3);

  const low = !ranked.length || ranked[0].hits < 2;
  const rows = ranked
    .map(
      (entry) => `<button class="rank" type="button" data-sp="${escapeHtml(entry.species.id)}">
        <span>${escapeHtml(entry.species.name)}<br><small class="meta">${entry.hits} of ${picked.length} marks match</small></span>
      </button>`
    )
    .join("");
  box.innerHTML = `${low ? `<p class="low-conf">Low confidence — check with <a href="${CASTSD.handbook}">SD GFP</a></p>` : ""}
    <p class="kicker">Field match</p>
    <h2 class="result-title">Most likely</h2>
    ${rows || ""}
    <p class="prose result-note">Field-guide matcher, not a lab ID. The photo is for your reference and is not scored.</p>`;
}

function showMapMessage(text) {
  const status = $("#map-status");
  status.hidden = false;
  status.textContent = text;
}

function hideMapMessage() {
  if (!mapReady) return;
  $("#map-status").hidden = true;
}

function initMap() {
  if (typeof L === "undefined") throw new Error("Leaflet failed to load");
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "vendor/leaflet/images/marker-icon-2x.png",
    iconUrl: "vendor/leaflet/images/marker-icon.png",
    shadowUrl: "vendor/leaflet/images/marker-shadow.png",
  });
  map = L.map("map", { zoomControl: false }).setView([MITCHELL.lat, MITCHELL.lng], MITCHELL.zoom);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap",
    maxZoom: 19,
  }).addTo(map);
  mapReady = true;
  renderWaters();
  if (!navigator.onLine) showMapMessage("Map unavailable offline");
  window.addEventListener("offline", () => showMapMessage("Map unavailable offline"));
  window.addEventListener("online", hideMapMessage);
}

function fillSpeciesFilter() {
  const select = $("#species-filter");
  const options = CASTSD.species
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((species) => `<option value="${escapeHtml(species.id)}">${escapeHtml(species.name)}</option>`)
    .join("");
  select.innerHTML = `<option value="all">All species</option>${options}`;
}

function setRegion(region, chip) {
  state.region = region;
  $$(".filter-chip").forEach((button) => {
    const on = button === chip;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
  renderWaters();
  if (region === "all" && state.species === "all" && !state.queries.map) {
    if (map) map.setView([MITCHELL.lat, MITCHELL.lng], MITCHELL.zoom);
    return;
  }
  fitWaters(filteredWaters());
}

function onLocate() {
  const message = $("#locate-msg");
  if (!navigator.geolocation) {
    message.textContent = "Location unavailable.";
    return;
  }
  message.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.origin = { lat: position.coords.latitude, lng: position.coords.longitude };
      message.textContent = "";
      if (map) {
        if (hereMarker) map.removeLayer(hereMarker);
        hereMarker = L.circleMarker([state.origin.lat, state.origin.lng], {
          radius: 8,
          color: "#efe6d4",
          weight: 3,
          fillColor: "#7aa39a",
          fillOpacity: 1,
        }).addTo(map);
        hereMarker.bindPopup("You are here", { autoPan: false });
        map.setView([state.origin.lat, state.origin.lng], Math.max(map.getZoom(), 9));
        window.setTimeout(() => {
          if (!hereMarker) return;
          hereMarker.openPopup();
          const popup = hereMarker.getPopup()?.getElement();
          const overlay = document.querySelector(".map-overlay");
          if (!popup || !overlay) return;
          const overlap = overlay.getBoundingClientRect().bottom - popup.getBoundingClientRect().top + 8;
          if (overlap > 0) map.panBy([0, -overlap], { animate: false });
        }, 280);
      }
      renderWaters();
    },
    (error) => {
      if (error && error.code === 1) {
        message.textContent = "Location denied. Allow location to sort waters by distance.";
        return;
      }
      message.textContent = "Location unavailable.";
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

function restoreFromLocation() {
  const match = location.hash.match(/^#(water|species)-([a-z0-9-]+)$/);
  if (!match) return;
  const id = match[2];
  const kind = match[1];
  if (kind === "water" && !waterById(id)) return;
  if (kind === "species" && !speciesById(id)) return;
  renderPanel(kind, id);
  history.replaceState({ castsd: kind, id }, "", location.hash);
}

function bind() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      setView(tab.dataset.view);
      if (tab.dataset.view === "guide") renderSpecies();
      if (tab.dataset.view === "map") renderWaters();
    });
  });

  $("#q-map").addEventListener("input", (event) => {
    state.queries.map = event.target.value;
    renderWaters();
  });
  $("#q-guide").addEventListener("input", (event) => {
    state.queries.guide = event.target.value;
    renderSpecies();
  });

  $$(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => setRegion(chip.dataset.region, chip));
  });

  $("#species-filter").addEventListener("change", (event) => {
    state.species = event.target.value;
    renderWaters();
    fitWaters(filteredWaters());
  });

  $("#water-list").addEventListener("click", (event) => {
    const card = event.target.closest("[data-water]");
    if (card) openPanel("water", card.dataset.water);
  });
  $("#species-grid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-sp]");
    if (card) openPanel("species", card.dataset.sp);
  });
  $("#id-result").addEventListener("click", (event) => {
    const row = event.target.closest("[data-sp]");
    if (row) openPanel("species", row.dataset.sp);
  });
  $("#marks").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-mark]");
    if (!chip) return;
    const markId = chip.dataset.mark;
    if (state.marks.has(markId)) state.marks.delete(markId);
    else state.marks.add(markId);
    renderMarks();
    scoreId();
  });

  $("#photo").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const image = $("#preview");
    image.src = url;
    image.alt = "for your reference — not analyzed yet";
    image.hidden = false;
    $("#drop-copy").hidden = true;
    $("#photo-note").hidden = false;
  });

  $("#locate").addEventListener("click", onLocate);

  window.addEventListener("popstate", () => {
    if (pendingMapId) {
      const id = pendingMapId;
      pendingMapId = null;
      focusWater(id);
      return;
    }
    const next = history.state;
    if (next && next.castsd) renderPanel(next.castsd, next.id);
    else hidePanel();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("#detail").classList.contains("open")) closePanelFromUI();
  });
}

function init() {
  fillSpeciesFilter();
  renderMarks();
  renderSpecies();
  try {
    initMap();
  } catch (error) {
    console.error(error);
    map = null;
    mapReady = false;
    showMapMessage("Map unavailable offline");
    renderWaters();
  }
  bind();
  restoreFromLocation();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

document.addEventListener("DOMContentLoaded", init);
