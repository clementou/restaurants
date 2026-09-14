# At the table

Clément's Beli atlas: ranked places, personal ratings, a clustered interactive map,
category/city/cuisine filters, search, and CSV export.

- Website: https://clementou.com/restaurants/
- Independent Netlify site: https://clementou-restaurants.netlify.app
- Repository: https://github.com/clementou/restuarants (spelling as requested)

## Run locally

Requires Node.js, npm, and Python 3. No Python dependencies.

```sh
npm ci
npm run dev
```

Open http://localhost:4173. A public snapshot is included, so browsing and building
do not require Beli credentials. The map uses locally bundled Leaflet and
MarkerCluster with CARTO/OpenStreetMap tiles; no map API key is needed.

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
visitors' browsers. No unattended refresh schedule is installed. Run the sync and
deploy commands whenever you want to publish an update.

Beli ranks are calculated **within each category**. The combined view sorts by
the exact Beli score, displaying scores to one decimal place. Equal displayed
scores can still have distinct underlying scores and ranks. The CSV retains the
exact score and category rank. The download button exports the current filters;
`restaurants.csv` is the full snapshot.

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
tokens are never sent to GitHub or Netlify by these scripts.

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
