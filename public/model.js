export const categories = {
  RES: "Restaurants",
  COF: "Coffee & tea",
  DES: "Dessert",
  BAR: "Bars",
  BAK: "Bakeries",
  OTHER: "Saved places",
};
export const fold = (value) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const addedTime = (place) => {
  const timestamp = Date.parse(place.addedAt);
  return Number.isFinite(timestamp) ? timestamp : -Infinity;
};
const byRating = (a, b) => b.score - a.score || a.rank - b.rank;
export const isRated = (place) => Number.isFinite(place.score);

// Google's standard place IDs encode the feature CID in their last eight bytes.
// Match only those IDs; never collapse businesses just because names agree.
const placeCid = (placeId) => {
  try {
    const bytes = atob(placeId.replaceAll("-", "+").replaceAll("_", "/"));
    if (bytes.length !== 20 || !placeId.startsWith("ChIJ")) return "";
    return [...bytes.slice(-8)].reverse().map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").replace(/^0+/, "");
  } catch { return ""; }
};
export function mergeCollections(ranked, saved) {
  const byCid = new Map(saved.filter(p => p.googleCid).map(p => [p.googleCid, p]));
  const matched = new Set();
  const merged = ranked.map(p => {
    const match = byCid.get(placeCid(p.placeId || ""));
    if (!match) return p;
    matched.add(match.id);
    return { ...p, wantToGo: true, googleMapsUrl: match.googleMapsUrl };
  });
  return [...merged, ...saved.filter(p => !matched.has(p.id))];
}
export const defaultDirection = (sort) => sort === "name" ? "asc" : "desc";

export function filterPlaces(
  places,
  {
    query = "",
    category = "",
    city = "",
    cuisine = "",
    favorites = false,
    collection = "all",
    sort = "rank",
    direction = defaultDirection(sort),
  },
) {
  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  return places
    .filter((place) => {
      const text = fold(
        [
          place.name,
          place.city,
          place.country,
          place.neighborhood,
          ...place.cuisines,
        ].join(" "),
      );
      return (
        (collection !== "ranked" || isRated(place)) &&
        (collection !== "want" || place.wantToGo) &&
        (!category || place.category === category) &&
        (!city || place.city === city) &&
        (!cuisine || place.cuisines.includes(cuisine)) &&
        (!favorites || place.score >= 9) &&
        words.every((word) => text.includes(word))
      );
    })
    .sort((a, b) => {
      const multiplier = direction === "asc" ? 1 : -1;
      if (sort === "name")
        return multiplier * a.name.localeCompare(b.name) || a.rank - b.rank;
      if (sort === "recent") {
        const aTime = addedTime(a), bTime = addedTime(b);
        if (aTime !== bTime) {
          if (aTime === -Infinity) return 1;
          if (bTime === -Infinity) return -1;
          return multiplier * (aTime - bTime);
        }
        return byRating(a, b);
      }
      if (isRated(a) !== isRated(b)) return isRated(a) ? -1 : 1;
      if (!isRated(a)) return a.name.localeCompare(b.name);
      return multiplier * (a.score - b.score) || a.rank - b.rank;
    });
}

export const hasCoordinates = (p) =>
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lng) <= 180;
export const tier = (p) =>
  !isRated(p) ? "unrated" : p.score >= 9 ? "exceptional" : p.score >= 7 ? "great" : "other";
export const rating = (p) => isRated(p) ? p.score.toFixed(1) : "♡";
export const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
export const mapsURL = (p) =>
  safeURL(p.googleMapsUrl) || "https://www.google.com/maps/search/?" +
  new URLSearchParams({
    api: "1",
    query: `${p.name} ${p.city}`,
    ...(p.placeId ? { query_place_id: p.placeId } : {}),
  });
export function safeURL(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

export function toCSV(places) {
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^\s*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [
    [
      "category",
      "category_rank",
      "name",
      "rating",
      "city",
      "country",
      "cuisines",
      "latitude",
      "longitude",
      "google_maps_url",
      "added_at",
      "want_to_go",
    ],
    ...places.map((p) => [
      categories[p.category],
      p.rank,
      p.name,
      p.score,
      p.city,
      p.country,
      p.cuisines.join("; "),
      p.lat,
      p.lng,
      mapsURL(p),
      p.addedAt,
      p.wantToGo ? "yes" : "",
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
