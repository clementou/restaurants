import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const cartoKey = process.env.CARTO_BASEMAP_API_KEY;
if (!cartoKey) throw new Error("Set CARTO_BASEMAP_API_KEY in .env or the build environment.");

const data = JSON.parse(await readFile("public/data.json", "utf8"));
if (!Array.isArray(data.places) || !data.places.length)
  throw new Error("Run npm run sync to export your Beli list first.");
await rm("dist", { recursive: true, force: true });
await cp("public", "dist", { recursive: true });
await writeFile(
  "dist/map-config.js",
  `export const cartoKey = ${JSON.stringify(cartoKey)};\n`,
);
// The custom domain caches JS/CSS for four hours. Version the full module graph
// so fresh HTML never combines a new control with an older sorting module.
async function versionAsset(filename, contents) {
  const hash = createHash("sha256").update(contents).digest("hex").slice(0, 12);
  const versioned = filename.replace(/(\.[^.]+)$/, `.${hash}$1`);
  await writeFile(`dist/${versioned}`, contents);
  return versioned;
}
const modelFile = await versionAsset("model.js", await readFile("dist/model.js", "utf8"));
const configFile = await versionAsset("map-config.js", await readFile("dist/map-config.js", "utf8"));
const app = (await readFile("dist/app.js", "utf8"))
  .replace('"./model.js"', `"./${modelFile}"`)
  .replace('"./map-config.js"', `"./${configFile}"`);
const appFile = await versionAsset("app.js", app);
const stylesFile = await versionAsset("styles.css", await readFile("dist/styles.css", "utf8"));
const html = (await readFile("dist/index.html", "utf8"))
  .replace('"./app.js"', `"./${appFile}"`)
  .replace('"./styles.css"', `"./${stylesFile}"`);
await writeFile("dist/index.html", html);
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
