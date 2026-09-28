#!/usr/bin/env python3
"""Canal outlook (12/24/48 h) around the office from BKK FloodWatch 2026.

Source: https://flood.autobahn.bot (github.com/bejranonda/flood2026, MIT). Their API is keyless but
sends no CORS header, so the page can't call it; this script fetches it server-side and writes
data/outlook.json. Forecasts change a few times a day, so it fetches at most once per MIN_AGE_MIN
and keeps the previous file when the source is down. Stdlib only.
"""
import datetime as dt
import json
import math
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, "data", "outlook.json")
API = "https://flood.autobahn.bot/api/"
UA = "ATA-FloodWatch/1.0 (+https://ata-flood-watch.vercel.app; hourly, attribution shown)"
HOME = (13.7420531, 100.7022086)
RADIUS_KM = 10
MIN_AGE_MIN = 50


def km(a, b, c, d):
    r = math.pi / 180
    x = math.sin((c - a) * r / 2)
    y = math.sin((d - b) * r / 2)
    return 2 * 6371 * math.asin(math.sqrt(x * x + math.cos(a * r) * math.cos(c * r) * y * y))


def get(path):
    req = urllib.request.Request(API + path, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def slim(c):
    if not isinstance(c, dict):
        return None
    keep = ("dir", "level", "median", "likely", "range90", "confidence", "method", "skill", "proven", "wide")
    return {k: c.get(k) for k in keep if k in c}


def main():
    now = dt.datetime.now(dt.timezone.utc)
    try:
        old = json.load(open(OUT, encoding="utf-8"))
        age = (now - dt.datetime.fromisoformat(old["fetched_at"])).total_seconds() / 60
        if age < MIN_AGE_MIN and "--force" not in sys.argv:
            print("outlook: %.0f min old, skip" % age)
            return 0
    except (OSError, ValueError, KeyError):
        pass
    try:
        pt = get("point?lat=%.7f&lon=%.7f" % HOME)
        st = get("stations")
    except Exception as e:  # source down: keep the last good file
        print("::warning::outlook source unavailable: %s" % e)
        return 0
    stations = st.get("stations", st) if isinstance(st, dict) else st
    gauges = []
    for s in stations or []:
        if s.get("lat") is None or s.get("lon") is None:
            continue
        d = km(HOME[0], HOME[1], s["lat"], s["lon"])
        if d > RADIUS_KM:
            continue
        gauges.append({
            "code": s.get("code"), "name": s.get("name_th") or s.get("name_en"), "river": s.get("river"),
            "agency": s.get("agency"), "lat": s["lat"], "lon": s["lon"], "km": round(d, 2),
            "level": s.get("level_msl"), "bank": s.get("bank_msl"), "crit": s.get("bma_critical_msl"),
            "over_crit": s.get("over_bma_critical_m"), "freeboard": s.get("freeboard_m"),
            "status": s.get("status"), "obs_time": s.get("obs_time"), "stale": bool(s.get("stale")),
            "c12": slim(s.get("change12")), "c24": slim(s.get("change24")), "c48": slim(s.get("change48")),
            "peak_h": s.get("peak_h"), "recovery": (s.get("recovery") or {}).get("state"),
            "forecast_time": s.get("forecast_time"),
        })
    gauges.sort(key=lambda g: g["km"])
    f = pt.get("forecast") or {}
    ev = pt.get("evidence") or {}
    res = {
        "fetched_at": now.isoformat(timespec="seconds"),
        "source": "BKK FloodWatch 2026 (flood.autobahn.bot, MIT) · ข้อมูล HII/สสน., กทม., Open-Meteo, Traffy",
        "source_url": "https://flood.autobahn.bot/",
        "point": {
            "risk": f.get("risk"), "title": f.get("title"), "desc": f.get("desc"), "basis": f.get("basis"),
            "channel_trend": f.get("channel_trend"), "rain_next24_mm": pt.get("rain_next24_mm"),
            "rain_band": pt.get("rain_band"), "traffy_1km_6h": ev.get("traffy_flood_reports_1km_6h"),
            "area": pt.get("area"), "warnings": pt.get("warnings"),
        },
        "gauges": gauges,
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    print("outlook: risk=%s, %d gauges within %d km" % (f.get("risk"), len(gauges), RADIUS_KM))
    return 0


if __name__ == "__main__":
    sys.exit(main())
