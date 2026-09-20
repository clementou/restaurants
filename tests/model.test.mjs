import test from "node:test";
import assert from "node:assert/strict";
import {
  filterPlaces,
  toCSV,
  safeURL,
  hasCoordinates,
  mergeCollections,
  rating,
} from "../public/model.js";

const places = [
  {
    id: 1,
    category: "RES",
    rank: 1,
    score: 9.8,
    name: 'Café, "One"',
    city: "Paris",
    country: "France",
    neighborhood: "",
    cuisines: ["French"],
    lat: 48.8,
    lng: 2.3,
  },
  {
    id: 2,
    category: "COF",
    rank: 1,
    score: 9.9,
    name: "Coffee",
    city: "Paris",
    country: "France",
    neighborhood: "",
    cuisines: ["Coffee"],
    lat: 48.9,
    lng: 2.4,
  },
  {
    id: 3,
    category: "RES",
    rank: 2,
    score: 8,
    name: "Bistro",
    city: "Lyon",
    country: "France",
    neighborhood: "",
    cuisines: ["French"],
    lat: null,
    lng: null,
  },
];
test("combined filters preserve category ranks and use actual scores across categories", () => {
  assert.deepEqual(
    filterPlaces(places, {}).map((p) => p.id),
    [2, 1, 3],
  );
  assert.deepEqual(
    filterPlaces(places, {
      category: "RES",
      city: "Paris",
      cuisine: "French",
      favorites: true,
      query: "cafe",
    }).map((p) => p.id),
    [1],
  );
  assert.equal(filterPlaces(places, { query: "not found" }).length, 0);
  assert.equal(filterPlaces(places, { city: "Lyon" })[0].rank, 2);
});
test("saved collections merge by Google identity and unrated places sort last in both directions", () => {
  const placeId = btoa(String.fromCharCode(10, 18, 9, ...Array(9).fill(0), 188, 10, ...Array(6).fill(0)));
  const saved = [{ ...places[0], id: "google-abc", googleCid: "abc", wantToGo: true, score: null, rank: null, googleMapsUrl: "https://www.google.com/maps/place/Test" },
    { ...places[1], id: "google-def", googleCid: "def", wantToGo: true, score: null, rank: null }];
  const merged = mergeCollections([{ ...places[0], placeId }, places[2]], saved);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].wantToGo, true);
  assert.equal(merged[0].score, 9.8);
  assert.equal(filterPlaces(merged, { collection: "want" }).length, 2);
  assert.equal(filterPlaces(merged, { collection: "ranked" }).length, 2);
  for (const direction of ["asc", "desc"]) {
    assert.equal(filterPlaces(merged, { direction }).at(-1).id, "google-def");
  }
  assert.equal(rating(saved[0]), "♡");
});
test("CSV escapes quotes, commas and spreadsheet formulas", () => {
  const csv = toCSV([...places, { ...places[0], name: "=1+2" }]);
  assert.ok(csv.includes('"Café, ""One"""'));
  assert.ok(csv.includes('"\'=1+2"'));
  assert.ok(csv.includes('"category_rank"'));
});
test("recent sort uses creation times across categories and keeps unknown dates last", () => {
  const dated = [
    { ...places[0], addedAt: "2026-09-20T10:00:00Z" },
    { ...places[1], addedAt: "2026-09-20T04:00:00-07:00" },
    { ...places[2], addedAt: "2026-09-21T00:00:00Z" },
    { ...places[1], id: 4, addedAt: null },
    { ...places[0], id: 5, addedAt: "invalid" },
    { ...places[2], id: 6 },
  ];
  assert.deepEqual(filterPlaces(dated, { sort: "recent" }).map(p => p.id), [3, 2, 1, 4, 5, 6]);
  assert.deepEqual(filterPlaces(dated, { sort: "recent", direction: "asc" }).map(p => p.id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(filterPlaces(dated, { sort: "recent", city: "Paris" }).map(p => p.id), [2, 1, 4, 5]);
  assert.deepEqual(dated.map(p => p.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(filterPlaces(dated, { sort: "recent" })[0].rank, 2);
  assert.ok(toCSV(dated).includes('"added_at"'));
  assert.ok(toCSV(dated).includes('"2026-09-21T00:00:00Z"'));
});
test("rating and name can sort in either direction without changing category ranks", () => {
  assert.deepEqual(filterPlaces(places, { direction: "asc" }).map(p => p.id), [3, 1, 2]);
  assert.deepEqual(filterPlaces(places, { direction: "desc" }).map(p => p.id), [2, 1, 3]);
  assert.deepEqual(filterPlaces(places, { sort: "name", direction: "asc" }).map(p => p.id), [3, 1, 2]);
  assert.deepEqual(filterPlaces(places, { sort: "name", direction: "desc" }).map(p => p.id), [2, 1, 3]);
  assert.equal(filterPlaces(places, { direction: "asc", category: "RES" })[0].rank, 2);
});
test("unsafe external links and absent coordinates are rejected", () => {
  assert.equal(safeURL("javascript:alert(1)"), "");
  assert.equal(safeURL("https://example.com"), "https://example.com/");
  assert.equal(hasCoordinates(places[2]), false);
  assert.equal(hasCoordinates(places[0]), true);
});
