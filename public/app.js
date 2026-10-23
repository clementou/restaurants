import { cartoKey } from "./map-config.js";
import {
  categories,
  filterPlaces,
  mergeCollections,
  isRated,
  ratingDistribution,
  awardGroups,
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
  collection: ["all", "want"].includes(params.get("collection")) ? params.get("collection") : "ranked",
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
const dropdowns = [];
let distinctionsCheckedAt = "";
let distinctionSourceDates = {};
const awardListName = kind => kind === "world50bars" ? "Bars" : "Restaurants";

function awardBadges(place, links = false) {
  if (!place.awards?.length) return "";
  return `<span class="place-awards">${awardGroups(place.awards).map(({ kind, entries, best }) => {
    const award = entries[0];
    const label = award.kind === "michelin"
      ? (award.stars ? `Michelin ${"★".repeat(award.stars)}` : "Bib Gourmand")
      : `50 Best ${awardListName(kind)} #${award.rank} · ${award.year}`;
    const description = award.kind === "michelin"
      ? (award.stars ? `${award.stars} Michelin ${award.stars === 1 ? "star" : "stars"}` : "Michelin Bib Gourmand — good quality, good value cooking")
      : `The World’s 50 Best ${awardListName(kind)}: latest recorded appearance #${award.rank} in ${award.year}${award.rank > 50 ? " (51–100 extended list)" : ""}. ${entries.length} recorded editions; best recorded rank #${best.rank} (${best.year})`;
    const title = `${description}. Source checked ${distinctionSourceDates[kind] || distinctionsCheckedAt}.`;
    const url = safeURL(award.url);
    return links && url
      ? `<a class="award-badge ${esc(award.kind)}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}" aria-label="${esc(title)} Open source">${esc(label)} ↗</a>`
      : `<span class="award-badge ${esc(award.kind)}" title="${esc(title)}" aria-label="${esc(title)}">${esc(label)}</span>`;
  }).join("")}</span>`;
}

function awardHistory(place) {
  const groups = awardGroups(place.awards).filter(group => group.kind !== "michelin");
  if (!groups.length) return "";
  return `<details class="award-history"><summary>50 Best ranking history</summary><div class="award-history-scroll"><table><caption>Recorded appearances; each year links to its source.</caption><thead><tr><th scope="col">Year</th><th scope="col">World list</th><th scope="col">Rank</th></tr></thead><tbody>${groups.flatMap(group => group.entries).sort((a, b) => b.year - a.year || a.kind.localeCompare(b.kind)).map(a => `<tr><th scope="row"><a href="${esc(safeURL(a.url))}" target="_blank" rel="noopener noreferrer">${a.year} ↗</a></th><td>${awardListName(a.kind)}</td><td>#${a.rank}${a.rank > 50 ? ' <span class="sr-only">extended list</span>' : ""}</td></tr>`).join("")}</tbody></table></div><p>Historical recognition, independent of your visit date. Ranks 51–100 are included where available in the archive.</p></details>`;
}

function initDropdowns() {
  let closeOpen = () => {};
  for (const select of document.querySelectorAll("select")) {
    const label = select.closest("label");
    const name = label.querySelector(".sr-only").textContent;
    const wrapper = document.createElement("div");
    wrapper.className = "dropdown";
    label.replaceWith(wrapper);
    wrapper.append(select);
    select.hidden = true;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "dropdown-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const text = document.createElement("span");
    trigger.append(text);
    wrapper.append(trigger);
    const menu = document.createElement("div");
    menu.id = `${select.id}-menu`;
    menu.className = "dropdown-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", name);
    menu.hidden = true;
    document.body.append(menu);
    trigger.setAttribute("aria-controls", menu.id);
    let active = 0, typed = "", typedAt = 0;
    const options = Array.from(select.options, (option, index) => {
      const item = document.createElement("div");
      item.id = `${select.id}-option-${index}`;
      item.className = "dropdown-option";
      item.setAttribute("role", "option");
      item.textContent = option.textContent;
      item.addEventListener("mousedown", event => event.preventDefault());
      item.addEventListener("click", () => choose(index));
      menu.append(item);
      return item;
    });
    function sync() {
      text.textContent = select.selectedOptions[0]?.textContent || "";
      trigger.setAttribute("aria-label", `${name}: ${text.textContent}`);
      trigger.disabled = select.disabled;
      options.forEach((item, index) => item.setAttribute("aria-selected", String(index === select.selectedIndex)));
    }
    function highlight(index) {
      active = Math.max(0, Math.min(options.length - 1, index));
      options.forEach((item, i) => item.classList.toggle("active", i === active));
      trigger.setAttribute("aria-activedescendant", options[active].id);
      options[active].scrollIntoView({ block: "nearest" });
    }
    function close() {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      typed = "";
    }
    function open() {
      closeOpen();
      closeOpen = close;
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 210), innerWidth - 24);
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
      const below = innerHeight - rect.bottom - 18;
      const above = rect.top - 18;
      const up = below < 220 && above > below;
      menu.style.maxHeight = `${Math.max(60, Math.min(300, up ? above : below))}px`;
      menu.style.top = up ? "auto" : `${rect.bottom + 6}px`;
      menu.style.bottom = up ? `${innerHeight - rect.top + 6}px` : "auto";
      highlight(Math.max(0, select.selectedIndex));
    }
    function choose(index) {
      select.selectedIndex = index;
      close();
      select.dispatchEvent(new Event("change", { bubbles: true }));
      trigger.focus({ preventScroll: true });
    }
    trigger.addEventListener("click", () => menu.hidden ? open() : close());
    trigger.addEventListener("blur", close);
    trigger.addEventListener("keydown", event => {
      if (event.key === "Tab") { close(); return; }
      if (event.key === "Escape") { close(); event.preventDefault(); return; }
      if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        if (menu.hidden) { open(); return; }
        if (event.key === "Enter" || event.key === " ") choose(active);
        else highlight(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : active + (event.key === "ArrowDown" ? 1 : -1));
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (menu.hidden) open();
        typed = (Date.now() - typedAt > 700 ? "" : typed) + event.key.toLocaleLowerCase();
        typedAt = Date.now();
        const index = options.findIndex(item => item.textContent.toLocaleLowerCase().startsWith(typed));
        if (index >= 0) highlight(index);
      }
    });
    document.addEventListener("pointerdown", event => {
      if (!wrapper.contains(event.target) && !menu.contains(event.target)) close();
    });
    dropdowns.push({ sync });
    sync();
  }
  window.addEventListener("resize", () => closeOpen());
  document.addEventListener("scroll", event => {
    if (!event.target.closest?.(".dropdown-menu")) closeOpen();
  }, true);
}

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
  node.innerHTML = `<div class="popup-eyebrow">${isRated(place) ? `#${place.rank} · ${esc(categories[place.category]).toUpperCase()}` : "WANT TO GO"} <span class="score ${tier(place)}">${rating(place)}</span></div><h2>${esc(place.name)}</h2>${awardBadges(place, true)}<p>${esc([place.neighborhood, place.city, place.country].filter(Boolean).join(" · "))}</p><p>${esc(place.cuisines.join(" · "))}</p>${awardHistory(place)}<div class="popup-links"><a href="${esc(mapsURL(place))}" target="_blank" rel="noopener noreferrer">Google Maps ↗</a>${beli ? `<a href="${esc(beli)}" target="_blank" rel="noopener noreferrer">Beli ↗</a>` : ""}${website ? `<a href="${esc(website)}" target="_blank" rel="noopener noreferrer">Website ↗</a>` : ""}</div>`;
  node.addEventListener("toggle", () => map?.eachLayer(layer => layer.getPopup?.()?.isOpen() && layer.getPopup().update()), true);
  return node;
}

function selectPlace(id, fromMap = false) {
  const place = places.find((p) => String(p.id) === String(id));
  if (!place) return;
  id = place.id;
  selectedId = id;
  document.querySelectorAll(".place-row").forEach((row) => {
    const active = row.dataset.id === String(id);
    row.classList.toggle("selected", active);
    if (row.tagName === "BUTTON") row.setAttribute("aria-pressed", String(active));
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
  if (state.collection !== "ranked") query.set("collection", state.collection);
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

function renderDistribution() {
  if (!$("#rating-distribution").open) return;
  const { bins, count, mean, median } = ratingDistribution(filtered);
  const excluded = filtered.length - count;
  $("#distribution-stats").innerHTML = [
    ["Rated places", count.toLocaleString()],
    ["Average", mean === null ? "—" : mean.toFixed(2)],
    ["Median", median === null ? "—" : median.toFixed(2)],
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
  $("#distribution-context").textContent = count
    ? `${state.category ? categories[state.category] : "All categories"} · Current filters${excluded ? ` · ${excluded.toLocaleString()} unrated places excluded` : ""}`
    : "No rated places match these filters. Choose My rankings or clear your filters to see the distribution.";
  const label = bin => `${bin.start.toFixed(1)}–${bin.end.toFixed(1)}`;
  const detail = bin => `${label(bin)}${bin.end === 10 ? " (including 10)" : " (upper bound excluded)"}: ${bin.count} ${bin.count === 1 ? "place" : "places"} · ${count ? (100 * bin.count / count).toFixed(1) : "0.0"}%`;
  $("#distribution-table").innerHTML = bins.map(bin => `<tr><th scope="row">${label(bin)}</th><td>${bin.count}</td><td>${count ? (100 * bin.count / count).toFixed(1) : "0.0"}%</td></tr>`).join("");
  const hint = count ? "Hover, tap, or focus an interval to see its count." : "";
  $("#distribution-detail").textContent = hint;
  if (!count) { $("#distribution-chart").replaceChildren(); return; }
  const left = 42, width = 696, baseline = 164, height = 136;
  const peak = Math.max(...bins.map(bin => bin.count));
  const ceiling = Math.max(2, Math.ceil(peak / 2) * 2);
  const x = score => left + score / 10 * width;
  const y = value => baseline - value / ceiling * height;
  const points = bins.map(bin => [x((bin.start + bin.end) / 2), y(bin.count)]);
  const curve = points.map(([px, py], i) => {
    if (!i) return `M ${px} ${py}`;
    const [prevX, prevY] = points[i - 1], mid = (prevX + px) / 2;
    return `C ${mid} ${prevY}, ${mid} ${py}, ${px} ${py}`;
  }).join(" ");
  $("#distribution-chart").innerHTML = `<svg viewBox="0 0 760 210" role="group" aria-labelledby="distribution-svg-title distribution-svg-desc">
    <title id="distribution-svg-title">Rating distribution for ${count} places</title>
    <desc id="distribution-svg-desc">Number of places in half-point intervals from 0 to 10. Average ${mean.toFixed(2)}, median ${median.toFixed(2)}. Exact counts are available in the table below.</desc>
    <text x="${left}" y="14" class="chart-axis-label">Places</text>
    ${[0, ceiling / 2, ceiling].map(value => `<line class="chart-grid" x1="${left}" x2="${left + width}" y1="${y(value)}" y2="${y(value)}"/><text class="chart-tick" x="${left - 10}" y="${y(value) + 4}" text-anchor="end">${value}</text>`).join("")}
    ${bins.map(bin => `<rect class="chart-bar" x="${x(bin.start) + 2}" y="${y(bin.count)}" width="${width / 20 - 4}" height="${baseline - y(bin.count)}"/>`).join("")}
    <path class="chart-curve" d="${curve}"/>
    ${Array.from({ length: 11 }, (_, i) => `<text class="chart-tick" x="${x(i)}" y="183" text-anchor="middle">${i}</text>`).join("")}
    <text class="chart-axis-label" x="${left + width / 2}" y="204" text-anchor="middle">Rating / 10</text>
    ${bins.map((bin, i) => `<rect class="chart-hit" data-bin="${i}" tabindex="0" role="img" aria-label="${detail(bin)}" x="${x(bin.start)}" y="26" width="${width / 20}" height="${baseline - 26}"><title>${detail(bin)}</title></rect>`).join("")}
  </svg>`;
  const showDetail = event => {
    const hit = event.target.closest("[data-bin]");
    if (hit) $("#distribution-detail").textContent = detail(bins[Number(hit.dataset.bin)]);
  };
  const chart = $("#distribution-chart svg");
  for (const event of ["pointerover", "focusin", "click"])
    chart.addEventListener(event, showDetail);
}

function render({ updateMap = true } = {}) {
  filtered = filterPlaces(places, state);
  renderDistribution();
  $("#result-count").textContent =
    `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "place" : "places"}${filtered.length !== places.length ? ` of ${places.length}` : " to explore"}`;
  $("#favorites").setAttribute("aria-pressed", String(state.favorites));
  $("#category").value = state.category;
  $("#search").value = state.query;
  $("#city").value = state.city;
  $("#cuisine").value = state.cuisine;
  $("#sort").value = state.sort;
  $("#collection").value = state.collection;
  dropdowns.forEach(dropdown => dropdown.sync());
  const unpinned = filtered.filter(p => !hasCoordinates(p)).length;
  $("#collection-note").textContent = unpinned
    ? `${unpinned.toLocaleString()} places have no map location yet. Use their Google Maps links to view them.` : "";
  $("#collection-note").hidden = !unpinned;
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
          return `<${!hasCoordinates(place) ? `a href="${esc(mapsURL(place))}" target="_blank" rel="noopener noreferrer"` : "button"} class="place-row${selectedId === place.id ? " selected" : ""}" data-id="${place.id}" ${hasCoordinates(place) ? `aria-pressed="${selectedId === place.id}"` : ""}><span class="rank">${isRated(place) ? String(place.rank).padStart(2, "0") : ""}</span><span class="place-info"><span class="place-name">${esc(place.name)}</span>${awardBadges(place)}<span class="place-location">${esc([place.city, place.country].filter(Boolean).join(" · "))}</span><span class="place-cuisine">${esc([categories[place.category], ...place.cuisines.slice(0, 2), ...(place.wantToGo ? ["Want to go"] : [])].join(" · "))}${price ? `<span class="price">${esc(price)}</span>` : ""}${closed ? '<span class="closed">Closed</span>' : ""}</span>${state.sort === "recent" ? `<span class="place-location">${esc(addedDate)}</span>` : ""}</span><span class="score ${tier(place)}">${rating(place)}<span class="sr-only">${isRated(place) ? " out of 10" : "Want to go, not rated"}</span></span><span class="row-arrow" aria-hidden="true">↗</span></${!hasCoordinates(place) ? "a" : "button"}>`;
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
    collection: "ranked",
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
  const savedResponse = await fetch(new URL("./google-maps.json", import.meta.url));
  if (!savedResponse.ok) throw new Error("Could not load saved places");
  const saved = await savedResponse.json();
  places = mergeCollections(data.places, saved.places);
  try {
    const response = await fetch(new URL("./distinctions.json", import.meta.url));
    if (!response.ok) throw new Error("Distinctions unavailable");
    const distinctions = await response.json();
    distinctionsCheckedAt = new Date(distinctions.checkedAt).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
    });
    distinctionSourceDates = Object.fromEntries(Object.entries(distinctions.sourceCheckedAt || {}).map(([kind, date]) => [kind, new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })]));
    places = places.map(place => ({ ...place, awards: distinctions.places[place.id] || [] }));
    const coverage = Object.entries(distinctions.coverage || {}).map(([kind, editions]) => `${awardListName(kind)} ${editions[0].year}–${editions.at(-1).year} (${editions.length} editions)`).join("; ");
    $("#distinctions-note").textContent = `50 Best history checked ${distinctionsCheckedAt} (UTC): ${coverage}. Michelin snapshot checked ${distinctionSourceDates.michelin || distinctionsCheckedAt}. Saved places without a verified location may have no badge.`;
  } catch {
    $("#distinctions-note").textContent = "Restaurant distinctions are temporarily unavailable. Your personal ratings are still shown.";
  }
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
  $("#rating-distribution").addEventListener("toggle", renderDistribution);
  $("#search").addEventListener("input", (event) => {
    state.query = event.target.value;
    render();
  });
  $("#collection").addEventListener("change", (event) => {
    state.collection = event.target.value;
    state.category = "";
    state.city = "";
    state.cuisine = "";
    state.favorites = false;
    state.sort = state.collection === "want" ? "name" : "rank";
    state.direction = defaultDirection(state.sort);
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
    if (row?.tagName === "BUTTON") selectPlace(row.dataset.id);
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
  $("#sort").disabled = false;
  $("#sort-direction").disabled = false;
  initDropdowns();
}

init().catch(() => {
  $("#result-count").textContent = "Collection unavailable";
  $("#updated").textContent = "Unable to load collection";
  $("#places").innerHTML =
    '<div class="empty-state"><h2>Couldn’t set the table.</h2><p>Refresh the page to try again, or download the CSV above.</p><button id="retry">Try again</button></div>';
  $("#retry").addEventListener("click", () => location.reload());
});
