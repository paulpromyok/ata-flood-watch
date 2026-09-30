#!/usr/bin/env python3
"""Tie every BMA/HII canal gauge to the OSM waterways it measures -> data/canal_net.json.

The page paints each waterway piece (~150 m) with the reading of the nearest gauge on the SAME canal,
fading with distance, and every other waterway light blue. This file holds only geometry and the
gauge-to-piece links; the colours come from the live readings in latest.json, so it only needs a
rebuild when gauges or the OSM waterways change (monthly, with the other map layers).

Waterways: every OSM waterway=canal|drain|river in Bangkok (named or not), fetched from Overpass;
if Overpass is down, the named canals in data/canals.geojson.
Matching: a piece takes the reading of the nearest gauge that is either on a waterway of the same
name (within REACH_M), or close by: an unnamed stretch within NEAR_REACH_M, a differently named
one within OTHER_NAME_M (so a crossing canal is not painted with the wrong gauge). Stdlib only. Geometry © OpenStreetMap contributors (ODbL).
"""
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANALS = os.path.join(HERE, "data", "canals.geojson")
LATEST = os.path.join(HERE, "data", "latest.json")
OUT = os.path.join(HERE, "data", "canal_net.json")
PIECE_M, REACH_M, NEAR_REACH_M, OTHER_NAME_M = 150, 4000, 700, 250
BBOX = "13.49,100.32,13.96,100.94"
Q = f'[out:json][timeout:180];way["waterway"~"^(canal|river|drain)$"]({BBOX});out geom;'


def meters(lat1, lon1, lat2, lon2):
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371000 * math.hypot(x, y)


def norm(name):
    n = (name or "").strip()
    n = re.sub(r"^(?:ค\.|คลอง)\s*", "คลอง", n)
    n = re.sub(r"ช่วง.*$", "", n)
    n = re.sub(r"[ฯ\s]", "", n)
    n = re.sub(r"\d+$", "", n)
    return n


def pieces_of(line):
    """Split a polyline into ~PIECE_M pieces: [[(lon, lat), ...], ...]."""
    out, cur, acc = [], [line[0]], 0.0
    for a, b in zip(line, line[1:]):
        acc += meters(a[1], a[0], b[1], b[0])
        cur.append(b)
        if acc >= PIECE_M:
            out.append(cur)
            cur, acc = [b], 0.0
    if len(cur) > 1:
        out.append(cur)
    return out


def load_waterways():
    """[(name, [[lon, lat], ...]), ...] from Overpass, or the named canals file as a fallback."""
    try:
        sys.path.insert(0, HERE)
        import build_geo
        build_geo.MIRRORS[:] = build_geo.MIRRORS[:2]
        els = build_geo.overpass(Q)
        out = []
        for el in els:
            ln = build_geo.line(el, 0.00012)
            if ln:
                out.append(((el.get("tags") or {}).get("name") or "", ln))
        if len(out) > 1000:
            print("waterways from Overpass: %d ways" % len(out))
            return out
    except BaseException as e:  # overpass() raises SystemExit when every mirror fails
        print("::warning::Overpass unavailable (%s); using canals.geojson" % e)
    feats = json.load(open(CANALS, encoding="utf-8"))["features"]
    out = []
    for f in feats:
        g = f.get("geometry") or {}
        parts = g["coordinates"] if g.get("type") == "MultiLineString" else [g.get("coordinates") or []]
        out.extend((f["properties"].get("name") or "", part) for part in parts if len(part) > 1)
    return out


def main():
    ways = load_waterways()
    latest = json.load(open(LATEST, encoding="utf-8"))
    gauges = [g for g in (latest["stations"].get("canal") or []) + (latest["stations"].get("river") or [])
              if g.get("lat") is not None and g.get("lon") is not None]
    names = sorted({n for n, _ in ways})
    name_ix = {n: i for i, n in enumerate(names)}
    keys = {n: norm(n) for n in names}

    def same(gkey, n):
        k = keys[n]
        return bool(gkey) and bool(k) and (k == gkey or (len(k) > 5 and len(gkey) > 5 and (k.startswith(gkey) or gkey.startswith(k))))

    ginfo = [(g["lat"], g["lon"], norm(g.get("canal") or g.get("name"))) for g in gauges]
    grid = {}
    for gi, (la, lo, _) in enumerate(ginfo):
        grid.setdefault((int(la * 25), int(lo * 25)), []).append(gi)  # ~4.4 km cells

    pieces, used, lit_g = [], {}, set()
    for n, ln in ways:
        ni = name_ix[n]
        for p in pieces_of([tuple(c) for c in ln]):
            mid = p[len(p) // 2]
            cx, cy = int(mid[1] * 25), int(mid[0] * 25)
            best, bd = -1, None
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for gi in grid.get((cx + dx, cy + dy), ()):
                        la, lo, gkey = ginfo[gi]
                        d = meters(mid[1], mid[0], la, lo)
                        ok = d <= REACH_M if same(gkey, n) else d <= (NEAR_REACH_M if not n else OTHER_NAME_M)
                        if ok and (bd is None or d < bd):
                            best, bd = gi, d
            if best >= 0:
                idx = used.setdefault(best, len(used))
                lit_g.add(best)
                pieces.append([ni, idx, int(bd // 50 * 50), [list(c) for c in p]])
            else:
                pieces.append([ni, -1, -1, [list(c) for c in p]])
    ids = [None] * len(used)
    for gi, idx in used.items():
        ids[idx] = gauges[gi]["id"]
    res = {"version": 2, "attribution": "© OpenStreetMap contributors (ODbL)", "names": names, "gauges": ids, "pieces": pieces,
           "note": "piece = [name_index, gauge_index or -1, distance_m (50 m steps) or -1, [[lon,lat],...]]"}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(res, fh, ensure_ascii=False, separators=(",", ":"))
    lit = sum(1 for p in pieces if p[1] >= 0)
    print("canal net: %d pieces (%d coloured) from %d ways, %d/%d gauges light a waterway"
          % (len(pieces), lit, len(ways), len(lit_g), len(gauges)))


if __name__ == "__main__":
    main()
