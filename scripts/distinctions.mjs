// Build-time matching: award names alone never establish restaurant identity.
const normalize = value => (value || "").normalize("NFD")
  .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const cityName = value => normalize((value || "").split(",")[0]);
const hasPoint = p => Number.isFinite(p.lat) && Number.isFinite(p.lng)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

export function distanceMeters(a, b) {
  if (!hasPoint(a) || !hasPoint(b)) return Infinity;
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function matchDistinctions(places, catalogue, aliases = {}) {
  const matches = {};
  const byName = new Map(), byId = new Map();
  for (const award of catalogue.restaurants) {
    const key = normalize(award.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(award);
    byId.set(award.id, award);
  }
  for (const place of places) {
    const candidates = new Set([
      ...(byName.get(normalize(place.name)) || []),
      ...(aliases[String(place.businessId)] || []).map(id => byId.get(id)).filter(Boolean),
    ]);
    const possible = [...candidates].filter(award => {
      if (award.kind === "michelin") return !place.status?.startsWith("CLOSED") && distanceMeters(place, award) <= 150;
      return ["world50", "world50bars"].includes(award.kind) && cityName(place.city)
        && cityName(place.city) === cityName(award.city);
    });
    // Multiple years are legitimate; multiple venues in one edition are not.
    const awards = possible.filter(a => possible.filter(b => b.kind === a.kind && b.year === a.year).length === 1)
      .sort((a, b) => a.kind.localeCompare(b.kind) || b.year - a.year);
    if (awards.length) matches[place.id] = awards.map(({ kind, stars, rank, year, url }) => ({ kind, stars, rank, year, url }));
  }
  return { checkedAt: catalogue.checkedAt, sourceCheckedAt: catalogue.sourceCheckedAt,
    coverage: catalogue.coverage, sourceCounts: {
    michelin: catalogue.restaurants.filter(a => a.kind === "michelin").length,
    world50: catalogue.restaurants.filter(a => a.kind === "world50").length,
    world50bars: catalogue.restaurants.filter(a => a.kind === "world50bars").length,
  }, places: matches };
}
