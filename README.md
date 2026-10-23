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
Builds fingerprint the app, its JavaScript imports, and CSS so browser/CDN caches
cannot mix new controls with old sorting logic after a deployment.

## Refresh your Beli data

```sh
npm run sync  # Prompts for your Beli phone number and password
npm run deploy
```

`sync_beli.py` logs in for each run, fetches all five ranking categories
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

The workflow requires four GitHub Actions repository secrets:

- `BELI_PHONE`: your Beli phone number, including the `+` country code.
- `BELI_PASSWORD`: your Beli password.
- `NETLIFY_AUTH_TOKEN`: a Netlify token authorized to deploy this site.
- `CARTO_BASEMAP_API_KEY`: the same map key used by local builds.

Set or update the Beli credentials with the CLI's interactive prompts:

```sh
gh secret set BELI_PHONE --repo clementou/restaurants
gh secret set BELI_PASSWORD --repo clementou/restaurants
```

Each run logs in with those credentials and keeps the access token only in
memory. Beli credentials are available only to the sync step. No session files
or Netlify Blobs are needed: Beli refresh tokens expire after seven days without
rotation, so a fresh login avoids weekly session expiry. Local runs prompt for
credentials or read `BELI_PHONE` and `BELI_PASSWORD` from the environment; the
script does not load `.env` files or save credentials.

If login fails, check the reported HTTP status and update the GitHub secrets
if your credentials changed. For rate limiting, wait before retrying. Failed
login or data fetching preserves the previous snapshot and skips deployment.
Then run **Refresh Beli** from GitHub Actions. The workflow must be on the default
branch for its weekly schedule to run. Beli's unofficial API can change and may
require a script update.

Beli ranks are calculated **within each category**. The combined view sorts by
the exact Beli score, displaying scores to one decimal place. Equal displayed
scores can still have distinct underlying scores and ranks. The CSV retains the
exact score and category rank. The download button exports the current filters;
`restaurants.csv` is the full snapshot.

Expand **Rating distribution** below the list and map to explore the chart.
It starts collapsed and follows all current filters and
excludes unrated saved places. It shows counts in half-point intervals, with a
curve connecting those counts, plus the average and median of exact scores.
Intervals include their lower bound; the final interval also includes 10.
Hover, tap, or keyboard-focus an interval for its count, or expand the accessible
table. Categories are ranked separately, and the export does not contain the
original liked / fine / disliked bucket choices.

### Restaurant distinctions

Badges show Michelin stars, Bib Gourmand, and separate World's 50 Best Restaurants
and World's 50 Best Bars rankings. Each 50 Best badge shows the latest recorded
appearance; its tooltip includes the best recorded rank and number of editions.
Open a place's map popup and expand **50 Best ranking history** to see every
matched edition with a source link. Historical recognition is independent of
the date you visited or added the place. The footer's
**About restaurant distinctions** disclosure shows the source check date and scope.

`data/distinctions.json` is a static catalogue of award facts fetched directly
from the official public Michelin listings and World's 50 Best list. The initial
snapshot contains 7,680 Michelin star / Bib Gourmand locations and 2,400 historical
50 Best appearances: restaurants **2002–2025** (23 editions, 1,300 entries) and
bars **2009–2026** (18 editions, 1,100 entries). There was no restaurant edition
in 2020. The official archives provide ranks **1–50 through 2022** and **1–100
from 2023**; missing older 51–100 results are not treated as evidence that a venue
was unlisted. Edition years come from the source, not the current calendar year.
No reviews or photos are copied. Refresh separately from personal rankings:

```sh
npm run sync:distinctions  # Requires Python 3 and curl; downloads the public lists
python3 sync_distinctions.py --only fifty  # Both full 50 Best histories; keeps Michelin and its check date
npm run build
```

The importer checks page totals, distinct Michelin IDs, contiguous archive years
(except restaurant 2020), and complete unique 1–50 or 1–100 ranks in each edition
before atomically replacing the catalogue. `data/fifty-corrections.json` records
seven verified corrections to mistakes in the live historical archives, with
links to the original published 2016 restaurant list and the 2010/2012 Drinks
International bar supplements. Corrections check the original rank before
applying and preserve the archive URL alongside the corrected source. Unexpected
source changes fail validation instead of silently guessing ranks. A failed fetch preserves
the previous snapshot. For interrupted downloads, use
`python3 sync_distinctions.py --cache-dir /tmp/restaurant-awards-YYYY-MM-DD` to
resume that day's validated pages; use a fresh directory on each refresh.
The source check date describes when this snapshot was retrieved, not the award
year. Catalogue updates are manual; ordinary builds and Beli refreshes use the
committed snapshot without contacting award sites.

Every build matches the current collection and emits only the small matched
`dist/distinctions.json` payload, fingerprinted with the app assets. Michelin
matching requires an exact normalized name plus coordinates within 150 metres.
Reviewed name aliases in `data/distinction-aliases.json` still require that same
location check: Steirereck / Steirereck im Stadtpark, Petiscos “Downtown” /
Petiscos, Pausa Bar & Cookery / Pausa, and Z & Y Restaurant / Z & Y. In particular,
the separate Z & Y Peking Duck location does not inherit Z & Y's Bib Gourmand.
50 Best requires an exact normalized name and city, or a reviewed business-ID
alias with the same city. The Paris Robuchon entry is explicitly mapped to the
historical Saint-Germain name, verified against its Beli website
`atelier-robuchon-saint-germain.com`; other branches receive no inherited award.
Ambiguity is checked within each list and year, preserving legitimate appearances
across years. Closed places may keep historical 50 Best recognition but do not
receive current Michelin badges. Saved Google Maps entries without location data remain
unmatched unless merged with a located Beli record. An absent badge is not a
claim that a restaurant has no awards. A failed badge fetch does not prevent
the collection from loading.

Choose **Date added** to show the newest additions to your Beli rankings
first. Use the direction button beside the sort dropdown to switch between
newest/oldest, highest/lowest rating, or A–Z/Z–A. Shared URLs preserve direction
with `direction=asc` or `direction=desc` when it differs from the default.
Date sorting uses the ranking record's creation timestamp (`addedAt` in JSON,
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
use `businessId` plus `category` to match places across exports because re-rating
can replace the rating-record `id`. The HTML advertises both files
with alternate-format links and visible footer links.

## Credentials and public data

### Google Maps import setup

The Google Cloud project `clementou-restaurants` has Drive API access enabled.
Its service account is
`takeout-reader@clementou-restaurants.iam.gserviceaccount.com`; share the Takeout
destination folder with this account as **Viewer**. The owner's Google account
can impersonate this service account for short-lived access without a private
key. No project-wide data roles were granted to the service account.

The **Want to go** collection is imported into `public/google-maps.json` and
merged with Beli in the browser. Matching Google feature IDs combine the two
entries and keep Beli's ratings and coordinates. Unknown places retain their
original Maps links without guessed ratings, dates, categories, or coordinates.
They are searchable and open in Google Maps; the page shows how many cannot yet
be pinned on the map. Notes, comments, tags, and other saved lists are excluded.
The Beli JSON/CSV snapshots remain independent, and browser CSV downloads include
the selected collection. Beli refreshes do not overwrite the Maps snapshot.

For “Want to go,” select **Saved** in Google Takeout and export into the shared
folder. Refresh locally using your authenticated personal gcloud account:

```sh
python3 sync_google_maps.py --folder 1uX-i3Bnup2c59RLdOtePThl7W3KGUdeyFDJugXsGa8Z3UQeXNs-KDE2-AXF8ro-2o8XWEvcJ
```

The importer lists only that folder, reads the newest archive containing
`Saved/Want to go.csv`, and preserves the current snapshot on invalid or empty
exports. ZIP and TGZ archives up to 20 MiB are supported; larger unrelated
archives are skipped. Raw downloads belong in gitignored `.takeout/`, outside
`public/`. An export with no changes does not rewrite the snapshot.

The `Refresh Google Maps` workflow checks for new exports on the **20th of each
month at 5 p.m. America/Los_Angeles**, automatically following daylight saving
time, and deploys only changed data. GitHub may delay scheduled runs. Recurring
access is enabled through the `GOOGLE_TAKEOUT_PROVIDER` repository variable. The
Workload Identity provider allows only repository ID `1369517619`, owner ID
`12637289`, on `refs/heads/main` to impersonate the reader service account. It
uses short-lived tokens with the Drive read-only scope, not a private key.
The Google and Beli workflows share a concurrency group to prevent overlapping
deployments. Renew your Takeout export schedule when its one-year period ends.

Passwords and tokens are never written by the sync script. Legacy token files,
`.env` files, and Netlify state remain gitignored. The build publishes `public/`,
matched distinction facts, and map library assets, never the repository root
or the full award catalogue.

The export uses an allowlist of place information and your scores. Account
identity, visit dates, notes, and raw API responses are not published.

Authentication uses the unofficial Beli Maps login flow: phone number + password
to `/api/token/`. Credentials and the returned access token stay in the sync
process; they are never part of the published website.

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
