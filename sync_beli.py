#!/usr/bin/env python3
"""Export ranked Beli restaurants to the public website and a CSV."""

import argparse
import base64
import csv
from datetime import datetime, timezone
import io
import json
import math
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import Request, build_opener

from beli_token import DEFAULT_OUTPUT, NoRedirects, request_tokens, save_tokens

API = "https://backoffice-service-t57o3dxfca-nn.a.run.app"
CATEGORIES = {"RES": "Restaurants", "COF": "Coffee & tea", "DES": "Dessert", "BAR": "Bars", "BAK": "Bakeries"}
PUBLIC = Path(__file__).resolve().parent / "public"


def normalize(rows):
    """Publish an explicit allowlist, excluding identity, visit history and notes."""
    places = []
    seen = set()
    for row in rows:
        business = row["business"]
        key = (business["id"], row["category"])
        if key in seen:
            raise ValueError("Duplicate business in ranking; refusing incomplete export")
        seen.add(key)
        score = row["score"]
        if not isinstance(score, (int, float)) or not math.isfinite(score) or not 0 <= score <= 10:
            raise ValueError("Invalid Beli score")
        lat, lng = business.get("lat"), business.get("lng")
        if not (isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and -90 <= lat <= 90 and -180 <= lng <= 180):
            lat, lng = None, None
        places.append({
            "id": row["id"], "businessId": business["id"], "category": row["category"],
            "name": business["name"], "score": score,
            "city": business.get("city") or "", "country": business.get("country") or "",
            "neighborhood": business.get("neighborhood") or "",
            "cuisines": business.get("cuisines") or [],
            "price": business.get("price"), "currency": business.get("price_key") or "$",
            "lat": lat, "lng": lng, "placeId": business.get("place_id") or "",
            "beliUrl": business.get("quick_link") or "",
            "website": business.get("website") or "",
            "status": business.get("status") or "",
        })
    # Stable sort preserves Beli's ordering for equal scores.
    places.sort(key=lambda place: -place["score"])
    ranks = {}
    for place in places:
        category = place["category"]
        ranks[category] = ranks.get(category, 0) + 1
        place["rank"] = ranks[category]
    return places


def fetch_ranking(token_path):
    tokens = json.loads(token_path.read_text())
    tokens = request_tokens("/api/token/refresh/", {"refresh": tokens["refresh"]})
    save_tokens(token_path, tokens)
    claims = json.loads(base64.urlsafe_b64decode(tokens["access"].split(".")[1] + "==="))
    rows = []
    for category in CATEGORIES:
        rows.extend(fetch_category(tokens["access"], claims["user_id"], category))
    return rows


def fetch_category(access, user_id, category):
    url = API + "/api/get-ranking/?" + urlencode({"user": user_id, "category": category})
    rows, visited = [], set()
    expected_count = None
    while url:
        if url in visited or urlsplit(url).netloc != urlsplit(API).netloc or urlsplit(url).scheme != "https":
            raise ValueError("Invalid pagination URL")
        visited.add(url)
        req = Request(url, headers={
            "Authorization": "Bearer " + access,
            "Accept": "application/json", "Origin": "https://localhost",
            "Referer": "https://localhost/", "User-Agent": "Mozilla/5.0",
        })
        with build_opener(NoRedirects()).open(req, timeout=30) as response:
            page = json.load(response)
        if not isinstance(page.get("results"), list):
            raise ValueError("Unexpected ranking response")
        if expected_count is None:
            expected_count = page.get("count")
        rows.extend(page["results"])
        url = urljoin(url, page["next"]) if page.get("next") else None
    if expected_count is not None and len(rows) != expected_count:
        raise ValueError("Ranking count mismatch; refusing incomplete export")
    return rows


def csv_cell(value):
    value = str(value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


def export(rows):
    places = normalize(rows)
    if not places:
        raise ValueError("Empty ranking; keeping previous export")
    PUBLIC.mkdir(exist_ok=True)
    data = {"updatedAt": datetime.now(timezone.utc).isoformat(), "categories": CATEGORIES, "places": places}
    contents = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    temporary = PUBLIC / "data.json.tmp"
    temporary.write_text(contents)
    temporary.replace(PUBLIC / "data.json")
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(["category", "category_rank", "name", "rating", "city", "country", "cuisines", "latitude", "longitude", "google_maps_url"])
    for p in places:
        maps = "https://www.google.com/maps/search/?" + urlencode({"api": 1, "query": p["name"], "query_place_id": p["placeId"]})
        writer.writerow([csv_cell(v) for v in [CATEGORIES[p["category"]], p["rank"], p["name"], p["score"], p["city"], p["country"], "; ".join(p["cuisines"]), p["lat"] if p["lat"] is not None else "", p["lng"] if p["lng"] is not None else "", maps]])
    (PUBLIC / "restaurants.csv").write_text(stream.getvalue())
    print(f"Exported {len(places)} ranked restaurants to public/data.json and public/restaurants.csv.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tokens", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        export(fetch_ranking(args.tokens.expanduser().absolute()))
    except HTTPError as error:
        print(f"Beli returned HTTP {error.code}. If authorization expired, run python3 beli_token.py again.", file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(f"Sync failed ({type(error).__name__}). Check your token file and connection. Previous export retained if fetching failed.", file=sys.stderr)
        sys.exit(1)
