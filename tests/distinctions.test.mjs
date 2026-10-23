import test from "node:test";
import assert from "node:assert/strict";
import { matchDistinctions, distanceMeters } from "../scripts/distinctions.mjs";
import { awardGroups } from "../public/model.js";

const place = { id: 1, businessId: 7, name: "Café One", city: "San Francisco, CA", lat: 37.78, lng: -122.42 };
const award = { id: "michelin:1", name: "Cafe One", city: "San Francisco", kind: "michelin", stars: 1, lat: 37.7801, lng: -122.4201, url: "https://guide.michelin.com/example" };
const catalogue = restaurants => ({ checkedAt: "2026-10-23T00:00:00Z", restaurants });

test("Michelin awards require matching names and the specific location", () => {
  const result = matchDistinctions([
    place,
    { ...place, id: 2, lat: 38 },
    { ...place, id: 3, name: "Other Restaurant" },
    { ...place, id: 4, lat: null, lng: null },
    { ...place, id: 5, status: "CLOSED_PERMANENTLY" },
  ], catalogue([award]));
  assert.deepEqual(Object.keys(result.places), ["1"]);
  assert.equal(result.places[1][0].stars, 1);
  assert.ok(distanceMeters(place, award) < 20);
});

test("reviewed aliases still require geographic agreement and ambiguous matches are rejected", () => {
  const renamed = { ...award, name: "Cafe One Restaurant" };
  assert.deepEqual(matchDistinctions([place], catalogue([renamed])).places, {});
  assert.equal(matchDistinctions([place], catalogue([renamed]), { 7: [award.id] }).places[1].length, 1);
  assert.deepEqual(matchDistinctions([{ ...place, lat: 38 }], catalogue([renamed]), { 7: [award.id] }).places, {});
  assert.deepEqual(matchDistinctions([place], catalogue([award, { ...award, id: "michelin:2" }])).places, {});
});

test("50 Best matches name and city, preserving the edition and extended-list rank", () => {
  const fifty = { id: "world50:2025:80", kind: "world50", name: "Cafe One", city: "San Francisco", year: 2025, rank: 80, url: "https://www.the50.com/list" };
  const result = matchDistinctions([place, { ...place, id: 2, city: "Paris" }, { ...place, id: 3, city: "" }], catalogue([award, fifty]));
  assert.equal(result.places[1].length, 2);
  assert.equal(result.places[1][1].year, 2025);
  assert.equal(result.places[1][1].rank, 80);
  assert.ok(result.places[2].every(a => a.kind !== "world50"));
  assert.ok(result.places[3].every(a => a.kind !== "world50"));
});

test("historical appearances survive across years and list types, including closed places", () => {
  const historic = (kind, year, rank) => ({ ...award, id: `${kind}:${year}:${rank}`, kind, year, rank, city: "San Francisco, USA" });
  const rows = [award, historic("world50", 2002, 10), historic("world50", 2025, 80), historic("world50bars", 2012, 24)];
  const result = matchDistinctions([place, { ...place, id: 2, status: "CLOSED_PERMANENTLY" }], catalogue(rows));
  assert.equal(result.places[1].length, 4);
  assert.equal(result.places[2].length, 3);
  assert.ok(result.places[2].every(a => a.kind !== "michelin"));
  const groups = awardGroups(result.places[1]);
  assert.deepEqual(groups.map(g => g.kind), ["michelin", "world50", "world50bars"]);
  assert.equal(groups[1].entries[0].year, 2025);
  assert.equal(groups[1].best.rank, 10);
  assert.equal(groups[2].entries[0].rank, 24);
  assert.deepEqual(awardGroups(), []);
});

test("ambiguous matches are rejected within one edition without hiding other years", () => {
  const rows = [2010, 2011, 2011].map((year, index) => ({ ...award, id: String(index), kind: "world50bars", year, rank: index + 1 }));
  const result = matchDistinctions([place], catalogue(rows));
  assert.deepEqual(result.places[1].map(a => a.year), [2010]);
});
