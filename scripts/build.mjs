import { cp, mkdir, rm, readFile } from "node:fs/promises";

const data = JSON.parse(await readFile("public/data.json", "utf8"));
if (!Array.isArray(data.places) || !data.places.length)
  throw new Error("Run npm run sync to export your Beli list first.");
await rm("dist", { recursive: true, force: true });
await cp("public", "dist", { recursive: true });
await mkdir("dist/vendor", { recursive: true });
for (const [source, target] of [
  ["leaflet/dist/leaflet.js", "leaflet.js"],
  ["leaflet/dist/leaflet.css", "leaflet.css"],
  ["leaflet/LICENSE", "leaflet-LICENSE.txt"],
  ["leaflet.markercluster/dist/leaflet.markercluster.js", "markercluster.js"],
  ["leaflet.markercluster/dist/MarkerCluster.css", "markercluster.css"],
  ["leaflet.markercluster/MIT-LICENCE.txt", "markercluster-LICENSE.txt"],
])
  await cp(`node_modules/${source}`, `dist/vendor/${target}`);
await cp("node_modules/leaflet/dist/images", "dist/vendor/images", {
  recursive: true,
});
console.log(
  `Built restaurant atlas with ${data.places.length} places. Only public/ and map libraries are published.`,
);
