#!/usr/bin/env python3
"""Latest satellite flood extent from GISTDA (api-gateway.gistda.or.th) -> data/gistda_flood.geojson.

Needs the repo secret GISTDA_API_KEY (free key from GISTDA's API gateway); without it the script
does nothing and the page simply hides the layer. Runs at most every MIN_AGE_MIN; keeps the last
good file when the service is down. Stdlib only.
"""
import datetime as dt
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "data", "gistda_flood.geojson")
URL = "https://api-gateway.gistda.or.th/api/2.0/resources/features/flood/3days?pv_idn=%d&limit=1000&offset=%d"
PROVINCES = [10, 11, 12, 13, 73, 74]  # กทม. สมุทรปราการ นนทบุรี ปทุมธานี นครปฐม สมุทรสาคร
MIN_AGE_MIN, MAX_FEATURES = 110, 6000


def get(url, key):
    req = urllib.request.Request(url, headers={"API-Key": key, "Accept": "application/json",
                                               "User-Agent": "ATA-FloodWatch/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    key = os.environ.get("GISTDA_API_KEY", "").strip()
    if not key:
        print("gistda: no GISTDA_API_KEY, skip")
        return 0
    now = dt.datetime.now(dt.timezone.utc)
    try:
        old = json.load(open(OUT, encoding="utf-8"))
        if (now - dt.datetime.fromisoformat(old["fetched_at"])).total_seconds() / 60 < MIN_AGE_MIN:
            print("gistda: recent, skip")
            return 0
    except (OSError, ValueError, KeyError):
        pass
    feats = []
    try:
        for pv in PROVINCES:
            off = 0
            while len(feats) < MAX_FEATURES:
                d = get(URL % (pv, off), key)
                fs = d.get("features") or []
                for f in fs:
                    p = f.get("properties") or {}
                    keep = {k: p[k] for k in p if k.lower() in ("file_name", "acquired", "acq_date", "date", "_createdat", "pv_tn", "ap_tn", "tb_tn", "area_rai")}
                    feats.append({"type": "Feature", "geometry": f.get("geometry"), "properties": keep})
                if len(fs) < 1000:
                    break
                off += 1000
    except Exception as e:
        print("::warning::GISTDA unavailable: %s" % e)
        return 0
    res = {"type": "FeatureCollection", "fetched_at": now.isoformat(timespec="seconds"),
           "attribution": "GISTDA (สทอภ.) พื้นที่น้ำท่วมจากดาวเทียม 3 วันล่าสุด", "features": feats}
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    print("gistda: %d flood polygons" % len(feats))
    return 0


if __name__ == "__main__":
    sys.exit(main())
