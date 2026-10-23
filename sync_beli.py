#!/usr/bin/env python3
"""Export ranked Beli restaurants to the public website and a CSV."""

import argparse
import base64
import csv
from datetime import datetime, timezone
import getpass
import io
import json
import math
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

AUTH_API = "https://backoffice-service-onboarding-t57o3dxfca-nn.a.run.app"
API = "https://backoffice-service-t57o3dxfca-nn.a.run.app"
CATEGORIES = {"RES": "Restaurants", "COF": "Coffee & tea", "DES": "Dessert", "BAR": "Bars", "BAK": "Bakeries"}
PUBLIC = Path(__file__).resolve().parent / "public"


class LoginError(RuntimeError):
    """A safe authentication error that never includes credentials or responses."""


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def credentials():
    phone = os.environ.get("BELI_PHONE", "")
    password = os.environ.get("BELI_PASSWORD", "")
    if not phone or not password:
        if not sys.stdin.isatty():
            raise LoginError("Set both BELI_PHONE and BELI_PASSWORD in GitHub Actions Secrets or your environment.")
        phone = phone or input("Beli phone number (including +country code): ")
        password = password or getpass.getpass("Beli password: ")
    phone = re.sub(r"[\s().-]", "", phone)
    if not re.fullmatch(r"\+[1-9][0-9]{6,14}", phone):
        raise LoginError("BELI_PHONE must include the country code, e.g. +14155551234.")
    if not password:
        raise LoginError("Beli password cannot be empty.")
    return phone, password


def login(phone, password):
    request = Request(
        AUTH_API + "/api/token/",
        data=json.dumps({"phone_no": phone, "password": password}).encode("utf-8"),
        headers={
            "Accept": "application/json", "Content-Type": "application/json",
            "Origin": "https://localhost", "Referer": "https://localhost/",
            "User-Agent": (
                "Mozilla/5.0 (Linux; Android 16; SM-S928U) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/149.0.7827.91 Mobile Safari/537.36"
            ),
        },
        method="POST",
    )
    try:
        with build_opener(NoRedirects()).open(request, timeout=30) as response:
            result = json.load(response)
    except HTTPError as error:
        error.close()
        if error.code in (400, 401):
            message = "Check BELI_PHONE and BELI_PASSWORD; Beli rejected the credentials."
        elif error.code == 429:
            message = "Beli rate-limited login. Wait before rerunning the workflow."
        else:
            message = "Beli rejected login; its unofficial API may have changed."
        raise LoginError(f"Beli login returned HTTP {error.code}. {message}") from None
    except URLError:
        raise LoginError("Could not reach Beli login. Check the connection and TLS setup.") from None
    except (ValueError, UnicodeError):
        raise LoginError("Beli login returned invalid JSON.") from None
    if not isinstance(result, dict) or not isinstance(result.get("access"), str) or not result["access"]:
        raise LoginError("Beli login did not return an access token.")
    return result["access"]


def added_at(value):
    """Use the ranking record's creation time, never business or visit dates."""
    if not isinstance(value, str):
        return None
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            return None
        return timestamp.astimezone(timezone.utc).isoformat()
    except ValueError:
        return None


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
            "addedAt": added_at(row.get("created_dt")),
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


def fetch_ranking(access):
    parts = access.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid access token")
    claims = json.loads(base64.urlsafe_b64decode(parts[1] + "==="))
    rows = []
    for category in CATEGORIES:
        rows.extend(fetch_category(access, claims["user_id"], category))
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
    writer.writerow(["category", "category_rank", "name", "rating", "city", "country", "cuisines", "latitude", "longitude", "google_maps_url", "added_at"])
    for p in places:
        maps = "https://www.google.com/maps/search/?" + urlencode({"api": 1, "query": p["name"], "query_place_id": p["placeId"]})
        writer.writerow([csv_cell(v) for v in [CATEGORIES[p["category"]], p["rank"], p["name"], p["score"], p["city"], p["country"], "; ".join(p["cuisines"]), p["lat"] if p["lat"] is not None else "", p["lng"] if p["lng"] is not None else "", maps, p["addedAt"] or ""]])
    (PUBLIC / "restaurants.csv").write_text(stream.getvalue())
    print(f"Exported {len(places)} ranked restaurants to public/data.json and public/restaurants.csv.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    try:
        export(fetch_ranking(login(*credentials())))
    except LoginError as error:
        print(f"Sync failed: {error}", file=sys.stderr)
        return 1
    except HTTPError as error:
        error.close()
        print(f"Beli ranking request returned HTTP {error.code}. Previous export retained.", file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print(f"Sync failed ({type(error).__name__}). Check the connection and Beli response format. Previous export retained if fetching failed.", file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
