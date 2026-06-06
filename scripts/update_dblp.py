#!/usr/bin/env python3
"""Fetch DBLP search results and merge them into data/papers/<year>.json.

DBLP is excellent for titles, authors, years, venues and links. It usually does
not expose abstracts or author affiliations, so this script keeps those fields
empty for a later enrichment pass.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT / "data" / "ccf-a-venues.json"
PAPERS_DIR = ROOT / "data" / "papers"


def load_catalog() -> dict:
    with CATALOG_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def flatten_venues(catalog: dict) -> list[dict]:
    rows: list[dict] = []
    for direction in catalog["directions"]:
        for venue in direction["venues"]:
            rows.append({**venue, "directionId": direction["id"]})
    return rows


def normalize_hits(hits: object) -> list[dict]:
    if isinstance(hits, dict):
        return [hits]
    if isinstance(hits, list):
        return hits
    return []


def dblp_search(dblp_key: str, year: int, limit: int) -> list[dict]:
    query = f"stream:{dblp_key}: year:{year}"
    page_size = min(max(limit, 1), 100)
    first = 0
    results: list[dict] = []

    while len(results) < limit:
        params = urllib.parse.urlencode({
            "q": query,
            "format": "json",
            "h": str(min(page_size, limit - len(results))),
            "f": str(first),
        })
        url = f"https://dblp.org/search/publ/api?{params}"
        with urllib.request.urlopen(url, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))

        hits_payload = payload.get("result", {}).get("hits", {})
        hits = normalize_hits(hits_payload.get("hit", []))
        if not hits:
            break

        results.extend(hit.get("info", {}) for hit in hits)
        sent = int(hits_payload.get("@sent", len(hits)) or 0)
        total = int(hits_payload.get("@total", first + sent) or 0)
        first += sent
        if sent == 0 or first >= total:
            break
        time.sleep(0.1)

    return results


def normalize_authors(authors: object) -> list[str]:
    if not authors:
        return []
    author = authors.get("author") if isinstance(authors, dict) else authors
    if isinstance(author, str):
        return [author]
    if isinstance(author, dict):
        return [author.get("text", "") or author.get("@pid", "")]
    if isinstance(author, list):
        normalized = []
        for item in author:
            if isinstance(item, str):
                normalized.append(item)
            elif isinstance(item, dict):
                normalized.append(item.get("text", "") or item.get("@pid", ""))
        return [name for name in normalized if name]
    return []


def record_from_info(info: dict, venue: dict, year: int) -> dict:
    dblp_url = info.get("url", "")
    key = dblp_url.rstrip("/").split("/")[-1] or info.get("key", "")
    return {
        "id": f"{venue['id']}-{year}-{key}".lower().replace(" ", "-"),
        "venueId": venue["id"],
        "year": int(info.get("year", year)),
        "title": str(info.get("title", "")).rstrip("."),
        "authors": normalize_authors(info.get("authors")),
        "institutions": [],
        "abstract": "DBLP 原生记录不包含摘要；该字段等待后续通过 OpenAlex、Semantic Scholar 或出版商页面补全。",
        "links": {
            "dblp": dblp_url,
            "paper": info.get("ee", ""),
        },
        "metadataStatus": "dblp",
    }


def load_existing(year: int) -> dict:
    path = PAPERS_DIR / f"{year}.json"
    if not path.exists():
        return {"year": year, "generatedAt": "", "source": "DBLP search API", "papers": []}
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--venue", help="Venue id such as ccs or usenix-security")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--sleep", type=float, default=1.0)
    args = parser.parse_args()

    catalog = load_catalog()
    venues = flatten_venues(catalog)
    if args.venue:
        venues = [venue for venue in venues if venue["id"] == args.venue]
    if not venues:
        print("No matching venues.", file=sys.stderr)
        return 2

    output = load_existing(args.year)
    by_id = {paper["id"]: paper for paper in output.get("papers", [])}

    for index, venue in enumerate(venues, start=1):
        print(f"[{index}/{len(venues)}] Fetching {venue['shortName']} {args.year}", file=sys.stderr)
        try:
            for info in dblp_search(venue["dblpKey"], args.year, args.limit):
                record = record_from_info(info, venue, args.year)
                if record["title"]:
                    by_id[record["id"]] = {**by_id.get(record["id"], {}), **record}
        except Exception as exc:
            print(f"  skipped: {exc}", file=sys.stderr)
        time.sleep(args.sleep)

    output["generatedAt"] = time.strftime("%Y-%m-%d")
    output["source"] = "DBLP search API"
    output["papers"] = sorted(by_id.values(), key=lambda paper: (paper["venueId"], paper["title"]))

    PAPERS_DIR.mkdir(parents=True, exist_ok=True)
    path = PAPERS_DIR / f"{args.year}.json"
    with path.open("w", encoding="utf-8") as handle:
        json.dump(output, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
