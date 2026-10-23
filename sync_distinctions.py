#!/usr/bin/env python3
"""Snapshot public award facts from Michelin and The World's 50 Best.

No restaurant reviews, photos, accounts, or private APIs are copied.
The build matches this catalogue to the collection and ships only matches.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
import json
import hashlib
import math
from pathlib import Path
import re
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parent
MICHELIN = "https://guide.michelin.com/us/en/restaurants/all-starred/bib-gourmand"
FIFTY = "https://www.the50.com/restaurants/best-in-the-world/list/1-50"
FIFTY_SERIES = {
    "restaurants": {"kind": "world50", "start": 2002, "title": "Restaurants", "root": "https://www.the50.com/restaurants/best-in-the-world"},
    "bars": {"kind": "world50bars", "start": 2009, "title": "Bars", "root": "https://www.the50.com/bars/best-in-the-world"},
}
DISTINCTIONS = {"ONE_STAR": 1, "TWO_STARS": 2, "THREE_STARS": 3, "BIB_GOURMAND": 0}


class MichelinParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.current = None
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self.current is not None and tag == "div":
            self.depth += 1
        classes = a.get("class", "").split()
        if "js-restaurant__list_item" in classes and "js-restaurants__empty_new_restaurants" not in classes:
            distinction = a["data-map-pin-name"]
            if distinction not in DISTINCTIONS:
                raise ValueError(f"Unexpected Michelin distinction: {distinction}")
            self.current = {
                "id": "michelin:" + a["data-id"], "kind": "michelin",
                "stars": DISTINCTIONS[distinction],
                "lat": float(a["data-lat"]), "lng": float(a["data-lng"]),
            }
            self.rows.append(self.current)
            self.depth = 1
        if self.current is not None:
            if a.get("data-restaurant-name"):
                self.current.update(name=a["data-restaurant-name"], city=a["data-dtm-city"], country=a["data-restaurant-country"])
            if tag == "a" and "/restaurant/" in a.get("href", ""):
                self.current["url"] = "https://guide.michelin.com" + a["href"]

    def handle_endtag(self, tag):
        if self.current is not None and tag == "div":
            self.depth -= 1
            if self.depth == 0:
                self.current = None


def parse_michelin(html):
    parser = MichelinParser()
    parser.feed(html)
    total = re.search(r"of\s+([\d,]+)\s+restaurants", html, re.I)
    if not total or not parser.rows:
        raise ValueError("Michelin listing missing; previous snapshot retained")
    for row in parser.rows:
        if not all(row.get(k) for k in ("name", "city", "country", "url")):
            raise ValueError("Incomplete Michelin restaurant")
        if not (-90 <= row["lat"] <= 90 and -180 <= row["lng"] <= 180):
            raise ValueError("Invalid Michelin coordinates")
    return parser.rows, int(total[1].replace(",", ""))


def fifty_entries(html, year, series, source):
    config = FIFTY_SERIES[series]
    rows = []
    for item in re.split(r'<div class="list-item"\s*>', html)[1:]:
        rank = re.search(r'<p class="rank\s*"\s*>\s*(\d+)\s*</p>', item)
        if not rank:
            continue
        name = re.search(r'<h2>(.*?)</h2>', item, re.S)
        city = re.search(r'</h2>(?:</a>)?<p>(.*?)</p>', item, re.S)
        if not all((name, city)):
            raise ValueError("Incomplete 50 Best entry")
        clean = lambda text: unescape(re.sub(r'<[^>]*>', '', text)).strip()
        rows.append({"kind": config["kind"], "rank": int(rank[1]), "year": year,
                     "name": clean(name[1]), "city": clean(city[1]), "url": source})
    return rows


def validate_fifty(rows):
    if len(rows) not in (50, 100) or sorted(row["rank"] for row in rows) != list(range(1, len(rows) + 1)):
        raise ValueError("50 Best edition must contain exactly ranks 1–50 or 1–100")
    if len({(row['name'], row['city']) for row in rows}) != len(rows):
        raise ValueError("Duplicate venue in 50 Best edition")
    for row in rows:
        row["id"] = f"{row['kind']}:{row['year']}:{row['rank']}"
    return rows


def parse_fifty(html, series="restaurants"):
    year = re.search(r'<meta name="list-year" content="(\d{4})"', html)
    if not year:
        raise ValueError("50 Best edition year missing")
    source = f"{FIFTY_SERIES[series]['root']}/list/1-50"
    return validate_fifty(fifty_entries(html, int(year[1]), series, source))


def parse_fifty_archive(html, series, corrections=()):
    config = FIFTY_SERIES[series]
    blocks = re.split(rf'<h1>The World.s 50 Best {config["title"]} (\d{{4}})</h1>', html)
    if len(blocks) < 3:
        raise ValueError(f"Missing {series} archive")
    rows, years = [], []
    for year_text, section in zip(blocks[1::2], blocks[2::2]):
        year = int(year_text)
        source = f"{config['root']}/previous-list/{year}"
        edition = fifty_entries(section, year, series, source)
        for correction in corrections:
            if correction["series"] != series or correction["year"] != year:
                continue
            matches = [r for r in edition if r["name"] == correction["name"] and (not correction.get("city") or r["city"] == correction["city"])]
            if len(matches) != 1 or matches[0]["rank"] not in (correction["from"], correction["rank"]):
                raise ValueError("Archive correction no longer matches; review the source")
            row = matches[0]
            row.update(rank=correction["rank"], archiveUrl=source, url=correction["source"])
        rows.extend(validate_fifty(edition))
        years.append(year)
    expected = set(range(config["start"], max(years) + 1))
    if series == "restaurants":
        expected.discard(2020)  # No edition was published during the pandemic.
    if set(years) != expected or len(years) != len(set(years)):
        raise ValueError(f"Missing or duplicate {series} archive editions")
    return rows


def fetch(url, cache, validator=parse_michelin):
    key = hashlib.sha256(url.encode()).hexdigest()[:20] + ".html"
    path = cache / key
    if path.exists():
        if datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).date() != datetime.now(timezone.utc).date():
            raise ValueError("Use a fresh cache directory: cached pages are from a previous day")
        text = path.read_text()
        validator(text)
        return text
    for attempt in range(3):
        try:
            html = subprocess.run(
                ["curl", "--fail", "--location", "--silent", "--show-error", "--max-time", "40", "--max-filesize", "5000000", url],
                check=True, capture_output=True, timeout=45,
            ).stdout
            if len(html) > 5_000_000:
                raise ValueError("Unexpectedly large listing")
            text = html.decode("utf-8")
            # Never cache a bot challenge or an incomplete response.
            validator(text)
            path.write_text(text)
            return text
        except (OSError, ValueError, subprocess.SubprocessError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def sync_michelin(cache):
    first, expected = parse_michelin(fetch(MICHELIN, cache))
    page_size = len(first)
    pages = math.ceil(expected / page_size)
    if page_size != 48 or not 1 <= pages <= 500:
        raise ValueError("Unexpected Michelin pagination")
    rows = first
    def page(number):
        result, total = parse_michelin(fetch(f"{MICHELIN}/page/{number}", cache))
        if total != expected or len(result) != min(page_size, expected - (number - 1) * page_size):
            raise ValueError("Michelin listing changed during download; retry with a fresh cache")
        return result
    with ThreadPoolExecutor(max_workers=3) as pool:
        for number, result in enumerate(pool.map(page, range(2, pages + 1)), 2):
            rows.extend(result)
            if number % 20 == 0 or number == pages:
                print(f"Michelin: {number}/{pages} pages", flush=True)
    if len(rows) != expected or len({row["id"] for row in rows}) != expected:
        raise ValueError("Incomplete or duplicate Michelin catalogue")
    return rows


def sync_fifty(cache):
    corrections = json.loads((ROOT / "data/fifty-corrections.json").read_text())
    rows, coverage, sources = [], {}, {}
    for series, config in FIFTY_SERIES.items():
        current_url = config["root"] + "/list/1-50"
        current_parser = lambda html: parse_fifty(html, series)
        current = current_parser(fetch(current_url, cache, current_parser))
        current_year = current[0]["year"]
        archive_url = f"{config['root']}/previous-list/{current_year - 1}"
        archive_parser = lambda html: parse_fifty_archive(html, series, corrections)
        history = archive_parser(fetch(archive_url, cache, archive_parser))
        history = [r for r in history if r["year"] < current_year]
        history.extend(current)
        years = sorted({r["year"] for r in history})
        expected = set(range(config["start"], current_year + 1))
        if series == "restaurants":
            expected.discard(2020)
        if set(years) != expected:
            raise ValueError(f"Gap between current and historical {series} lists")
        coverage[config["kind"]] = [{"year": y, "throughRank": max(r["rank"] for r in history if r["year"] == y)} for y in years]
        sources[config["kind"]] = {"current": current_url, "archive": archive_url}
        rows.extend(history)
        print(f"50 Best {series}: {len(history)} entries, {years[0]}–{years[-1]} ({len(years)} editions)")
    return rows, coverage, sources


def sync(cache, only=None):
    output = ROOT / "data" / "distinctions.json"
    previous = json.loads(output.read_text()) if output.exists() else {}
    now = datetime.now(timezone.utc).isoformat()
    checked = previous.get("sourceCheckedAt", {"michelin": previous.get("checkedAt")})
    rows = [r for r in previous.get("restaurants", []) if r["kind"] == "michelin"] if only == "fifty" else sync_michelin(cache)
    if not rows:
        raise ValueError("No Michelin snapshot; run a full sync first")
    if only != "fifty":
        checked["michelin"] = now
    fifty, coverage, sources = sync_fifty(cache)
    checked.update(world50=now, world50bars=now)
    snapshot = {
        "checkedAt": now, "sourceCheckedAt": checked, "coverage": coverage,
        "sources": {"michelin": MICHELIN, **sources},
        "restaurants": sorted(rows + fifty, key=lambda row: row["id"]),
    }
    output.parent.mkdir(exist_ok=True)
    temporary = output.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(output)
    print(f"Saved {len(rows)} Michelin distinctions and {len(fifty)} historical 50 Best entries.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, help="Resume same-day downloads; use a fresh directory for each refresh")
    parser.add_argument("--only", choices=["fifty"], help="Refresh both 50 Best histories, retaining the Michelin snapshot and its check date")
    args = parser.parse_args()
    if args.cache_dir:
        args.cache_dir.mkdir(parents=True, exist_ok=True)
        sync(args.cache_dir, args.only)
    else:
        with tempfile.TemporaryDirectory(prefix="restaurant-distinctions-") as directory:
            sync(Path(directory), args.only)
