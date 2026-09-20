import { cartoKey } from "./map-config.js";
import {
  categories,
  filterPlaces,
  defaultDirection,
  hasCoordinates,
  tier,
  rating,
  escapeHTML as esc,
  mapsURL,
  safeURL,
  toCSV,
} from "./model.js";

const $ = (selector) => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const state = {
  query: params.get("q") || "",
  category: params.get("category") || "",
  city: params.get("city") || "",
  cuisine: params.get("cuisine") || "",
  favorites: params.get("top") === "1",
  sort: ["name", "recent"].includes(params.get("sort")) ? params.get("sort") : "rank",
};
state.direction = ["asc", "desc"].includes(params.get("direction"))
  ? params.get("direction") : defaultDirection(state.sort);
let places = [],
  filtered = [],
  map,
  clusters,
  selectedId = null;
const markers = new Map();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function initMap() {
  if (!window.L) {
    $("#map-error").hidden = false;
    return;
  }
  map = L.map("map", {
    zoomControl: false,
    scrollWheelZoom: true,
    minZoom: 2,
    maxZoom: 19,
    worldCopyJump: true,
  }).setView([28, 0], 2);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  const tiles = L.tileLayer(
    `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey)}`,
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    },
  ).addTo(map);
  tiles.on("tileerror", () => {
    $("#map-error").hidden = false;
  });
  tiles.on("tileload", () => {
    $("#map-error").hidden = true;
  });
  clusters = L.markerClusterGroup({
    maxClusterRadius: 42,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    animate: !reducedMotion,
    iconCreateFunction: (cluster) =>
      L.divIcon({
        html: `<span>${cluster.getChildCount()}</span>`,
        className: "cluster-pin",
        iconSize: [42, 42],
      }),
  }).addTo(map);
}

function popupContent(place) {
  const node = document.createElement("div");
  const website = safeURL(place.website),
    beli = safeURL(place.beliUrl);
  node.className = "place-popup";
  node.innerHTML = `<div class="popup-eyebrow">#${place.rank} · ${esc(categories[place.category]).toUpperCase()} <span class="score ${tier(place)}">${rating(place)}</span></div><h2>${esc(place.name)}</h2><p>${esc([place.neighborhood, place.city, place.country].filter(Boolean).join(" · "))}</p><p>${esc(place.cuisines.join(" · "))}</p><div class="popup-links"><a href="${esc(mapsURL(place))}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>${beli ? `<a href="${esc(beli)}" target="_blank" rel="noopener noreferrer">Beli ↗</a>` : ""}${website ? `<a href="${esc(website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>` : ""}</div>`;
  return node;
}

function selectPlace(id, fromMap = false) {
  const place = places.find((p) => p.id === id);
  if (!place) return;
  selectedId = id;
  document.querySelectorAll(".place-row").forEach((row) => {
    const active = Number(row.dataset.id) === id;
    row.classList.toggle("selected", active);
    row.setAttribute("aria-pressed", String(active));
  });
  if (fromMap) {
    const row = $(`.place-row[data-id="${id}"]`);
    if (row)
      $("#places").scrollTo({
        top: row.offsetTop - $("#places").offsetTop - 10,
        behavior: reducedMotion ? "instant" : "smooth",
      });
  } else if (map && markers.has(id)) {
    if (matchMedia("(max-width: 800px)").matches) setView("map");
    const marker = markers.get(id);
    // Wait for the mobile map panel to have dimensions before revealing a pin.
    requestAnimationFrame(() => {
      map.invalidateSize();
      map.setView(marker.getLatLng(), 15, { animate: false });
      clusters.zoomToShowLayer(marker, () => marker.openPopup());
    });
  }
}

function fitMap() {
  if (!map) return;
  const points = filtered.filter(hasCoordinates).map((p) => [p.lat, p.lng]);
  if (points.length)
    map.fitBounds(points, {
      padding: [65, 75],
      maxZoom: 14,
      animate: !reducedMotion,
    });
}

function renderMap() {
  if (!map) return;
  clusters.clearLayers();
  markers.clear();
  for (const place of filtered.filter(hasCoordinates)) {
    const marker = L.marker([place.lat, place.lng], {
      icon: L.divIcon({
        html: `<span>${rating(place)}</span>`,
        className: `rating-pin ${tier(place)}`,
        iconSize: [42, 29],
        iconAnchor: [21, 29],
      }),
      title: `${place.name} — ${rating(place)} / 10`,
      alt: `${place.name}, rated ${rating(place)}`,
    }).bindPopup(popupContent(place), { maxWidth: 290, minWidth: 230 });
    marker.on("click", () => selectPlace(place.id, true));
    markers.set(place.id, marker);
  }
  clusters.addLayers([...markers.values()]);
  fitMap();
}

function saveQuery() {
  const query = new URLSearchParams();
  if (state.query) query.set("q", state.query);
  if (state.category) query.set("category", state.category);
  if (state.city) query.set("city", state.city);
  if (state.cuisine) query.set("cuisine", state.cuisine);
  if (state.favorites) query.set("top", "1");
  if (state.sort !== "rank") query.set("sort", state.sort);
  if (state.direction !== defaultDirection(state.sort)) query.set("direction", state.direction);
  history.replaceState(
    null,
    "",
    location.pathname + (query.size ? "?" + query : "") + location.hash,
  );
}

function render({ updateMap = true } = {}) {
  filtered = filterPlaces(places, state);
  $("#result-count").textContent =
    `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "place" : "places"}${filtered.length !== places.length ? ` of ${places.length}` : " to explore"}`;
  $("#favorites").setAttribute("aria-pressed", String(state.favorites));
  $("#category").value = state.category;
  $("#search").value = state.query;
  $("#city").value = state.city;
  $("#cuisine").value = state.cuisine;
  $("#sort").value = state.sort;
  const ascending = state.direction === "asc";
  const directionLabel = state.sort === "recent"
    ? (ascending ? "Oldest first" : "Newest first")
    : state.sort === "name"
      ? (ascending ? "A–Z" : "Z–A")
      : (ascending ? "Lowest first" : "Highest first");
  $("#sort-direction").dataset.direction = state.direction;
  $("#sort-direction").title = directionLabel;
  $("#sort-direction").setAttribute("aria-label", `${directionLabel}. Switch to ${ascending ? "descending" : "ascending"} order`);
  document
    .querySelectorAll(".city-chip")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.city === state.city),
      ),
    );
  $("#places").innerHTML = filtered.length
    ? filtered
        .map((place) => {
          const price =
            Number.isInteger(place.price) && place.price > 0 && place.price <= 4
              ? place.currency.repeat(place.price)
              : "";
          const closed =
            place.status === "CLOSED_PERMANENTLY" ||
            place.status === "CLOSED_TEMPORARILY";
          const addedDate = Number.isFinite(Date.parse(place.addedAt))
            ? "Added " + new Date(place.addedAt).toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric",
              })
            : "Added date unavailable";
          return `<button class="place-row${selectedId === place.id ? " selected" : ""}" data-id="${place.id}" aria-pressed="${selectedId === place.id}"><span class="rank">${String(place.rank).padStart(2, "0")}</span><span class="place-info"><span class="place-name">${esc(place.name)}${place.rank <= 3 ? '<span class="top-star" aria-label="Top three">✳</span>' : ""}</span><span class="place-location">${esc([place.city, place.country].filter(Boolean).join(" · "))}</span><span class="place-cuisine">${esc([categories[place.category], ...place.cuisines.slice(0, 2)].join(" · "))}${price ? `<span class="price">${esc(price)}</span>` : ""}${closed ? '<span class="closed">Closed</span>' : ""}</span>${state.sort === "recent" ? `<span class="place-location">${esc(addedDate)}</span>` : ""}</span><span class="score ${tier(place)}">${rating(place)}<span class="sr-only"> out of 10</span></span><span class="row-arrow" aria-hidden="true">↗</span></button>`;
        })
        .join("")
    : '<div class="empty-state"><span aria-hidden="true">∅</span><h2>No places at this table.</h2><p>Try another search or clear your filters.</p><button id="empty-reset">Show all restaurants</button></div>';
  $("#places").scrollTop = 0;
  $("#empty-reset")?.addEventListener("click", reset);
  if (updateMap) renderMap();
  saveQuery();
}

function reset() {
  Object.assign(state, {
    query: "",
    category: "",
    city: "",
    cuisine: "",
    favorites: false,
    sort: "rank",
    direction: "desc",
  });
  selectedId = null;
  render();
}

function setView(view) {
  $(".workspace").dataset.view = view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    if (button.tagName === "BUTTON")
      button.setAttribute("aria-pressed", String(button.dataset.view === view));
  });
  if (view === "map")
    requestAnimationFrame(() => {
      map?.invalidateSize();
    });
}

async function init() {
  const response = await fetch(new URL("./data.json", import.meta.url));
  if (!response.ok) throw new Error("Could not load restaurant data");
  const data = await response.json();
  places = data.places;
  $("#total").textContent = places.length.toLocaleString();
  $("#countries").textContent = new Set(
    places.map((p) => p.country).filter(Boolean),
  ).size;
  $("#updated").textContent =
    "Updated " +
    new Date(data.updatedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  for (const [code, label] of Object.entries(categories)) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = label;
    $("#category").append(option);
  }
  if (!(state.category in categories)) state.category = "";
  for (const [selector, values] of [
    ["#city", places.map((p) => p.city)],
    ["#cuisine", places.flatMap((p) => p.cuisines)],
  ]) {
    for (const value of [...new Set(values)]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      $(selector).append(option);
    }
  }
  if (![...$("#city").options].some((o) => o.value === state.city))
    state.city = "";
  if (![...$("#cuisine").options].some((o) => o.value === state.cuisine))
    state.cuisine = "";
  $("#quick-cities").innerHTML = [
    "",
    "San Francisco, CA",
    "Palo Alto, CA",
    "New York, NY",
    "Paris",
  ]
    .filter((city) => !city || places.some((p) => p.city === city))
    .map(
      (city) =>
        `<button class="city-chip" data-city="${esc(city)}" aria-pressed="false">${esc(city ? city.replace(/, [A-Z]{2}$/, "") : "Everywhere")}</button>`,
    )
    .join("");
  try {
    initMap();
  } catch {
    $("#map-error").hidden = false;
    map?.remove();
    map = null;
  }
  render();
  $("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });
  $("#category").addEventListener("change", (event) => {
    state.category = event.target.value;
    render();
  });
  $("#city").addEventListener("change", (event) => {
    state.city = event.target.value;
    render();
  });
  $("#cuisine").addEventListener("change", (event) => {
    state.cuisine = event.target.value;
    render();
  });
  $("#sort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    state.direction = defaultDirection(state.sort);
    render({ updateMap: false });
  });
  $("#sort-direction").addEventListener("click", () => {
    state.direction = state.direction === "asc" ? "desc" : "asc";
    render({ updateMap: false });
  });
  $("#favorites").addEventListener("click", () => {
    state.favorites = !state.favorites;
    render();
  });
  $("#reset").addEventListener("click", reset);
  $("#fit-map").addEventListener("click", fitMap);
  $("#places").addEventListener("click", (event) => {
    const row = event.target.closest("[data-id]");
    if (row) selectPlace(Number(row.dataset.id));
  });
  $("#quick-cities").addEventListener("click", (event) => {
    const button = event.target.closest("[data-city]");
    if (button) {
      state.city = button.dataset.city;
      render();
    }
  });
  document.querySelectorAll(".view-switch button").forEach((button) =>
    button.addEventListener("click", () => {
      setView(button.dataset.view);
      if (button.dataset.view === "map") requestAnimationFrame(fitMap);
    }),
  );
  $(".export-link").addEventListener("click", (event) => {
    event.preventDefault();
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + toCSV(filtered)], {
        type: "text/csv;charset=utf-8;",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "clement-restaurants.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener("resize", () => map?.invalidateSize());
}

init().catch(() => {
  $("#result-count").textContent = "Collection unavailable";
  $("#updated").textContent = "Unable to load collection";
  $("#places").innerHTML =
    '<div class="empty-state"><h2>Couldn’t set the table.</h2><p>Refresh the page to try again, or download the CSV above.</p><button id="retry">Try again</button></div>';
  $("#retry").addEventListener("click", () => location.reload());
});
