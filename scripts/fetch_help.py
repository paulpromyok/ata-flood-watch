#!/usr/bin/env python3
"""Shelters, parking and relief points from BMA Flood Support (floodsupport.bangkok.go.th).

Their /api/data sends no CORS header, so the page can't read it directly; this script copies it to
data/help.json at most every MIN_AGE_MIN and keeps the previous file if the site is unreachable.
Stdlib only.
"""
import datetime as dt
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "data", "help.json")
URL = "https://floodsupport.bangkok.go.th/api/data"
UA = "Mozilla/5.0 (compatible; ATA-FloodWatch/1.0; +https://ata-flood-watch.vercel.app)"
MIN_AGE_MIN = 25
KEEP = ("district", "category", "name", "capacity", "occupied", "available", "unitType", "status",
        "routeDetails", "link", "additionalDetails", "updatedAt")


def main():
    now = dt.datetime.now(dt.timezone.utc)
    try:
        old = json.load(open(OUT, encoding="utf-8"))
        age = (now - dt.datetime.fromisoformat(old["fetched_at"])).total_seconds() / 60
        if age < MIN_AGE_MIN and "--force" not in sys.argv:
            print("help: %.0f min old, skip" % age)
            return 0
    except (OSError, ValueError, KeyError):
        pass
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=40) as r:
            d = json.loads(r.read().decode("utf-8"))
        fac = d["facilities"]
        if not isinstance(fac, list) or len(fac) < 10:
            raise ValueError("only %s facilities" % (len(fac) if isinstance(fac, list) else "?"))
    except Exception as e:  # blocked or down: keep the last good copy
        print("::warning::BMA Flood Support unavailable: %s" % e)
        return 0
    res = {"fetched_at": now.isoformat(timespec="seconds"), "generatedAt": d.get("generatedAt"),
           "source": "BMA Flood Support (floodsupport.bangkok.go.th)", "categories": d.get("categories"),
           "facilities": [{k: f.get(k) for k in KEEP} for f in fac]}
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    print("help: %d facilities" % len(fac))
    return 0


if __name__ == "__main__":
    sys.exit(main())
