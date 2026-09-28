#!/usr/bin/env python3
"""Classify road-flood reports by severity and merge them per road.

Reads  data/latest.json (events from Longdo Traffic / iTIC / DOH) and data/roads.geojson (OSM)
Writes data/road_status.json:
  events: [{id, level, depth_cm, uturn}]            one entry per report
  roads:  [{key, name, level, n, official, depth_cm, latest, lat, lon, ids, uturn, lines}]
          one entry per road stretch, lines = the OSM geometry within ~400 m of its reports

Levels (highest wins):
  4 ผ่านไม่ได้   road closed by flood, "รถไม่สามารถสัญจร/ผ่านไม่ได้", depth >= 40 cm
  3 วิกฤต        red report, small cars cannot pass, depth 30-39 cm, DOH "ผ่านไม่ได้" at a U-turn only
  2 ท่วมขัง       flooding on the road, depth 15-29 cm, "ท่วมสูง / ทุกช่องทาง"
  1 ผ่านได้       DOH "(ผ่านได้)", depth < 15 cm, receding
Stdlib only.
"""
import json
import math
import os
import re
from collections import defaultdict

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LATEST = os.path.join(HERE, "data", "latest.json")
ROADS = os.path.join(HERE, "data", "roads.geojson")
OUT = os.path.join(HERE, "data", "road_status.json")

LEVEL_TH = {4: "ผ่านไม่ได้", 3: "วิกฤต", 2: "ท่วมขัง", 1: "ผ่านได้"}
MATCH_M = 300      # a road segment belongs to a report when it passes within this distance
CLIP_M = 400       # keep geometry within this distance of a report

DEPTH_RANGE = re.compile(r"(\d{1,3})\s*(?:-|–|ถึง)\s*(\d{1,3})\s*(?:ซม|ซ\.ม|cm|เซน)", re.I)
DEPTH_ONE = re.compile(r"(\d{1,3})\s*(?:ซม|ซ\.ม|cm|เซน)", re.I)
DOH = re.compile(r"ทางหลวง\s*(?:หมายเลข\s*)?(\d+)\s*ช่วง\s*([^()]+?)\s*(?:\(|$)")


def meters(lat1, lon1, lat2, lon2):
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371000 * math.hypot(x, y)


def depth(e):
    vals = [e["depth_cm"]] if e.get("depth_cm") else []
    text = (e.get("title") or "") + " " + (e.get("text") or "")
    for a, b in DEPTH_RANGE.findall(text):
        vals.append(max(int(a), int(b)))
    if not vals:
        vals += [int(v) for v in DEPTH_ONE.findall(text)]
    vals = [v for v in vals if 0 < v <= 200]
    return max(vals) if vals else None


def classify(e):
    text = " ".join([e.get("title") or "", e.get("text") or "", e.get("road_key") or ""])
    d = depth(e)
    uturn = bool(re.search(r"จุดกลับรถ|ทางกลับรถ", text))
    flood_related = bool(re.search(r"น้ำ|ท่วม", text))
    small_car = bool(re.search(r"รถเล็ก", text))
    blocked = bool(re.search(r"ไม่สามารถ(?:สัญจร|ผ่าน)|สัญจรไม่ได้|ผ่านไม่ได้|รถผ่านไม่ได้", text))
    if e.get("kind") == "roadclosed" and not flood_related:
        return None, d, uturn            # construction closures etc. are not flood reports
    if (e.get("kind") == "roadclosed") or (d and d >= 40) or (blocked and not small_car and not uturn):
        lv = 4
    elif e.get("color") == "red" or small_car or (d and d >= 30) or blocked:
        lv = 3
    elif re.search(r"\(ผ่านได้\)|ลดลง|คลี่คลาย", text) or e.get("color") == "green" or (d is not None and d < 15):
        lv = 1
    else:
        lv = 2
    return lv, d, uturn


def road_group(e):
    text = (e.get("title") or "") + " " + (e.get("text") or "")
    m = DOH.search(text)
    if m:
        return "doh:" + m.group(1), "ทางหลวง " + m.group(1) + " ช่วง " + m.group(2).strip(), m.group(1)
    key = (e.get("road_key") or "").strip()
    name = re.sub(r"^(น้ำท่วม|ถนนปิด)\s*", "", (e.get("road") or e.get("title") or "").strip())
    if not name:
        return "area:" + str(e.get("id")), "จุดในเขต" + (e.get("district") or "ไม่ระบุ"), None
    if not key:
        key = name
    key = re.sub(r"(ขาเข้า|ขาออก)$", "", re.sub(r"\s+", "", key))
    return "road:" + key, re.sub(r"\s*(ขาเข้า|ขาออก)\s*$", "", name), None


def norm(name):
    n = re.sub(r"^(ถนน|ถ\.)\s*", "", (name or "").strip())
    return re.sub(r"\s+", "", n)


def main():
    latest = json.load(open(LATEST, encoding="utf-8"))
    try:
        roads = json.load(open(ROADS, encoding="utf-8"))["features"]
    except (OSError, ValueError, KeyError):
        roads = []

    # spatial index of road vertices, ~1 km cells
    cells = defaultdict(list)
    lines = []
    for f in roads:
        p = f.get("properties") or {}
        g = f.get("geometry") or {}
        parts = g.get("coordinates") or []
        if g.get("type") == "LineString":
            parts = [parts]
        for part in parts:
            idx = len(lines)
            lines.append((norm(p.get("key") or p.get("name")), str(p.get("ref") or ""), part))
            for lon, lat in part:
                cells[(round(lat, 2), round(lon, 2))].append(idx)

    def nearby(lat, lon):
        out = set()
        for dy in (-0.01, 0, 0.01):
            for dx in (-0.01, 0, 0.01):
                out.update(cells.get((round(lat + dy, 2), round(lon + dx, 2)), ()))
        return out

    ev_out, groups = [], {}
    for e in latest.get("events", []):
        lv, d, uturn = classify(e)
        if lv is None or e.get("lat") is None:
            continue
        ev_out.append({"id": e["id"], "level": lv, "depth_cm": d, "uturn": uturn})
        gk, gname, ref = road_group(e)
        g = groups.setdefault(gk, {"key": gk, "name": gname, "ref": ref, "level": 0, "n": 0, "official": 0,
                                    "depth_cm": None, "latest": "", "ids": [], "pts": [], "uturn_only": True})
        g["n"] += 1
        if ref:
            sec = re.search(r"ช่วง\s*(.+)$", gname)
            g.setdefault("sections", set()).add(sec.group(1) if sec else "")
        g["official"] += 1 if e.get("official") else 0
        g["ids"].append(e["id"])
        g["pts"].append((e["lat"], e["lon"], lv))
        g["uturn_only"] = g["uturn_only"] and uturn
        if d and (g["depth_cm"] is None or d > g["depth_cm"]):
            g["depth_cm"] = d
        if (e.get("start") or "") > g["latest"]:
            g["latest"] = e.get("start") or ""
        if lv > g["level"]:
            g["level"], g["lat"], g["lon"] = lv, e["lat"], e["lon"]

    out_roads = []
    for g in groups.values():
        want = norm(g["name"]) if not g["ref"] else None
        segs = []
        for lat, lon, _ in g["pts"]:
            cand = nearby(lat, lon)
            best = []
            for i in cand:
                nm, ref, part = lines[i]
                if g["ref"]:
                    ok = ref.split(";")[0].strip() == g["ref"]
                else:
                    ok = bool(want) and (nm == want or (len(want) > 3 and (want in nm or nm in want)))
                if not ok:
                    continue
                if min(meters(lat, lon, y, x) for x, y in part) <= MATCH_M:
                    best.append(i)
            for i in best:
                run = []
                for x, y in lines[i][2]:
                    if meters(lat, lon, y, x) <= CLIP_M:
                        run.append([round(x, 5), round(y, 5)])
                    elif len(run) > 1:
                        segs.append(run); run = []
                    else:
                        run = []
                if len(run) > 1:
                    segs.append(run)
        if g["ref"]:
            secs = sorted(s for s in g.get("sections", ()) if s)
            g["name"] = "ทางหลวง " + g["ref"] + (" ช่วง " + secs[0] if len(secs) == 1 else " (%d ช่วง)" % len(secs) if secs else "")
        out_roads.append({
            "key": g["key"], "name": g["name"], "level": g["level"], "level_th": LEVEL_TH[g["level"]],
            "n": g["n"], "official": g["official"], "depth_cm": g["depth_cm"], "latest": g["latest"],
            "lat": g["lat"], "lon": g["lon"], "ids": g["ids"], "uturn": g["uturn_only"], "lines": segs,
        })
    out_roads.sort(key=lambda r: (-r["level"], -r["n"], r["name"]))
    res = {"generated_at": latest.get("generated_at"), "levels": LEVEL_TH, "events": ev_out, "roads": out_roads}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
    cnt = defaultdict(int)
    for r in out_roads:
        cnt[r["level"]] += 1
    print("wrote %s: %d reports, %d roads, by level %s, %d with geometry" % (
        OUT, len(ev_out), len(out_roads), dict(sorted(cnt.items(), reverse=True)), sum(1 for r in out_roads if r["lines"])))


if __name__ == "__main__":
    main()
