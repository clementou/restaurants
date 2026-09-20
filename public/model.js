export const categories = {
  RES: "Restaurants",
  COF: "Coffee & tea",
  DES: "Dessert",
  BAR: "Bars",
  BAK: "Bakeries",
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
export const defaultDirection = (sort) => sort === "name" ? "asc" : "desc";

export function filterPlaces(
  places,
  {
    query = "",
    category = "",
    city = "",
    cuisine = "",
    favorites = false,
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
      return multiplier * (a.score - b.score) || a.rank - b.rank;
    });
}

export const hasCoordinates = (p) =>
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lng) <= 180;
export const tier = (p) =>
  p.score >= 9 ? "exceptional" : p.score >= 7 ? "great" : "other";
export const rating = (p) => p.score.toFixed(1);
export const escapeHTML = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
export const mapsURL = (p) =>
  "https://www.google.com/maps/search/?" +
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
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
