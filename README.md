# At the table

Clement's Beli atlas: ranked places, personal ratings, a clustered interactive map,
category/city/cuisine filters, search, and CSV export.

- Website: https://clementou.com/restaurants/
- Independent Netlify site: https://clementou-restaurants.netlify.app
- Repository: https://github.com/clementou/restuarants (spelling as requested)

## Run locally

Use Node.js 24 LTS (`nvm use` reads `.nvmrc`), npm, and Python 3. No Python dependencies.
Set `CARTO_BASEMAP_API_KEY=your-key` in a local `.env` file before building.

```sh
npm ci
npm run dev
```

Open http://localhost:4173. A public snapshot is included, so browsing and building
do not require Beli credentials. The map uses locally bundled Leaflet and
MarkerCluster with CARTO/OpenStreetMap tiles. CARTO requires a
[free basemap API key](https://carto.com/basemaps/apikey/).
The build reads `CARTO_BASEMAP_API_KEY` from `.env` locally or the Netlify build
environment and generates `dist/map-config.js`. The key is not committed to Git,
but is visible to browsers when they request tiles, as required by CARTO's client
integration. Restrict it to the site's domains in the CARTO dashboard.

## Refresh your Beli data

```sh
python3 beli_token.py  # Interactive login; only needed initially or after expiry
npm run sync
npm run deploy
```

`sync_beli.py` refreshes the local session, fetches all five ranking categories
(restaurants, coffee & tea, dessert, bars, and bakeries), and writes
`public/data.json` and `public/restaurants.csv`. Commit the updated public files
and push to GitHub to retain the snapshot in source control.

The site displays a snapshot with its export date; it does not poll Beli from
visitors' browsers. The `Refresh Beli` GitHub Actions workflow refreshes it weekly
on Sundays at 15:17 UTC (08:17 PDT / 07:17 PST). You can also run it from the
repository's Actions tab using **Run workflow**. Scheduled runs can be delayed
by GitHub; this is not an exact-time guarantee.

GitHub Actions and Netlify builds use Node.js 24 from `.nvmrc`. The workflow
uses Ubuntu 24.04 and actions pinned to verified release commits; Dependabot
checks monthly for action updates. The site itself is static HTML, CSS, and
browser JavaScript, with no Node.js or Bun server runtime.

The workflow tests the code, refreshes all categories, builds, commits the public
snapshot, and deploys directly to the existing Netlify site. A failed sync or
build does not deploy. Overlapping refresh runs are serialized. Check the Actions
tab and GitHub's workflow notification settings for failures. GitHub may disable
scheduled workflows in public repositories after 60 days without activity;
successful weekly snapshot commits keep this repository active.

### Weekly refresh credentials

The workflow requires two GitHub Actions repository secrets:

- `NETLIFY_AUTH_TOKEN`: a Netlify token authorized for this site and its Blobs.
- `CARTO_BASEMAP_API_KEY`: the same map key used by local builds.

Beli tokens live in the site's private Netlify Blobs store `beli-sync`, key
`tokens`. They are never committed or uploaded as workflow artifacts, and no
public endpoint exposes the store. Each run restores them into a temporary file
and persists the refreshed session even when fetching places subsequently fails.
No Beli password is stored. Avoid running a local refresh at the same time as the
workflow, since both may rotate the same session.

To seed the session, or recover after Beli rejects/invalidates it, log in locally
and replace the stored session using the authenticated Netlify CLI:

```sh
python3 beli_token.py
netlify blobs:set beli-sync tokens --input .beli-tokens.json --force
```

Then run **Refresh Beli** from GitHub Actions. The workflow must be on the default
branch for its weekly schedule to run. Beli's unofficial API can change; a failed
run may require a new login or a script update.

Beli ranks are calculated **within each category**. The combined view sorts by
the exact Beli score, displaying scores to one decimal place. Equal displayed
scores can still have distinct underlying scores and ranks. The CSV retains the
exact score and category rank. The download button exports the current filters;
`restaurants.csv` is the full snapshot.

Choose **Recently added** to show the newest additions to your Beli rankings
first. This uses the ranking record's creation timestamp (`addedAt` in JSON,
`added_at` in CSV), not a visit date, business creation date, or later re-ranking.
Dates display in your browser's timezone. Places with unknown dates appear last;
equal dates use rating order. Filters and shared `?sort=recent` URLs preserve
this ordering, and weekly refreshes include the timestamps automatically.

## Access from an agent or script

The full dataset is available without authentication or browser JavaScript:

- JSON: https://clementou.com/restaurants/data.json
- CSV: https://clementou.com/restaurants/restaurants.csv

JSON is recommended for programmatic use. It contains `updatedAt` (UTC export
time), a `categories` code-to-label mapping, and the `places` array. Each place
includes its Beli rating-record `id`, `businessId`, `category`, category `rank`,
exact numeric `score`, nullable `addedAt`, name, location, cuisine array, and external links. `lat`
and `lng` are nullable. These are full snapshots, independent of UI filters;
use `id` to match rating records across exports. The HTML advertises both files
with alternate-format links and visible footer links.

## Credentials and public data

The login script saves access/refresh tokens in `.beli-tokens.json` with mode
`0600`. It never saves the password. Token files, `.env` files, and Netlify state
are gitignored. The build publishes only `public/` and map library assets, never
the repository root. Custom token files should also be kept outside `public/`.

The export uses an allowlist of place information and your scores. Account
identity, visit dates, notes, and raw API responses are not published.

Authentication is an unofficial API flow observed in the published Beli Maps
extension v0.1.6: phone number + password to `/api/token/`, refresh token to
`/api/token/refresh/`. It can change. A rejected refresh requires a new login;
the local scripts do not upload tokens. The weekly workflow explicitly stores
the session in private Netlify Blobs and accesses it from the GitHub Actions
runner; credentials are never part of the published website.

## Deploy and route

```sh
npm test
npm run deploy
```

Netlify publishes `dist/`. The personal website repository (`clementou/website`)
proxies `/restaurants` and `/restaurants/*` to the restaurant Netlify site,
following the existing `/fish` deployment. Assets use relative URLs so both the
standalone site and the subpath work. A small history update normalizes the bare
`/restaurants` URL without a server redirect loop.

Only the initial route setup needs a deployment of the personal website;
subsequent restaurant updates deploy independently.

## Verification

`npm test` checks filtering across categories, accurate category ranks, CSV
escaping, safe external links, and exclusion of private data during export.
`npm run build` makes the deployable static bundle.
