/* ATA Flood Watch — front end. Reads data/*.json produced by fetch_data.py (GitHub Actions). */
(function () {
  "use strict";
  var C = window.FW_CONFIG, H = C.home, LK = (C.longdo_key || "").trim(), LW = "https://weather.longdo.com/rain/api/v1/";
  var LV = { severe: 3, warning: 2, watch: 1, normal: 0 };
  var ST = { overbank: 4, critical: 3, warning: 2, normal: 1, unknown: 0 };
  var STTH = { overbank: "ล้นตลิ่ง", critical: "เกินวิกฤต", warning: "เฝ้าระวัง", normal: "ปกติ", unknown: "ไม่มีเกณฑ์" };
  var TFTH = { new: "รอรับเรื่อง", working: "กำลังดำเนินการ", done: "เสร็จแล้ว", finish: "เสร็จแล้ว", forward: "ส่งต่อ" };
  var PROVS = ["กรุงเทพมหานคร", "สมุทรปราการ", "นนทบุรี", "ปทุมธานี", "สมุทรสาคร"];
  var css = getComputedStyle(document.documentElement);
  function cv(n) { return css.getPropertyValue(n).trim(); }
  var COL = { overbank: cv("--sev"), critical: cv("--warn"), warning: cv("--watch"), normal: cv("--ok"), unknown: cv("--unk"),
    red: cv("--sev"), orange: cv("--warn"), green: cv("--ok"), traffy: cv("--traffy"), canal: cv("--canal") };
  var FILL = { severe: "#c62b20", warning: "#d9731a", watch: "#c8a000", normal: "transparent" };
  var FOP = { severe: .28, warning: .22, watch: .16, normal: 0 };

  function km(a, b, c, d) { var r = Math.PI / 180, x = Math.sin((c - a) * r / 2), y = Math.sin((d - b) * r / 2); return 2 * 6371 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y)); }
  function esc(t) { var d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
  function hm(iso) { return iso ? iso.slice(11, 16) + " น." : ""; }
  var TM = ["", "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  function dm(iso) { return iso ? (+iso.slice(8, 10)) + " " + TM[+iso.slice(5, 7)] + " " + hm(iso) : ""; }
  function f2(v) { return v == null ? "–" : (+v).toFixed(2); }
  function gmaps(lat, lon) { return "https://www.google.com/maps/@" + lat.toFixed(5) + "," + lon.toFixed(5) + ",16z/data=!5m1!1e1"; }
  function $(id) { return document.getElementById(id); }
  $("tfkm").textContent = C.traffy_km;

  /* ---------- map ---------- */
  var map = L.map("map", { preferCanvas: true, zoomControl: true }).setView([H.lat, H.lon], 12);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
  var G = { dist: L.layerGroup().addTo(map), canal: L.layerGroup().addTo(map), tf: L.layerGroup().addTo(map), gauge: L.layerGroup().addTo(map),
    ev: L.layerGroup().addTo(map), cam: L.layerGroup().addTo(map), radar: L.layerGroup(), fb: L.layerGroup().addTo(map), rp: L.layerGroup().addTo(map) };
  var routeLayer = L.layerGroup().addTo(map);
  C.rings_km.forEach(function (r) {
    L.circle([H.lat, H.lon], { radius: r * 1000, color: cv("--accent"), weight: 1.5, dashArray: "6 6", fill: false, interactive: false }).addTo(map);
    L.marker([H.lat + r / 110.57, H.lon], { interactive: false, icon: L.divIcon({ className: "", html: '<span class="fw-ata-lbl">' + r + ' กม.</span>', iconSize: [40, 14], iconAnchor: [20, 14] }) }).addTo(map);
  });
  L.marker([H.lat, H.lon], { icon: L.divIcon({ className: "", html: '<div class="fw-ata" style="width:16px;height:16px"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 1000 })
    .on("click", showHome).addTo(map);
  L.marker([H.lat, H.lon], { interactive: false, icon: L.divIcon({ className: "", html: '<span class="fw-ata-lbl">' + esc(H.short) + "</span>", iconSize: [40, 14], iconAnchor: [20, 26] }) }).addTo(map);

  var info = $("info"), S = null, DM = {}, TR = { reports: [] }, CANALS = null, DISTS = null, meMarker = null, RS = null, EVL = {}, sevMin = 3;
  var RLV = { 4: "ผ่านไม่ได้", 3: "วิกฤต", 2: "ท่วมขัง", 1: "ผ่านได้" };
  var RCOL = { 4: "#7a0010", 3: COL.overbank, 2: COL.critical, 1: COL.warning };
  function evLevel(e) { var x = EVL[e.id]; return x ? x.level : (e.color === "red" ? 3 : e.color === "green" ? 1 : 2); }
  function rpill(lv) { return '<span class="pill rl-' + lv + '">' + RLV[lv] + "</span>"; }
  function card(html) { curShare = null; openSheet('<div class="sh-bar"><button type="button" id="sheetClose" class="sh-x" aria-label="ปิด">×</button></div><div class="sh-card">' + html + "</div>"); }
  function lk(lat, lon, extra) { return '<span class="links"><a href="' + gmaps(lat, lon) + '" target="_blank" rel="noopener">Google Maps จราจร</a>' + (extra || "") + "</span>"; }
  function showHome() {
    info.innerHTML = ('<span class="t">' + esc(H.name) + '</span><span class="m">' + esc(H.addr) + '</span><span class="m">แตะจุดบนแผนที่เพื่อดูรายละเอียด · แตะพื้นเขตเพื่อดูระดับเตือนภัย</span>' +
      lk(H.lat, H.lon, '<a href="https://www.rainviewer.com/map.html?loc=' + H.lat.toFixed(3) + "," + H.lon.toFixed(3) + ',11" target="_blank" rel="noopener">เรดาร์ฝน</a>'));
  }
  function showGauge(d) { gaugeSheet(d); }
  function showEvent(d) {
    var x = EVL[d.id] || {}, dep = x.depth_cm || d.depth_cm;
    card('<span class="t">' + rpill(evLevel(d)) + " " + esc(d.title) + '</span><span class="m">' + esc(d.text) + '</span><span class="m">' + dm(d.start) + " · " + esc(d.source) + (d.official ? " (ยืนยัน)" : " (ประชาชนแจ้ง)") +
      (dep ? " · ลึก ~" + dep + " ซม." : "") + (x.uturn ? " · เฉพาะจุดกลับรถ" : "") + " · " + d.km.toFixed(1) + " กม. จาก " + esc(H.short) + "</span>" + vehRow(evLevel(d), dep) + lk(d.lat, d.lon));
  }
  function showCam(d) {
    card('<span class="t">กล้อง: ' + esc(d.title) + '</span><span class="m">' + esc(d.org) + " · " + d.km.toFixed(1) + " กม. จาก " + esc(H.short) + (d.live ? "" : " · อาจไม่ออนไลน์") + "</span>" +
      lk(d.lat, d.lon, '<a href="' + esc(d.link) + '" target="_blank" rel="noopener">ดูภาพกล้อง</a>'));
  }
  function showTf(d) {
    card('<span class="t">Traffy · ' + esc(TFTH[d.state] || d.state) + "</span>" +
      (d.photo && TR.photo_base ? '<img src="' + esc(TR.photo_base + d.photo) + '" alt="" loading="lazy" style="max-width:100%;border-radius:8px;max-height:220px;object-fit:cover">' : "") +
      "<span>" + esc(d.text) + '</span><span class="m">' + dm(d.time) + " · เขต" + esc(d.district) + " · " + d.km.toFixed(1) + " กม. จาก " + esc(H.short) + "</span>" +
      lk(d.lat, d.lon, TR.link_base ? '<a href="' + esc(TR.link_base + d.id) + '" target="_blank" rel="noopener">ดูเรื่องเต็ม</a>' : ""));
  }
  function showDist(d) {
    card('<span class="t">' + esc(d.name) + ' <span class="pill lv-' + d.level + '">' + esc(d.level_th) + '</span></span><span class="m">' + esc(d.province) + " · " + d.km.toFixed(1) + " กม. จาก " + esc(H.short) +
      " · จุดวัดน้ำ " + d.g.length + " · น้ำท่วมบนถนน " + d.e.length + " · Traffy " + d.tf + "</span><span>" + esc(d.advice) + "</span>");
  }

  /* ---------- data ---------- */
  var BASE = (C.data_base && C.data_base.indexOf("/OWNER/") < 0) ? C.data_base : "data/";
  if (BASE === "data/" && C.data_base) console.warn("config.js: set data_base (replace OWNER) so data stays fresh on Vercel");
  function j(url) { return fetch(url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }); }
  function load() {
    return Promise.all([j(BASE + "latest.json"), j(BASE + "traffy.json").catch(function () { return { reports: [] }; }), j(BASE + "road_status.json").catch(function () { return null; }),
      CANALS ? Promise.resolve(CANALS) : j(BASE + "canals.geojson"), DISTS ? Promise.resolve(DISTS) : j(BASE + "districts.geojson"),
      j(BASE + "outlook.json").catch(function () { return null; }), j(BASE + "help.json").catch(function () { return null; }), j(BASE + "gauge_detail.json").catch(function () { return null; })])
      .then(function (r) {
        S = r[0]; TR = r[1] || { reports: [] }; RS = r[2]; CANALS = r[3]; DISTS = r[4]; OL = r[5]; HL = r[6]; GD = r[7]; EVL = {}; if (RS) RS.events.forEach(function (x) { EVL[x.id] = x; });
        render(); renderOutlook(); renderTeasers(); loadFB(); loadReports();
        if (TAB === "fc") { loadRainArea(); renderGList(); } if (TAB === "help") renderHelp(); if (TAB === "canal" && CM) drawCanal();
        if (!deepDone) { deepDone = true; openFromHash(); }
      })
      .catch(function (e) { $("stamp").textContent = "โหลดข้อมูลไม่สำเร็จ ลองกดโหลดใหม่"; $("stamp").className = "stamp old"; console.error(e); });
  }

  function render() {
    var gen = S.generated_at, age = (Date.now() - new Date(gen).getTime()) / 60000;
    $("stamp").textContent = "ข้อมูล ณ " + dm(gen) + (age > C.stale_min ? " · เก่า " + Math.round(age) + " นาที" : "");
    $("stamp").className = "stamp" + (age > C.stale_min ? " old" : "");
    DM = {};
    S.districts.forEach(function (d) { d.km = km(H.lat, H.lon, d.lat, d.lon); d.g = []; d.e = []; d.c = []; d.tf = 0; DM[d.id] = d; });
    var gauges = [].concat(S.stations.canal || [], S.stations.river || []).filter(function (s) { return s.lat && !((s.status == null || s.status === "unknown") && (s.flags || []).indexOf("stale") > -1); });
    gauges.forEach(function (s) { s.st = s.status || "unknown"; s.stale = (s.flags || []).indexOf("stale") > -1; s.km = km(H.lat, H.lon, s.lat, s.lon); var d = DM[s.district] || DM[s.amphoe]; if (d) d.g.push(s); });
    (S.events || []).forEach(function (e) { e.km = km(H.lat, H.lon, e.lat, e.lon); if (DM[e.district]) DM[e.district].e.push(e); });
    (S.cameras || []).forEach(function (c) { c.km = km(H.lat, H.lon, c.lat, c.lon); if (DM[c.district]) DM[c.district].c.push(c); });
    var tr = (TR.reports || []);
    tr.forEach(function (t) { t.km = km(H.lat, H.lon, t.lat, t.lon); if (DM[t.district]) DM[t.district].tf++; });
    var rain = {};
    (S.stations.rain || []).forEach(function (s) { var k = s.district || s.amphoe; if (s.rain_24h != null && (!rain[k] || s.rain_24h > rain[k][0])) rain[k] = [s.rain_24h, s.name]; });
    var canalStatus = {}; (S.canals || []).forEach(function (c) { canalStatus[c.name] = c.status; });

    Object.keys(G).forEach(function (k) { if (k !== "radar" && k !== "fb" && k !== "rp") G[k].clearLayers(); });
    L.geoJSON(DISTS, {
      style: function (f) { var d = DM[f.properties.id], lv = d ? d.level : "normal"; return { color: "#8aa0a6", weight: 1, fillColor: FILL[lv], fillOpacity: FOP[lv] }; },
      onEachFeature: function (f, l) { l.on("click", function (e) { pointCheck(e.latlng); }); }
    }).addTo(G.dist);
    L.geoJSON(CANALS, {
      filter: function (f) { var s = canalStatus[f.properties.name]; return f.properties.kind === "river" || !!s; },
      style: function (f) { var s = canalStatus[f.properties.name]; return { color: s === "overbank" ? COL.overbank : s === "critical" ? COL.critical : COL.canal, weight: f.properties.kind === "river" ? 3 : (s === "overbank" || s === "critical") ? 3 : 2, opacity: .85 }; },
      onEachFeature: function (f, l) { l.bindTooltip(f.properties.name + (canalStatus[f.properties.name] ? " · " + (STTH[canalStatus[f.properties.name]] || "") : ""), { sticky: true }); }
    }).addTo(G.canal);
    tr.filter(function (t) { return t.km <= C.traffy_km; }).forEach(function (t) {
      L.circleMarker([t.lat, t.lon], { radius: 4, color: COL.traffy, weight: 0, fillColor: COL.traffy, fillOpacity: .55 }).on("click", function () { showTf(t); }).addTo(G.tf);
    });
    gauges.filter(function (s) { return ST[s.st] >= 2; }).sort(function (a, b) { return ST[a.st] - ST[b.st]; }).forEach(function (s) {
      L.circleMarker([s.lat, s.lon], { radius: ST[s.st] >= 3 ? 7 : 5, color: "#fff", weight: 1.5, fillColor: COL[s.st], fillOpacity: s.stale ? .5 : 1 }).on("click", function () { showGauge(s); }).addTo(G.gauge);
    });
    drawRoads();
    (S.cameras || []).forEach(function (c) {
      L.marker([c.lat, c.lon], { icon: L.divIcon({ className: "", html: '<div class="fw-cam" style="width:20px;height:16px">▶</div>', iconSize: [20, 16], iconAnchor: [10, 8] }) })
        .on("click", function () { showCam(c); }).addTo(G.cam);
    });

    homeCard(gauges, tr);
    S._rain = rain; S._tr = tr; S._gauges = gauges;
    renderList();
    renderRoads();
  }

  function homeCard(gauges, tr) {
    var R = C.summary_km, d = DM[H.district];
    var g = gauges.filter(function (x) { return x.km <= R && ST[x.st] >= 3 && !x.stale; }).length;
    var e = RS ? RS.roads.filter(function (x) { return x.level >= 3 && km(H.lat, H.lon, x.lat, x.lon) <= R; }).length : (S.events || []).filter(function (x) { return x.km <= R; }).length;
    var t = tr.filter(function (x) { return x.km <= R; }).length;
    var cam = (S.cameras || []).slice().sort(function (a, b) { return a.km - b.km; })[0];
    var hot = S.districts.filter(function (x) { return x.km <= 8 && x.level === "severe"; }).sort(function (a, b) { return a.km - b.km; });
    $("homeCard").innerHTML = '<div class="row"><span class="t">ออฟฟิศ ' + esc(H.short) + " · เขต" + esc(H.district) + "</span>" + (d ? '<span class="pill lv-' + d.level + '">' + esc(d.level_th) + "</span>" : "") + "</div>" +
      '<div class="kpis"><div class="kpi"><b>' + g + "</b><small>จุดวัดน้ำเกินวิกฤต ใน " + R + ' กม.</small></div><div class="kpi"><b>' + e + "</b><small>" + (RS ? "ถนนวิกฤต/ผ่านไม่ได้ ใน " : "จุดน้ำท่วมบนถนน ใน ") + R + ' กม.</small></div>' +
      '<div class="kpi"><b>' + t + "</b><small>ประชาชนแจ้ง Traffy ใน " + R + ' กม. (24 ชม.)</small></div><div class="kpi"><b>' + (cam ? cam.km.toFixed(1) : "–") + "</b><small>กม. ถึงกล้องใกล้สุด</small></div></div>" +
      (hot.length ? '<div class="near">เขตระดับอันตรายใกล้ออฟฟิศ: ' + hot.map(function (x) { return "<b>" + esc(x.name) + "</b> " + x.km.toFixed(0) + " กม."; }).join(" · ") + "</div>" : "") +
      '<div class="rainnow" id="rainNow"' + (LK ? "" : " hidden") + "></div>" +
      (d ? '<div class="adv">' + esc(d.advice) + "</div>" : "");
    loadRainNow();
  }

  /* ---------- rain now + nowcast at ATA (Longdo Weather) ---------- */
  var RAIN_LV = { no_rain: 0, very_light: 1, light: 2, moderate: 3, heavy: 4, very_heavy: 5 };
  var RAIN_TH = ["ไม่มีฝน", "ละอองฝน", "ฝนเบา", "ฝนปานกลาง", "ฝนหนัก", "ฝนหนักมาก"];
  var rainCache = null;
  function rainLv(o) { return o && o.rain ? (o.rain.intensity != null ? o.rain.intensity : RAIN_LV[o.rain.level] || 0) : null; }
  function rainPill(lv) { return lv == null ? '<span class="pill rn-x">ไม่มีข้อมูล</span>' : '<span class="pill rn-' + lv + '">' + RAIN_TH[lv] + "</span>"; }
  function drawRainNow() {
    var el = $("rainNow"); if (!el || !rainCache) return;
    var r = rainCache, now = rainLv(r.loc), f = (r.fc && r.fc.forecast) || [], a = r.area && r.area.stats;
    var f15 = f[0] && f[0].available ? rainLv(f[0]) : null, f30 = f[1] && f[1].available ? rainLv(f[1]) : null;
    var worst = Math.max(now || 0, f15 || 0, f30 || 0);
    el.className = "rainnow" + (worst >= 4 ? " hot" : worst >= 2 ? " wet" : "");
    el.innerHTML = '<div class="rrowh"><span>ฝนที่ ' + esc(H.short) + "</span><span>ตอนนี้ " + rainPill(now) + "</span><span>+15 นาที " + rainPill(f15) + "</span><span>+30 นาที " + rainPill(f30) + "</span></div>" +
      (a ? '<div class="m">รัศมี 10 กม.: ฝนครอบคลุม ' + Math.round(a.rain_coverage_pct) + "% · แรงสุด " + RAIN_TH[a.max_intensity || 0] +
        (r.loc && r.loc.unix_time ? " · เรดาร์ " + rTime(+r.loc.unix_time) : "") + "</div>" : "") +
      (worst >= 4 ? '<div class="m"><b>ฝนหนักกำลังมา/กำลังตก — เลี่ยงถนนที่ท่วมง่าย และเฝ้าดูระดับน้ำคลองใกล้ออฟฟิศ</b></div>' : "");
  }
  function loadRainNow() {
    if (!LK) return;
    if (rainCache && Date.now() - rainCache.at < 4 * 60000) { drawRainNow(); return; }
    var q = "lat=" + H.lat + "&lon=" + H.lon + "&key=" + encodeURIComponent(LK);
    function j(u) { return fetch(LW + u).then(function (r) { if (!r.ok) throw r.status; return r.json(); }).catch(function () { return null; }); }
    Promise.all([j("location?" + q), j("forecast/location?" + q), j("area?" + q + "&radius_km=10")]).then(function (x) {
      rainCache = { at: Date.now(), loc: x[0], fc: x[1], area: x[2] };
      if (!x[0] && !x[1]) { var el = $("rainNow"); if (el) { el.innerHTML = '<div class="m">โหลดข้อมูลฝนจาก Longdo ไม่สำเร็จ (ตรวจ API key)</div>'; } return; }
      drawRainNow();
    });
    loadRainCams();
  }
  /* cameras where the radar currently sees rain */
  var rainCams = L.layerGroup().addTo(map);
  function loadRainCams() {
    fetch(LW + "cameras?key=" + encodeURIComponent(LK)).then(function (r) { return r.json(); }).then(function (m) {
      rainCams.clearLayers();
      (m.cameras || []).forEach(function (c) {
        var d = km(H.lat, H.lon, c.lat, c.lon); if (d > 40) return;
        var lv = rainLv(c) || 1;
        L.marker([c.lat, c.lon], { icon: L.divIcon({ className: "", html: '<div class="fw-rcam rn-' + lv + '">☂</div>', iconSize: [20, 20], iconAnchor: [10, 10] }) })
          .bindPopup("<b>" + esc(c.title) + "</b><br>" + esc(RAIN_TH[lv]) + " ที่กล้องนี้ · " + d.toFixed(1) + " กม. จาก " + esc(H.short) +
            (c.hls_url ? '<br><a href="' + esc(c.hls_url) + '" target="_blank" rel="noopener">ดูภาพสด</a>' : "") + '<br><small>' + esc(c.organization || "") + "</small>")
          .addTo(rainCams);
      });
    }).catch(function () {});
  }

  /* ---------- canal outlook 12/24/48 h (BKK FloodWatch 2026, via data/outlook.json) ---------- */
  var OL = null;
  var RISK_TH = { high: "เสี่ยงสูง", moderate: "เสี่ยงปานกลาง", low: "เสี่ยงต่ำ" };
  var OST = { overbank: "ล้นตลิ่ง", critical: "เกินวิกฤต", warning: "เฝ้าระวัง", normal: "ปกติ" };
  function cm(v) { return v == null ? "?" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(Math.round(v * 100)); }
  function trendCell(label, c) {
    if (!c) return "<div><b>" + label + "</b>–</div>";
    var lk = c.likely || c.range90 || [], rng = lk.length === 2 ? cm(lk[0]) + " ถึง " + cm(lk[1]) + " ซม." : "";
    // show a direction only where a tested model beat "no change" (their rule): not persistence, not unproven, not low confidence
    var sure = c.method && c.method !== "persistence" && c.proven !== false && c.confidence !== "low";
    var dir = !sure ? '<span class="un">? ไม่แน่ชัด</span>' : c.dir === "rising" || c.dir === "up" ? '<span class="up">↑ ขึ้น</span>' : c.dir === "falling" || c.dir === "down" ? '<span class="dn">↓ ลง</span>' : '<span class="st">→ ทรงตัว</span>';
    return "<div><b>" + label + "</b>" + dir + "<br>" + rng + "</div>";
  }
  function gStatus(g) {  // [pill class, label] from the numbers, so the pill never contradicts the text
    if (g.freeboard != null && g.freeboard < 0) return ["severe", "ล้นตลิ่ง"];
    if (g.over_crit != null && g.over_crit > 0) return ["warning", "เกินวิกฤต กทม."];
    var m = { overbank: ["severe", "ล้นตลิ่ง"], critical: ["warning", "เกินวิกฤต"], warning: ["watch", "เฝ้าระวัง"], normal: ["normal", "ปกติ"] };
    return m[g.status] || null;
  }
  function renderOutlook() {
    var sec = $("outlook");
    if (!OL || !OL.gauges) { sec.hidden = true; return; }
    var age = (Date.now() - new Date(OL.fetched_at).getTime()) / 3600000, p = OL.point || {};
    var gs = OL.gauges.filter(function (g) { return !g.stale && g.level != null && g.km <= C.summary_km; }).slice(0, 6);
    if (!gs.length && !p.title) { sec.hidden = true; return; }
    sec.hidden = false;
    $("olBody").innerHTML =
      (p.title ? '<div class="olhead"><span class="t">' + (p.risk ? '<span class="pill rk-' + esc(p.risk) + '">' + esc(RISK_TH[p.risk] || p.risk) + "</span> " : "") + esc(p.title) + "</span>" +
        (p.desc ? "<span>" + esc(p.desc) + "</span>" : "") +
        '<span class="m">ฝน 24 ชม. ข้างหน้า ~' + (p.rain_next24_mm != null ? (+p.rain_next24_mm).toFixed(0) : "?") + " มม." + (p.traffy_1km_6h != null ? " · แจ้งน้ำขังใน 1 กม. (6 ชม.) " + p.traffy_1km_6h + " เรื่อง" : "") + "</span></div>" : "") +
      gs.map(function (g, i) {
        var gst = gStatus(g), now = [g.over_crit != null && g.over_crit > 0 ? "สูงกว่าเกณฑ์ " + Math.round(g.over_crit * 100) + " ซม." : "",
          g.freeboard != null ? (g.freeboard >= 0 ? "ต่ำกว่าตลิ่ง " + Math.round(g.freeboard * 100) + " ซม." : "ล้นตลิ่ง " + Math.round(-g.freeboard * 100) + " ซม.") : ""].filter(Boolean).join(" · ");
        return '<button type="button" class="olg" data-i="' + i + '"><div class="top"><span class="nm">' + esc(g.name) + '</span><span class="now">' + g.km.toFixed(1) + " กม. · " +
          (gst ? '<span class="pill lv-' + gst[0] + '">' + gst[1] + "</span> " : "") + esc(now) + "</span></div>" +
          '<div class="olh">' + trendCell("ใน 12 ชม.", g.c12) + trendCell("ใน 24 ชม.", g.c24) + trendCell("ใน 48 ชม.", g.c48) + "</div></button>";
      }).join("") +
      '<p class="olnote">ช่วงตัวเลข = ช่วงที่น่าจะเป็นของการเปลี่ยนแปลงระดับน้ำ · "ไม่แน่ชัด" = แบบจำลองยังทำได้ไม่ดีกว่าการสมมติว่าน้ำคงที่ ณ จุดนั้น · ' +
        'พยากรณ์จาก <a href="' + esc(OL.source_url) + '" target="_blank" rel="noopener">BKK FloodWatch 2026</a> (MIT) ข้อมูล สสน./กทม. · ดึงเมื่อ ' + dm(new Date(new Date(OL.fetched_at).getTime() + 7 * 3600000).toISOString()) +
        (age > 3 ? ' · <b>ข้อมูลพยากรณ์เก่า ' + Math.round(age) + " ชม.</b>" : "") + "</p>";
    $("olBody").querySelectorAll(".olg").forEach(function (b) {
      b.onclick = function () { showGaugeByCode(gs[+b.dataset.i].code); };
    });
  }



  /* ---------- vehicles (depth limits as used by Floodboard) ---------- */
  var VEH = { moto: ["มอเตอร์ไซค์", 15], sedan: ["รถเก๋ง", 20], pickup: ["กระบะ/รถสูง", 40], truck: ["รถบรรทุก", 60] }, veh = "";
  var VCOL = { blocked: "#7a0010", risky: "#d9731a", ok: "#2f8a57" }, VTH = { blocked: "ผ่านไม่ได้", risky: "เสี่ยง", ok: "ผ่านได้" };
  function vVerdict(level, depth, v) {
    var lim = VEH[v][1];
    if (depth != null && depth > 0) return depth > 60 || depth > lim ? "blocked" : depth > lim * 0.75 ? "risky" : "ok";
    if (level >= 4) return "blocked";
    if (level === 3) return v === "moto" || v === "sedan" ? "blocked" : "risky";
    if (level === 2) return v === "moto" ? "blocked" : v === "sedan" ? "risky" : "ok";
    return v === "moto" ? "risky" : "ok";
  }
  function vehRow(level, depth, given) {
    return '<div class="vrow">' + Object.keys(VEH).map(function (v) { var r = given ? given[v] : vVerdict(level, depth, v); r = r === "passable" ? "ok" : r;
      return '<span class="vp vp-' + r + '">' + VEH[v][0] + " · " + (VTH[r] || r) + "</span>"; }).join("") + "</div>" +
      (given ? "" : '<div class="m">ประเมินจาก' + (depth ? "ความลึก ~" + depth + " ซม." : "ระดับรายงาน (ไม่มีตัวเลขความลึก)") + " · เกณฑ์ มอเตอร์ไซค์ ≤15 · เก๋ง ≤20 · กระบะ ≤40 · บรรทุก ≤60 ซม.</div>");
  }

  /* ---------- Floodboard roads (CC BY 4.0, CORS-enabled) ---------- */
  var FB = null, fbAt = 0;
  function loadFB() {
    if (FB && Date.now() - fbAt < 5 * 60000) { drawFB(); return; }
    fetch("https://www.floodboard.org/api/export/roads.geojson", { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); })
      .then(function (g) { FB = g; fbAt = Date.now(); drawFB(); }).catch(function () { FB = FB || null; });
  }
  function fbVerdict(p, v) { var x = p.verdict && p.verdict[v]; return x === "blocked" ? "blocked" : x === "risky" ? "risky" : x ? "ok" : p.closedAll ? "blocked" : vVerdict(2, p.depthCm, v); }
  function drawFB() {
    G.fb.clearLayers(); if (!FB || !FB.features) return;
    var v = veh || "sedan";
    FB.features.forEach(function (f) {
      var p = f.properties || {}, vd = fbVerdict(p, v); if (vd === "ok") return;
      var g = f.geometry || {}, parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : []; if (!parts.length) return;
      L.polyline(parts.map(function (s) { return s.map(function (c) { return [c[1], c[0]]; }); }), { color: VCOL[vd], weight: 4, opacity: .9, dashArray: "7 5" }).on("click", function () { showFB(p); }).addTo(G.fb);
    });
  }
  function showFB(p) {
    card('<span class="t">' + esc(p.name || p.nameEn || "ถนน") + '</span><span class="m">Floodboard · ' + (p.depthCm ? "ลึก ~" + p.depthCm + " ซม." : "ไม่ระบุความลึก") + (p.closedAll ? " · ปิดทุกช่องทาง" : "") +
      (p.conf != null ? " · ความมั่นใจ " + Math.round(p.conf * 100) + "%" : "") + (p.updated ? " · อัปเดต " + dm(new Date(+p.updated + 7 * 3600000).toISOString()) : "") + "</span>" +
      vehRow(0, p.depthCm, { moto: fbVerdict(p, "moto"), sedan: fbVerdict(p, "sedan"), pickup: fbVerdict(p, "pickup"), truck: fbVerdict(p, "truck") }) +
      '<span class="m">แหล่ง: ' + esc((p.sources || []).join(", ")) + ' · ข้อมูล <a href="https://www.floodboard.org" target="_blank" rel="noopener">Floodboard</a> (CC BY 4.0)</span>');
  }

  /* ---------- team reports (Vercel function /api/report → private repo) ---------- */
  var RP = [], RPST = { 2: "ท่วม (รถยังผ่านได้)", 3: "รถเล็กผ่านไม่ได้", 4: "ผ่านไม่ได้", 1: "น้ำลดแล้ว" };
  function loadReports() {
    if (!C.report_api) return;
    fetch(C.report_api + "?list=1&hours=24", { cache: "no-store" }).then(function (r) { if (!r.ok) throw r.status; return r.json(); }).then(function (x) {
      RP = x.reports || []; G.rp.clearLayers();
      RP.forEach(function (r) {
        L.marker([r.lat, r.lon], { icon: L.divIcon({ className: "", html: '<div class="fw-rep" style="background:' + RCOL[r.level] + '">!</div>', iconSize: [18, 18], iconAnchor: [9, 9] }) })
          .on("click", function () { showReport(r); }).addTo(G.rp);
      });
    }).catch(function () {});
  }
  function showReport(r) {
    card('<span class="t">' + rpill(r.level) + " รายงานจากทีม · " + esc(RPST[r.level]) + '</span><span class="m">' + dm(new Date(Date.parse(r.time) + 7 * 3600000).toISOString()) + " (" + ago(r.time) + ")" + (r.depth_cm ? " · ลึก ~" + r.depth_cm + " ซม." : "") + "</span>" +
      (r.photo ? '<img src="' + esc(C.report_api + "?photo=" + encodeURIComponent(r.id)) + '" alt="ภาพที่แจ้ง" loading="lazy" style="max-width:100%;border-radius:8px">' : "") +
      (r.note ? "<span>" + esc(r.note) + "</span>" : "") + vehRow(r.level, r.depth_cm) + lk(r.lat, r.lon));
  }

  /* ---------- report form ---------- */
  var repPt = null;
  function openReport() {
    curShare = null;
    if (!C.report_api) {
      openSheet(shHead("แจ้งน้ำท่วม", "", "ระบบรับแจ้งของ " + esc(H.short) + " ยังไม่เปิด") + '<p>แจ้งผ่านช่องทางสาธารณะได้ทันที:</p><div class="links"><a href="https://www.floodboard.org" target="_blank" rel="noopener">Floodboard (แนบรูป + ความลึก)</a><a href="https://page.line.me/traffyfondue" target="_blank" rel="noopener">Traffy Fondue (LINE)</a><a href="tel:1555">โทร 1555</a></div>');
      return;
    }
    openSheet(shHead("แจ้งน้ำท่วม", "", "รายงานจะขึ้นบนแผนที่ของทีมทันที") +
      '<form id="repForm" class="rform">' +
      '<div class="fld"><b>ตำแหน่ง</b><div class="row"><button type="button" id="rpMe">ฉันอยู่ที่นี่</button><button type="button" id="rpPick">แตะบนแผนที่</button></div><div class="m" id="rpWhere">' + (repPt ? repPt[0].toFixed(5) + ", " + repPt[1].toFixed(5) : "ยังไม่เลือกตำแหน่ง") + "</div></div>" +
      '<div class="fld"><b>สิ่งที่เห็น</b><div class="row wr">' + [2, 3, 4, 1].map(function (l, i) { return '<label class="opt"><input type="radio" name="lv" value="' + l + '"' + (i === 0 ? " checked" : "") + ">" + RPST[l] + "</label>"; }).join("") + "</div></div>" +
      '<div class="fld"><b>ความลึกโดยประมาณ (ซม.)</b><div class="row wr">' + [10, 20, 30, 50, 70].map(function (d) { return '<button type="button" class="dchip" data-d="' + d + '">' + (d === 70 ? "70+" : d) + "</button>"; }).join("") +
        '<input type="number" id="rpDepth" min="0" max="200" inputmode="numeric" placeholder="เช่น 25"></div><div class="m">ข้อเท้า ~10 · ครึ่งแข้ง ~20 · เข่า ~45 · ต้นขา ~70 ซม.</div></div>' +
      '<div class="fld"><b>รูปถ่าย (ไม่บังคับ)</b><input type="file" id="rpPhoto" accept="image/*" capture="environment"><div class="m">ย่อขนาดและลบข้อมูลตำแหน่งในไฟล์อัตโนมัติ · หลีกเลี่ยงภาพที่เห็นหน้าบุคคลหรือทะเบียนรถ</div></div>' +
      '<div class="fld"><b>หมายเหตุ (ไม่บังคับ)</b><input type="text" id="rpNote" maxlength="200" placeholder="เช่น หน้าซอย 24 ขาออก"><div class="m">ห้ามใส่ชื่อหรือเบอร์โทร</div></div>' +
      '<button type="submit" class="primary" id="rpSend">ส่งรายงาน</button><div class="m" id="rpMsg"></div></form>');
    $("rpMe").onclick = function () { if (!navigator.geolocation) return; $("rpWhere").textContent = "กำลังหาตำแหน่ง…"; navigator.geolocation.getCurrentPosition(function (p) { repPt = [p.coords.latitude, p.coords.longitude]; $("rpWhere").textContent = repPt[0].toFixed(5) + ", " + repPt[1].toFixed(5) + " (±" + Math.round(p.coords.accuracy) + " ม.)"; }, function () { $("rpWhere").textContent = "ไม่ได้รับสิทธิ์ตำแหน่ง ใช้แตะบนแผนที่แทน"; }, { enableHighAccuracy: true, timeout: 10000 }); };
    $("rpPick").onclick = function () { pickMode = "report"; closeSheet(); showTab("now", true); setTimeout(function () { $("map").scrollIntoView({ block: "center" }); }, 80); toast("แตะตำแหน่งที่น้ำท่วมบนแผนที่"); };
    $("sheetBody").querySelectorAll(".dchip").forEach(function (b) { b.onclick = function () { $("rpDepth").value = b.dataset.d; }; });
    $("repForm").onsubmit = function (e) {
      e.preventDefault();
      if (!repPt) { $("rpMsg").textContent = "กรุณาเลือกตำแหน่งก่อน"; return; }
      var lv = +(document.querySelector('input[name="lv"]:checked') || {}).value || 2, dep = parseInt($("rpDepth").value, 10), f = $("rpPhoto").files[0];
      $("rpSend").disabled = true; $("rpMsg").textContent = "กำลังส่ง…";
      (f ? shrink(f) : Promise.resolve(null)).then(function (photo) {
        var body = { lat: repPt[0], lon: repPt[1], level: lv, depth_cm: isNaN(dep) ? null : dep, note: $("rpNote").value.slice(0, 200), photo: photo, pin: lsGet("fw_pin") };
        function send() { return fetch(C.report_api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
        return send().then(function (r) {
          if (r.status !== 403) return r;
          var pin = window.prompt("ใส่รหัสทีมสำหรับแจ้งน้ำท่วม"); if (!pin) return r;
          body.pin = pin; return send().then(function (r2) { if (r2.ok) lsSet("fw_pin", pin); return r2; });
        });
      }).then(function (r) { if (!r.ok) throw r.status; return r.json(); }).then(function () {
        $("rpMsg").textContent = "ส่งแล้ว ขอบคุณครับ"; setTimeout(function () { closeSheet(); loadReports(); }, 900);
      }).catch(function (x) { $("rpSend").disabled = false; $("rpMsg").textContent = "ส่งไม่สำเร็จ (" + x + ") ลองใหม่อีกครั้ง"; });
    };
  }
  function shrink(file) {  // re-encode through a canvas: max 1280 px, JPEG, no EXIF/GPS
    return new Promise(function (ok, bad) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () { var k = Math.min(1, 1280 / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", 0.72)); };
      img.onerror = function () { bad("รูปเปิดไม่ได้"); }; img.src = url;
    });
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function toast(t) { var el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(el._t); el._t = setTimeout(function () { el.hidden = true; }, 3500); }

  /* ---------- route that avoids flooded roads ---------- */
  var RT = { a: null, b: null, aName: H.short, bName: "", veh: "sedan", res: null, pick: 0 }, pickMode = null;
  function openRoute() {
    curShare = null;
    var vopts = Object.keys(VEH).map(function (v) { return '<option value="' + v + '"' + (RT.veh === v ? " selected" : "") + ">" + VEH[v][0] + " (≤" + VEH[v][1] + " ซม.)</option>"; }).join("");
    openSheet(shHead("เส้นทางเลี่ยงน้ำท่วม", "", "คำนวณหลายเส้นทาง แล้วเลือกเส้นที่ผ่านจุดน้ำท่วมน้อยที่สุด") +
      '<div class="rform">' +
      '<div class="fld"><b>จาก</b><div class="row wr"><button type="button" id="rtA0">' + esc(H.short) + '</button><button type="button" id="rtAme">ตำแหน่งฉัน</button><button type="button" id="rtApick">แตะบนแผนที่</button></div><div class="m" id="rtAw">' + esc(RT.a ? RT.aName : "ยังไม่เลือก") + "</div></div>" +
      '<div class="fld"><b>ถึง</b><div class="row"><input type="search" id="rtQ" placeholder="ค้นหาสถานที่ เช่น สุวรรณภูมิ" value="' + esc(RT.bName) + '"><button type="button" id="rtBpick">แตะบนแผนที่</button></div><div id="rtSug" class="sug"></div><div class="m" id="rtBw">' + esc(RT.b ? RT.bName : "ยังไม่เลือก") + "</div></div>" +
      '<div class="fld"><b>รถ</b><select id="rtV">' + vopts + "</select></div>" +
      '<button type="button" class="primary" id="rtGo">หาเส้นทาง</button><div id="rtOut"></div>' +
      '<p class="note">ถนนที่ไม่มีสีไม่ได้แปลว่าแห้ง แค่ยังไม่มีรายงาน · ตรวจสภาพจริงก่อนเดินทาง · เส้นทาง Longdo / OSRM, ข้อมูลน้ำท่วมของเรา + Floodboard</p></div>');
    if (!RT.a) { RT.a = [H.lat, H.lon]; RT.aName = H.short; $("rtAw").textContent = RT.aName; }
    $("rtA0").onclick = function () { RT.a = [H.lat, H.lon]; RT.aName = H.short; $("rtAw").textContent = RT.aName; };
    $("rtAme").onclick = function () { navigator.geolocation && navigator.geolocation.getCurrentPosition(function (p) { RT.a = [p.coords.latitude, p.coords.longitude]; RT.aName = "ตำแหน่งฉัน"; $("rtAw").textContent = RT.aName; }, function () { $("rtAw").textContent = "ไม่ได้รับสิทธิ์ตำแหน่ง"; }, { enableHighAccuracy: true, timeout: 10000 }); };
    $("rtApick").onclick = function () { pickMode = "A"; closeSheet(); showTab("now", true); setTimeout(function () { $("map").scrollIntoView({ block: "center" }); }, 80); toast("แตะจุดเริ่มต้นบนแผนที่"); };
    $("rtBpick").onclick = function () { pickMode = "B"; closeSheet(); showTab("now", true); setTimeout(function () { $("map").scrollIntoView({ block: "center" }); }, 80); toast("แตะจุดหมายบนแผนที่"); };
    $("rtV").onchange = function () { RT.veh = this.value; };
    var qi = $("rtQ");
    qi.oninput = function () { clearTimeout(qi._t); var q = qi.value.trim(); if (q.length < 2 || !LK) { $("rtSug").innerHTML = ""; return; } qi._t = setTimeout(function () {
      fetch("https://search.longdo.com/mapsearch/json/search?keyword=" + encodeURIComponent(q) + "&lon=" + H.lon + "&lat=" + H.lat + "&span=100km&limit=6&locale=th&key=" + encodeURIComponent(LK))
        .then(function (r) { return r.json(); }).then(function (x) {
          var d = (x && x.data) || []; $("rtSug").innerHTML = d.map(function (p, i) { return '<button type="button" data-i="' + i + '">' + esc(p.name) + ' <small>' + esc(p.address || "") + "</small></button>"; }).join("") || '<div class="m">ไม่พบ ลองแตะบนแผนที่แทน</div>';
          $("rtSug").querySelectorAll("button").forEach(function (b) { b.onclick = function () { var p = d[+b.dataset.i]; RT.b = [+p.lat, +p.lon]; RT.bName = p.name; qi.value = p.name; $("rtBw").textContent = p.name; $("rtSug").innerHTML = ""; }; });
        }).catch(function () { $("rtSug").innerHTML = '<div class="m">ค้นหาไม่ได้ ลองแตะบนแผนที่แทน</div>'; });
    }, 350); };
    $("rtGo").onclick = runRoute;
    if (RT.res) showRouteResult();
  }
  function hazards(v) {  // flooded stretches with a verdict for vehicle v: [{name, vd, depth, pts:[[lat,lon]]}]
    var hz = [];
    (RS ? RS.roads : []).forEach(function (r) { if (!r.lines.length) return; var vd = vVerdict(r.level, r.depth_cm, v); if (vd === "ok") return;
      hz.push({ name: r.name, vd: vd, depth: r.depth_cm, src: "รายงาน", pts: [].concat.apply([], r.lines).map(function (p) { return [p[1], p[0]]; }) }); });
    (S.events || []).forEach(function (e) { var x = EVL[e.id] || {}, vd = vVerdict(evLevel(e), x.depth_cm || e.depth_cm, v); if (vd === "ok") return; hz.push({ name: e.road || e.title, vd: vd, depth: x.depth_cm || e.depth_cm, src: "รายงาน", pts: [[e.lat, e.lon]] }); });
    (FB && FB.features || []).forEach(function (f) { var p = f.properties || {}, vd = fbVerdict(p, v), g = f.geometry || {}; if (vd === "ok") return;
      var parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
      hz.push({ name: p.name || p.nameEn, vd: vd, depth: p.depthCm, src: "Floodboard", pts: [].concat.apply([], parts).map(function (c) { return [c[1], c[0]]; }) }); });
    RP.forEach(function (r) { var vd = vVerdict(r.level, r.depth_cm, v); if (vd !== "ok") hz.push({ name: "รายงานจากทีม", vd: vd, depth: r.depth_cm, src: "ทีม", pts: [[r.lat, r.lon]] }); });
    return hz;
  }
  function scoreRoute(coords, hz) {  // coords [[lat,lon]]; densify to ~25 m and bucket into ~55 m cells
    var cell = {}, K = 0.0005, dens = [];
    for (var i = 0; i < coords.length; i++) { dens.push(coords[i]); if (i + 1 < coords.length) { var d = km(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]), n = Math.floor(d / 0.025);
      for (var j = 1; j < n; j++) dens.push([coords[i][0] + (coords[i + 1][0] - coords[i][0]) * j / n, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * j / n]); } }
    dens.forEach(function (p) { var k = Math.floor(p[0] / K) + ":" + Math.floor(p[1] / K); (cell[k] = cell[k] || []).push(p); });
    var hits = [];
    hz.forEach(function (h) {
      var hit = h.pts.some(function (q) { var a = Math.floor(q[0] / K), b = Math.floor(q[1] / K);
        for (var x = -1; x <= 1; x++) for (var y = -1; y <= 1; y++) { var c = cell[(a + x) + ":" + (b + y)]; if (c && c.some(function (p) { return km(p[0], p[1], q[0], q[1]) < 0.035; })) return true; } return false; });
      if (hit) hits.push(h);
    });
    var seen = {}; hits = hits.filter(function (h) { var k = h.name + h.vd; if (seen[k]) return false; seen[k] = 1; return true; });
    return { hits: hits, blocked: hits.filter(function (h) { return h.vd === "blocked"; }).length, risky: hits.filter(function (h) { return h.vd === "risky"; }).length };
  }
  function lineLen(c) { var s = 0; for (var i = 1; i < c.length; i++) s += km(c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]); return s; }
  function runRoute() {
    if (!RT.a || !RT.b) { $("rtOut").innerHTML = '<p class="m">เลือกจุดเริ่มต้นและจุดหมายก่อน</p>'; return; }
    $("rtOut").innerHTML = '<p class="m">กำลังคำนวณ…</p>';
    var a = RT.a, b = RT.b, v = RT.veh, reqs = [];
    if (LK) reqs.push(fetch("https://api.longdo.com/RouteService/geojson/route?flon=" + a[1] + "&flat=" + a[0] + "&tlon=" + b[1] + "&tlat=" + b[0] + "&mode=t&type=17&restrict=" + (v === "moto" ? 1 : 0) + "&locale=th&key=" + encodeURIComponent(LK))
      .then(function (r) { return r.json(); }).then(function (g) {
        var c = []; (g.features || []).forEach(function (f) { var gg = f.geometry || {}; (gg.type === "LineString" ? [gg.coordinates] : gg.type === "MultiLineString" ? gg.coordinates : []).forEach(function (s) { s.forEach(function (p) { c.push([p[1], p[0]]); }); }); });
        var m = g.meta || g.properties || (g.features && g.features[0] && g.features[0].properties) || {};
        return c.length > 1 ? [{ src: "Longdo", coords: c, km: m.distance ? m.distance / 1000 : lineLen(c), min: m.interval ? m.interval / 60 : m.time ? m.time / 60 : null }] : [];
      }).catch(function () { return []; }));
    reqs.push(fetch("https://router.project-osrm.org/route/v1/driving/" + a[1] + "," + a[0] + ";" + b[1] + "," + b[0] + "?alternatives=3&overview=full&geometries=geojson")
      .then(function (r) { return r.json(); }).then(function (x) { return (x.routes || []).map(function (r, i) { return { src: "OSRM" + (i ? " ทางเลือก " + i : ""), coords: r.geometry.coordinates.map(function (p) { return [p[1], p[0]]; }), km: r.distance / 1000, min: r.duration / 60 }; }); })
      .catch(function () { return []; }));
    Promise.all(reqs).then(function (x) {
      var cands = [].concat.apply([], x), hz = hazards(v);
      if (!cands.length) { $("rtOut").innerHTML = '<p class="m">คำนวณเส้นทางไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง</p>'; return; }
      cands.forEach(function (c) { var s = scoreRoute(c.coords, hz); c.hits = s.hits; c.blocked = s.blocked; c.risky = s.risky; c.cost = s.blocked * 1000 + s.risky * 100 + (c.min || c.km * 2); });
      cands.sort(function (p, q) { return p.cost - q.cost; });
      RT.res = { cands: cands, sel: 0, v: v }; showRouteResult();
    });
  }
  function showRouteResult() {
    var R = RT.res, c = R.cands[R.sel];
    routeLayer.clearLayers();
    R.cands.forEach(function (x, i) { if (i !== R.sel) L.polyline(x.coords, { color: "#8a979c", weight: 4, opacity: .6, dashArray: "2 6", interactive: false }).addTo(routeLayer); });
    L.polyline(c.coords, { color: "#fff", weight: 9, opacity: .9, interactive: false }).addTo(routeLayer);
    L.polyline(c.coords, { color: c.blocked ? VCOL.blocked : c.risky ? VCOL.risky : "#1a73e8", weight: 5, opacity: .95, interactive: false }).addTo(routeLayer);
    c.hits.forEach(function (h) { var p = h.pts[Math.floor(h.pts.length / 2)]; L.circleMarker(p, { radius: 7, color: "#fff", weight: 2, fillColor: VCOL[h.vd], fillOpacity: 1, interactive: false }).addTo(routeLayer); });
    map.fitBounds(L.latLngBounds(c.coords).pad(0.15));
    var head = c.blocked ? ["sev", "ทุกเส้นทางผ่านจุดที่ " + VEH[R.v][0] + " ผ่านไม่ได้ " + c.blocked + " จุด"] : c.risky ? ["warn", "เส้นทางนี้ผ่านจุดเสี่ยง " + c.risky + " จุด"] : ["ok", "ไม่พบรายงานน้ำท่วมบนเส้นทางนี้"];
    $("rtOut").innerHTML = '<div class="pbox pb-' + head[0] + '"><div class="big">' + esc(head[1]) + '</div><div class="m">' + c.km.toFixed(1) + " กม." + (c.min ? " · ~" + Math.round(c.min) + " นาที (ไม่รวมน้ำท่วม)" : "") + " · " + esc(c.src) + "</div>" +
      (c.hits.length ? '<ul class="flist">' + c.hits.slice(0, 8).map(function (h) { return "<li>" + dot(h.vd === "blocked" ? "sev" : "warn") + "<div><b>" + esc(h.name || "ไม่ระบุชื่อถนน") + "</b> · " + VTH[h.vd] + (h.depth ? " · ~" + h.depth + " ซม." : "") + ' <span class="m">(' + esc(h.src) + ")</span></div></li>"; }).join("") + "</ul>" : "") + "</div>" +
      (R.cands.length > 1 ? '<div class="m">เส้นทางอื่น:</div><div class="row wr">' + R.cands.map(function (x, i) { return '<button type="button" class="alt" data-i="' + i + '" aria-pressed="' + (i === R.sel) + '">' + x.km.toFixed(0) + " กม." + (x.blocked ? " · ผ่านไม่ได้ " + x.blocked : "") + (x.risky ? " · เสี่ยง " + x.risky : "") + (!x.blocked && !x.risky ? " · ไม่พบน้ำท่วม" : "") + "</button>"; }).join("") + "</div>" : "") +
      '<div class="row wr"><a class="maplink" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=' + RT.a[0] + "," + RT.a[1] + "&destination=" + RT.b[0] + "," + RT.b[1] + "&waypoints=" + c.coords.filter(function (_, i, arr) { return i > 0 && i < arr.length - 1 && i % Math.max(1, Math.floor(arr.length / 6)) === 0; }).slice(0, 5).map(function (p) { return p[0].toFixed(5) + "," + p[1].toFixed(5); }).join("|") + '">นำทางใน Google Maps</a><button type="button" class="maplink" id="rtClear">ล้างเส้นทาง</button></div>';
    $("rtOut").querySelectorAll(".alt").forEach(function (b) { b.onclick = function () { RT.res.sel = +b.dataset.i; showRouteResult(); }; });
    $("rtClear").onclick = function () { RT.res = null; routeLayer.clearLayers(); $("rtOut").innerHTML = ""; };
  }

  /* ---------- detail sheet (tap a point) + point check (tap anywhere) ---------- */
  var sheetEl = $("sheet"), sheetBg = $("sheetBg"), pinM = null, lastOpen = 0, curShare = null, GD = null, deepDone = false;
  function openSheet(html) {
    lastOpen = Date.now();
    $("sheetBody").innerHTML = html; sheetEl.hidden = false; sheetBg.hidden = false; sheetEl.scrollTop = 0;
    document.body.classList.add("sheet-open");
    $("sheetClose").onclick = closeSheet;
    if ($("sheetShare")) $("sheetShare").onclick = shareCur;
  }
  function closeSheet() {
    sheetEl.hidden = true; sheetBg.hidden = true; document.body.classList.remove("sheet-open");
    if (pinM) { map.removeLayer(pinM); pinM = null; }
    if (/^#[gp]=/.test(location.hash)) { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} }
  }
  sheetBg.onclick = closeSheet;
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !sheetEl.hidden) closeSheet(); });
  function shareCur() {
    if (!curShare) return;
    var url = location.origin + location.pathname + curShare;
    try { history.replaceState(null, "", curShare); } catch (e) {}
    if (navigator.share) { navigator.share({ title: "ATA Flood Watch", url: url }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { $("sheetShare").textContent = "คัดลอกลิงก์แล้ว"; });
  }
  function shHead(title, code, sub) {
    return '<div class="sh-head"><div class="sh-tt"><h3>' + esc(title) + (code ? ' <small>' + esc(code) + "</small>" : "") + '</h3><div class="m">' + sub + "</div></div>" +
      '<div class="sh-btns">' + (curShare ? '<button type="button" id="sheetShare">แชร์</button>' : "") + '<button type="button" id="sheetClose" class="sh-x" aria-label="ปิด">×</button></div></div>';
  }
  function ago(iso) {
    var m = (Date.now() - new Date(iso).getTime()) / 60000;
    return m < 60 ? Math.max(1, Math.round(m)) + " นาทีที่แล้ว" : m < 48 * 60 ? Math.round(m / 60) + " ชม.ที่แล้ว" : Math.round(m / 1440) + " วันที่แล้ว";
  }
  function isSure(c) { return c && c.method && c.method !== "persistence" && c.proven !== false && c.confidence !== "low"; }
  function dirPill(c) {
    if (!c) return '<span class="dp dp-x">–</span>';
    if (!isSure(c)) return '<span class="dp dp-u">? ไม่แน่ชัด</span>';
    return c.dir === "rising" ? '<span class="dp dp-up">↗ เพิ่มขึ้น</span>' : c.dir === "falling" ? '<span class="dp dp-dn">↘ ลดลง</span>' : '<span class="dp dp-st">→ ทรงตัว</span>';
  }
  function rng(c) { var l = c && (c.likely || c.range90); return l && l.length === 2 ? cm(l[0]) + " ถึง " + cm(l[1]) + " ซม." : ""; }
  function olGauge(code) { return OL && OL.gauges ? OL.gauges.filter(function (g) { return g.code === code; })[0] : null; }
  function levelLine(d, og) {
    var fb = og && og.freeboard != null ? og.freeboard : d.to_bank_m != null ? d.to_bank_m : d.bank != null && d.value != null ? d.bank - d.value : null;
    var oc = og && og.over_crit != null ? og.over_crit : d.critical != null && d.value != null ? d.value - d.critical : null;
    if (fb != null && fb < 0) return ["sev", "ล้นตลิ่ง · สูงกว่าตลิ่ง " + Math.round(-fb * 100) + " ซม."];
    if (oc != null && oc > 0) return ["warn", "เกินเกณฑ์วิกฤต กทม. " + Math.round(oc * 100) + " ซม." + (fb != null ? " · ต่ำกว่าตลิ่ง " + Math.round(fb * 100) + " ซม." : "")];
    var k = { overbank: "sev", critical: "warn", warning: "watch", normal: "ok" }[d.st] || "unk";
    return [k, (STTH[d.st] || "ไม่มีเกณฑ์") + (fb != null ? " · ต่ำกว่าตลิ่ง " + Math.round(fb * 100) + " ซม." : "")];
  }
  function showGaugeByCode(code) {
    var d = (S._gauges || []).filter(function (x) { return x.id === code; })[0];
    if (d) { gaugeSheet(d); return; }
    var og = olGauge(code); if (!og) return;
    gaugeSheet({ id: og.code, name: og.name, canal: og.river, lat: og.lat, lon: og.lon, km: og.km, value: og.level, bank: og.bank, time: og.obs_time, st: og.status || "unknown", stale: og.stale, district: "" });
  }
  function gaugeSheet(d) {
    var og = olGauge(d.id), det = GD && GD.gauges ? GD.gauges[d.id] : null, ll = levelLine(d, og);
    curShare = "#g=" + encodeURIComponent(d.id);
    var t = d.time || (og && og.obs_time), h = shHead(d.name, d.id, esc([d.canal || (og && og.river), d.district || d.amphoe, (og && og.agency) || ""].filter(Boolean).join(" · ")) + " · " + (d.km != null ? d.km.toFixed(1) : "?") + " กม. จาก " + esc(H.short));
    var body = '<div class="big lvl-' + ll[0] + '">' + esc(ll[1]) + "</div>" +
      '<div class="m">น้ำ <span class="mono">' + f2(d.value) + "</span> ม.รทก." + (d.bank != null ? ' · ตลิ่ง <span class="mono">' + f2(d.bank) + "</span>" : "") +
      (og && og.crit != null ? ' · เกณฑ์วิกฤต กทม. <span class="mono">' + f2(og.crit) + "</span>" : "") + "</div>" +
      '<div class="m">ข้อมูล ' + dm(t) + " (" + ago(t) + ")" + (d.stale ? ' · <span class="old">ข้อมูลเก่า</span>' : "") + ((d.flags || []).indexOf("via_bkfw") > -1 ? " · ค่าล่าสุดผ่าน BKK FloodWatch (ฟีด ThaiWater ค้าง)" : "") + "</div>";
    if (og) {
      var ch24 = null;
      if (det && det.obs && det.obs.length > 2) { var last = det.obs[det.obs.length - 1], tt = Date.parse(last[0]) - 864e5, prev = det.obs.filter(function (o) { return Date.parse(o[0]) <= tt; }).pop(); if (prev) ch24 = last[1] - prev[1]; }
      var peak = null;
      if (det && det.path && det.issue_time && isSure(og.c24)) { var best = null; det.path.forEach(function (p) { if (p[0] <= 24 && p[3] != null && (!best || p[3] > best[3])) best = p; }); if (best && best[3] - det.path[0][3] > 0.02) peak = new Date(Date.parse(det.issue_time) + best[0] * 3600000 + 7 * 3600000).toISOString(); }
      body += '<div class="trbox"><b>แนวโน้มที่จุดนี้</b>' +
        [["ใน 12 ชม.", og.c12], ["ใน 24 ชม.", og.c24], ["ใน 48 ชม.", og.c48]].map(function (r) { return '<div class="trr"><span>' + r[0] + "</span>" + dirPill(r[1]) + '<span class="mono">' + rng(r[1]) + "</span></div>"; }).join("") +
        (ch24 != null ? '<div class="m">24 ชม. ที่ผ่านมา: ' + (Math.abs(ch24) < 0.02 ? "ทรงตัว" : ch24 > 0 ? '<b class="up">เพิ่มขึ้น ' + Math.round(ch24 * 100) + " ซม.</b>" : '<b class="dn">ลดลง ' + Math.round(-ch24 * 100) + " ซม.</b>") + "</div>" : "") +
        (peak ? '<div class="m">สูงสุดใน 24 ชม. ราว ' + hm(peak) + "</div>" : "") + "</div>";
    } else body += '<p class="note">ยังไม่มีพยากรณ์สำหรับจุดนี้ (อยู่นอกรัศมี 10 กม. จาก ' + esc(H.short) + " หรือแหล่งพยากรณ์ไม่มีจุดนี้)</p>";
    if (det && det.obs && det.obs.length > 1) body += gaugeChart(det, d.bank, og && og.crit);
    else if (og) body += '<p class="note">กราฟรายชั่วโมงมีเฉพาะจุดวัดที่ใกล้ ' + esc(H.short) + " (ภายใน ~6 กม.)</p>";
    body += '<p class="note">ช่วงตัวเลข = ช่วงที่น่าจะเป็นของการเปลี่ยนแปลง · "ไม่แน่ชัด" = แบบจำลองยังทำได้ไม่ดีกว่าการสมมติว่าน้ำคงที่ · ตลิ่งของจุดวัดไม่เท่ากับระดับถนนหรือบ้าน · พยากรณ์จาก BKK FloodWatch 2026, ข้อมูล กทม./สสน.</p>' + lk(d.lat, d.lon);
    openSheet(h + body);
  }
  function gaugeChart(det, bank, crit) {
    var W = 340, Hh = 200, L0 = 38, R0 = 8, T0 = 16, B0 = 26, it = det.issue_time ? Date.parse(det.issue_time) : Date.parse(det.obs[det.obs.length - 1][0]);
    var obs = det.obs.map(function (o) { return [Date.parse(o[0]), o[1]]; }).filter(function (o) { return o[1] != null; });
    var fc = (det.path || []).filter(function (p) { return p[3] != null; }).map(function (p) { return [it + p[0] * 3600000, p[1], p[2], p[3], p[4], p[5]]; });
    var t0 = obs[0][0], t1 = fc.length ? fc[fc.length - 1][0] : obs[obs.length - 1][0];
    var vals = obs.map(function (o) { return o[1]; }); fc.forEach(function (f) { vals.push(f[1], f[5]); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = Math.max(hi - lo, 0.2);
    function near(v) { return v != null && v > lo - span && v < hi + span; }
    if (near(bank)) { lo = Math.min(lo, bank); hi = Math.max(hi, bank); }
    if (near(crit)) { lo = Math.min(lo, crit); hi = Math.max(hi, crit); }
    var pad = (hi - lo) * 0.08 || 0.05; lo -= pad; hi += pad;
    function X(t) { return L0 + (t - t0) / (t1 - t0) * (W - L0 - R0); } function Y(v) { return T0 + (hi - v) / (hi - lo) * (Hh - T0 - B0); }
    var g = "", d0 = new Date(t0 + 7 * 3600000); d0.setUTCHours(0, 0, 0, 0);
    var step = (t1 - t0) / 864e5 > 6 ? 2 : 1; for (var dt = d0.getTime() - 7 * 3600000 + 864e5; dt < t1; dt += 864e5 * step) { var x = X(dt), lab = new Date(dt + 7 * 3600000); g += '<line x1="' + x + '" x2="' + x + '" y1="' + T0 + '" y2="' + (Hh - B0) + '" class="cg"/><text x="' + x + '" y="' + (Hh - 8) + '" class="ct" text-anchor="middle">' + lab.getUTCDate() + " " + TM[lab.getUTCMonth() + 1] + "</text>"; }
    function pl(pts) { return pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); }).join(""); }
    var band = function (a, b) { return fc.length ? '<path d="' + pl(fc.map(function (f) { return [f[0], f[a]]; })) + fc.slice().reverse().map(function (f) { return "L" + X(f[0]).toFixed(1) + " " + Y(f[b]).toFixed(1); }).join("") + 'Z" class="cb' + a + '"/>' : ""; };
    var ref = function (v, cls, txt) { return near(v) || (v >= lo && v <= hi) ? '<line x1="' + L0 + '" x2="' + (W - R0) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" class="' + cls + '"/><text x="' + (W - R0) + '" y="' + (Y(v) - 4) + '" text-anchor="end" class="ct ' + cls + 't">' + txt + " " + f2(v) + "</text>" : ""; };
    var nx = X(it);
    return '<svg class="gchart" viewBox="0 0 ' + W + " " + Hh + '" role="img" aria-label="ระดับน้ำย้อนหลังและพยากรณ์">' + g +
      band(1, 5) + band(2, 4) +
      '<path d="' + pl(obs) + '" class="co"/>' + (fc.length ? '<path d="' + pl([[it, obs[obs.length - 1][1]]].concat(fc.map(function (f) { return [f[0], f[3]]; }))) + '" class="cm"/>' : "") +
      ref(bank, "cbank", "ตลิ่ง") + ref(crit, "ccrit", "วิกฤต กทม.") +
      '<line x1="' + nx + '" x2="' + nx + '" y1="' + (T0 - 4) + '" y2="' + (Hh - B0) + '" class="cnow"/><text x="' + nx + '" y="' + (T0 - 6) + '" text-anchor="middle" class="ct">ตอนนี้</text>' +
      '<text x="' + (L0 - 4) + '" y="' + (T0 + 8) + '" text-anchor="end" class="ct">' + hi.toFixed(2) + '</text><text x="' + (L0 - 4) + '" y="' + (Hh - B0) + '" text-anchor="end" class="ct">' + lo.toFixed(2) + "</text></svg>" +
      '<div class="leg"><span><i class="lo"></i>วัดได้</span><span><i class="lm"></i>พยากรณ์</span><span><i class="lb"></i>ช่วงที่น่าจะเป็น</span><span>ม.รทก.</span></div>';
  }
  function inPoly(lat, lon, geom) {
    var polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    return polys.some(function (poly) { var ring = poly[0], c = false; for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) { var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) c = !c; } return c; });
  }
  function dot(k) { return '<span class="fdot fd-' + k + '"></span>'; }
  function pointCheck(ll) {
    if (pickMode) return;
    if (Date.now() - lastOpen < 350) return;
    var lat = ll.lat, lon = ll.lng;
    if (pinM) map.removeLayer(pinM);
    pinM = L.marker([lat, lon], { interactive: false, icon: L.divIcon({ className: "", html: '<div class="fw-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 18] }), zIndexOffset: 900 }).addTo(map);
    var df = (DISTS && DISTS.features || []).filter(function (f) { return inPoly(lat, lon, f.geometry); })[0], dist = df ? DM[df.properties.id] : null;
    var gs = (S._gauges || []).filter(function (g) { return g.value != null && !g.stale; }).map(function (g) { return { g: g, k: km(lat, lon, g.lat, g.lon) }; })
      .filter(function (x) { return x.k <= 3; }).sort(function (a, b) { return a.k - b.k; }).slice(0, 3);
    var evs = (S.events || []).filter(function (e) { return km(lat, lon, e.lat, e.lon) <= 1; });
    var roads = RS ? RS.roads.filter(function (r) { return r.lat != null && km(lat, lon, r.lat, r.lon) <= 1; }) : [];
    var worstRoad = Math.max.apply(null, [0].concat(roads.map(function (r) { return r.level; }), evs.map(evLevel)));
    var tfs = (TR.reports || []).filter(function (t) { return km(lat, lon, t.lat, t.lon) <= 1; });
    var canalWorst = 0, canalHtml = "";
    if (gs.length) {
      var n = gs[0], og = olGauge(n.g.id), llv = levelLine(n.g, og); canalWorst = { sev: 3, warn: 2, watch: 1 }[llv[0]] || 0;
      canalHtml = '<li>' + dot(["ok", "watch", "warn", "sev"][canalWorst]) + '<div><b>ระดับน้ำในคลอง</b> · ' + esc(llv[1].split(" · ")[0]) +
        '<div class="m">คลองใกล้สุด <button type="button" class="linkbtn" data-g="' + esc(n.g.id) + '">' + esc(n.g.name) + "</button> " + n.k.toFixed(1) + " กม." + (gs.length > 1 ? " · และอีก " + (gs.length - 1) + " จุดในรัศมี 3 กม." : "") + "</div>" +
        (og ? '<div class="trr sm"><span>ใน 24 ชม.</span>' + dirPill(og.c24) + '<span class="mono">' + rng(og.c24) + '</span></div><div class="trr sm"><span>ใน 48 ชม.</span>' + dirPill(og.c48) + '<span class="mono">' + rng(og.c48) + "</span></div>" : "") + "</div></li>";
    } else canalHtml = "<li>" + dot("unk") + '<div><b>ระดับน้ำในคลอง</b> · ไม่มีจุดวัดในรัศมี 3 กม.</div></li>';
    var score = Math.max(worstRoad >= 3 ? 3 : worstRoad >= 2 ? 2 : 0, canalWorst, tfs.length >= 3 ? 2 : tfs.length ? 1 : 0, dist ? ({ severe: 3, warning: 2, watch: 1 }[dist.level] || 0) : 0);
    var head = score >= 3 ? ["sev", "เสี่ยงสูง: พื้นที่นี้มีสัญญาณน้ำท่วมชัดเจน"] : score === 2 ? ["warn", "ระวัง: มีสัญญาณน้ำท่วมใกล้จุดนี้"] : score === 1 ? ["watch", "เฝ้าระวัง: มีรายงานบางส่วนใกล้จุดนี้"] : ["ok", "ยังไม่พบสัญญาณน้ำท่วมใกล้จุดนี้"];
    var sh = HL && HL.facilities && dist ? HL.facilities.filter(function (f) { return f.category === "ศูนย์พักพิงชั่วคราว" && f.district === dist.name; }) : [];
    var shOpen = sh.filter(function (f) { var t = fSt(f)[1]; return t !== "เต็ม" && t !== "ปิด"; });
    curShare = "#p=" + lat.toFixed(5) + "," + lon.toFixed(5);
    var html = shHead("จุดที่เลือก " + lat.toFixed(4) + ", " + lon.toFixed(4), "", dist ? "เขต/อำเภอ" + esc(dist.name) + " · " + esc(dist.province) + " · " + km(H.lat, H.lon, lat, lon).toFixed(1) + " กม. จาก " + esc(H.short) : km(H.lat, H.lon, lat, lon).toFixed(1) + " กม. จาก " + esc(H.short)) +
      '<div class="pbox pb-' + head[0] + '"><div class="m">ประเมินจากข้อมูลรอบจุด</div><div class="big">' + esc(head[1]) + "</div>" +
      '<div class="m">ปัจจัยที่ใช้ประเมิน</div><ul class="flist">' + canalHtml +
      '<li id="pcRain">' + dot("unk") + "<div><b>ฝน</b> · กำลังโหลด…</div></li>" +
      "<li>" + dot(worstRoad >= 3 ? "sev" : worstRoad === 2 ? "warn" : worstRoad === 1 ? "watch" : "ok") + "<div><b>น้ำท่วมบนถนน</b> · " + (evs.length || roads.length ? RLV[worstRoad] ? rpill(worstRoad) + " " + evs.length + " รายงานในรัศมี 1 กม." : evs.length + " รายงาน" : "ยังไม่มีรายงานในรัศมี 1 กม.") + "</div></li>" +
      "<li>" + dot(tfs.length >= 3 ? "warn" : tfs.length ? "watch" : "ok") + "<div><b>ประชาชนแจ้ง (Traffy)</b> · " + (tfs.length ? tfs.length + " เรื่องในรัศมี 1 กม. (24 ชม.)" : "ไม่มีในรัศมี 1 กม.") + "</div></li>" +
      (dist ? "<li>" + dot({ severe: "sev", warning: "warn", watch: "watch" }[dist.level] || "ok") + "<div><b>ระดับเขต</b> · " + esc(dist.level_th) + '<div class="m">' + esc(dist.advice || "") + "</div></div></li>" : "") +
      (sh.length ? "<li>" + dot(shOpen.length ? "ok" : "sev") + "<div><b>ศูนย์พักพิงในเขตนี้</b> · ยังรับได้ " + shOpen.length + " จาก " + sh.length + ' แห่ง <button type="button" class="linkbtn" id="pcHelp">ดูรายการ ›</button></div></li>' : "") +
      "</ul></div>" +
      '<p class="note">ไม่มีการวัดระดับน้ำที่จุดนี้โดยตรง ผลนี้รวมจากจุดวัดและรายงานรอบ ๆ</p><button type="button" class="primary" id="pcReport">แจ้งน้ำท่วมที่จุดนี้</button>' + lk(lat, lon);
    openSheet(html);
    $("sheetBody").querySelectorAll("[data-g]").forEach(function (b) { b.onclick = function () { showGaugeByCode(b.dataset.g); }; });
    if ($("pcHelp")) $("pcHelp").onclick = function () { closeSheet(); showTab("help", true); };
    $("pcReport").onclick = function () { repPt = [lat, lon]; openReport(); };
    if (LK) {
      var q = "lat=" + lat.toFixed(5) + "&lon=" + lon.toFixed(5) + "&key=" + encodeURIComponent(LK);
      Promise.all([fetch(LW + "location?" + q).then(function (r) { return r.json(); }), fetch(LW + "forecast/location?" + q).then(function (r) { return r.json(); })]).then(function (x) {
        var el = $("pcRain"); if (!el) return;
        var now = rainLv(x[0]), f = (x[1] && x[1].forecast) || [], f30 = f[1] && f[1].available ? rainLv(f[1]) : null, w = Math.max(now || 0, f30 || 0);
        el.innerHTML = dot(w >= 4 ? "sev" : w >= 2 ? "warn" : w ? "watch" : "ok") + "<div><b>ฝน</b> · ตอนนี้ " + rainPill(now) + " · อีก 30 นาที " + rainPill(f30) + '<div class="m">เรดาร์ Longdo Weather</div></div>';
      }).catch(function () { var el = $("pcRain"); if (el) el.innerHTML = dot("unk") + "<div><b>ฝน</b> · โหลดไม่สำเร็จ</div>"; });
    } else { var el = $("pcRain"); if (el) el.remove(); }
  }
  map.on("click", function (e) {
    if (pickMode) {
      var m = pickMode, p = [e.latlng.lat, e.latlng.lng], nm = p[0].toFixed(4) + ", " + p[1].toFixed(4); pickMode = null; lastOpen = Date.now();
      if (m === "report") { repPt = p; openReport(); return; }
      if (m === "A") { RT.a = p; RT.aName = "จุดบนแผนที่ " + nm; } else { RT.b = p; RT.bName = "จุดบนแผนที่ " + nm; }
      openRoute(); return;
    }
    pointCheck(e.latlng);
  });
  $("btnRoute").onclick = openRoute;
  $("btnReport").onclick = function () { if (pinM) { var ll = pinM.getLatLng(); repPt = [ll.lat, ll.lng]; } openReport(); };
  function openFromHash() {
    var h = location.hash, m;
    if ((m = h.match(/^#g=(.+)$/))) { showTab("now"); showGaugeByCode(decodeURIComponent(m[1])); }
    else if ((m = h.match(/^#p=(-?[\d.]+),(-?[\d.]+)$/))) { showTab("now"); map.setView([+m[1], +m[2]], 14); lastOpen = 0; pointCheck({ lat: +m[1], lng: +m[2] }); }
  }


  /* ---------- พยากรณ์: all gauges, searchable list (tap → detail sheet) ---------- */
  var GL = { st: "", q: "", prov: "กรุงเทพมหานคร", near: "ata", more: false, me: null };
  var GST = [["overbank", "ล้นตลิ่ง", "sev"], ["critical", "เกินวิกฤต", "warn"], ["warning", "เฝ้าระวัง", "watch"], ["normal", "ปกติ", "ok"], ["unknown", "ไม่ทราบ", "unk"]];
  function gHeadline(g) {
    var fb = g.to_bank_m != null ? g.to_bank_m : g.bank != null && g.value != null ? g.bank - g.value : null, oc = g.critical != null && g.value != null ? g.value - g.critical : null;
    if (fb != null && fb < 0) return "สูงกว่าตลิ่ง " + Math.round(-fb * 100) + " ซม.";
    if (oc != null && oc > 0) return "เกินเกณฑ์ กทม. " + Math.round(oc * 100) + " ซม.";
    if (fb != null) return "ต่ำกว่าตลิ่ง " + Math.round(fb * 100) + " ซม.";
    return "";
  }
  function renderGList() {
    var el = $("glist"); if (!el || !S) return;
    var all = (S._gauges || []).filter(function (g) { return g.value != null; }), now = Date.now();
    var inProv = all.filter(function (g) { return !GL.prov || g.province === GL.prov || (GL.prov === "ปริมณฑล" && g.province !== "กรุงเทพมหานคร"); });
    var cnt = {}; GST.forEach(function (x) { cnt[x[0]] = 0; }); inProv.forEach(function (g) { cnt[g.st] = (cnt[g.st] || 0) + 1; });
    var fresh = [1, 3, 24].map(function (h) { return all.filter(function (g) { return g.time && now - Date.parse(g.time) <= h * 3600000; }).length; });
    var up = 0, dn = 0; (OL && OL.gauges || []).forEach(function (g) { if (isSure(g.c24)) { if (g.c24.dir === "rising") up++; if (g.c24.dir === "falling") dn++; } });
    var q = GL.q.trim().toLowerCase();
    var list = inProv.filter(function (g) { return (!GL.st || g.st === GL.st) && (!q || [g.name, g.id, g.canal, g.district, g.amphoe].join(" ").toLowerCase().indexOf(q) > -1); });
    var ref = GL.near === "me" && GL.me ? GL.me : [H.lat, H.lon];
    list.forEach(function (g) { g._d = km(ref[0], ref[1], g.lat, g.lon); });
    list.sort(GL.near === "sev" ? function (a, b) { return ST[b.st] - ST[a.st] || a._d - b._d; } : function (a, b) { return a._d - b._d; });
    var show = GL.more ? list.slice(0, 200) : list.slice(0, 20);
    el.innerHTML =
      '<div class="gchips">' + GST.map(function (x) { return '<button type="button" data-st="' + x[0] + '" aria-pressed="' + (GL.st === x[0]) + '"><span class="fdot fd-' + x[2] + '"></span>' + x[1] + " <b>" + cnt[x[0]] + "</b></button>"; }).join("") + "</div>" +
      '<p class="note">' + (OL ? "แนวโน้ม 24 ชม. รอบ " + esc(H.short) + " 10 กม.: ขึ้น <b>" + up + "</b> · ลง <b>" + dn + "</b> จุด (นับเฉพาะที่แบบจำลองมั่นใจ) · " : "") +
        "ส่งข้อมูลภายใน 1 ชม. <b>" + fresh[0] + "</b> · 3 ชม. <b>" + fresh[1] + "</b> · 24 ชม. <b>" + fresh[2] + "</b> จาก " + all.length + " จุด</p>" +
      '<div class="gctl"><div class="sortrow"><button type="button" data-n="ata" aria-pressed="' + (GL.near === "ata") + '">ใกล้ ' + esc(H.short) + '</button><button type="button" data-n="me" aria-pressed="' + (GL.near === "me") + '">ใกล้ฉัน</button><button type="button" data-n="sev" aria-pressed="' + (GL.near === "sev") + '">รุนแรงสุด</button></div>' +
        '<input type="search" id="gq" placeholder="ค้นหา เขต / คลอง / จุดวัด" value="' + esc(GL.q) + '" aria-label="ค้นหาจุดวัด"></div>' +
      '<div class="tabs gprov">' + ["กรุงเทพมหานคร", "ปริมณฑล", ""].map(function (p) { return '<button type="button" data-p="' + p + '" aria-pressed="' + (GL.prov === p) + '">' + (p === "กรุงเทพมหานคร" ? "กทม." : p || "ทั้งหมด") + "</button>"; }).join("") + "</div>" +
      (show.length ? show.map(function (g, i) {
        var og = olGauge(g.id), k = { overbank: "sev", critical: "warn", warning: "watch", normal: "ok" }[g.st] || "unk", age = g.time ? ago(g.time) : "";
        return '<button type="button" class="gcard gc-' + k + '" data-i="' + i + '"><div class="top"><span class="nm">' + esc(g.name) + ' <small>' + esc(g.id) + '</small></span><span class="pill lv-' + ({ sev: "severe", warn: "warning", watch: "watch", ok: "normal" }[k] || "unk") + '">' + esc(STTH[g.st] || "ไม่ทราบ") + "</span></div>" +
          '<div class="mid"><span class="m">' + esc([g.canal, g.district || g.amphoe].filter(Boolean).join(" · ")) + " · " + g._d.toFixed(1) + ' กม.</span><b class="lvl-' + k + '">' + esc(gHeadline(g)) + "</b></div>" +
          (og ? '<div class="trr sm"><span>ใน 24 ชม.</span>' + dirPill(og.c24) + '<span class="mono">' + rng(og.c24) + "</span></div>" : "") +
          '<div class="m">ข้อมูลล่าสุด ' + age + (g.stale ? ' · <span class="old">ข้อมูลเก่า</span>' : "") + "</div></button>";
      }).join("") : '<p class="note">ไม่พบจุดวัดตามเงื่อนไขนี้</p>') +
      (list.length > show.length ? '<button type="button" class="maplink" id="gMore">ดูอีก ' + (Math.min(list.length, 200) - show.length) + " จุด</button>" : "");
    el.querySelectorAll(".gchips button").forEach(function (b) { b.onclick = function () { GL.st = GL.st === b.dataset.st ? "" : b.dataset.st; GL.more = false; renderGList(); }; });
    el.querySelectorAll(".gprov button").forEach(function (b) { b.onclick = function () { GL.prov = b.dataset.p; GL.more = false; renderGList(); }; });
    el.querySelectorAll(".gctl .sortrow button").forEach(function (b) { b.onclick = function () {
      if (b.dataset.n === "me" && !GL.me) { if (!navigator.geolocation) return; navigator.geolocation.getCurrentPosition(function (p) { GL.me = [p.coords.latitude, p.coords.longitude]; GL.near = "me"; GL.prov = ""; renderGList(); }, function () { b.textContent = "ไม่ได้รับสิทธิ์ตำแหน่ง"; }, { enableHighAccuracy: true, timeout: 10000 }); return; }
      GL.near = b.dataset.n; renderGList(); }; });
    var qi = $("gq"); qi.oninput = function () { GL.q = qi.value; GL.more = false; clearTimeout(qi._t); qi._t = setTimeout(function () { renderGList(); var n = $("gq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    el.querySelectorAll(".gcard").forEach(function (b) { b.onclick = function () { gaugeSheet(show[+b.dataset.i]); }; });
    if ($("gMore")) $("gMore").onclick = function () { GL.more = true; renderGList(); };
  }


  /* ---------- น้ำในคลอง: every waterway on a real-scale map, painted by the nearest gauge ---------- */
  var CM = null, CNET = null, cMode = "bma", CG = {}, CLY = {}, cOn = { gauge: true, flood: true, other: false, gistda: true, traffy: false }, OTHERS = null, GIS = null;
  var CCOL = { red: "#d62828", orange: "#f77f00", green: "#2a9d4b", pink: "#e76fae", yellow: "#e9c46a", blue: "#4cc9f0", over: "#9d0208", grey: "#9aa5a9" };
  var CLEG = {
    bma: [["red", "วิกฤต (ถึงเกณฑ์วิกฤต กทม.)"], ["orange", "เฝ้าระวัง (ถึงเกณฑ์เฝ้าระวัง)"], ["green", "ปกติ"], ["pink", "น้ำต่ำ (ต่ำกว่าเกณฑ์เฝ้าระวังเกิน 1 ม.)"], ["grey", "ไม่มีข้อมูล / ข้อมูลเก่า"]],
    bank: [["over", "ล้นตลิ่ง"], ["red", "เหลือไม่เกิน 20 ซม. ถึงตลิ่ง"], ["orange", "20–50 ซม."], ["yellow", "50 ซม.–1 ม."], ["blue", "มากกว่า 1 ม."], ["grey", "ไม่มีข้อมูลตลิ่ง / ข้อมูลเก่า"]]
  };
  function cGauges() { return [].concat(S.stations.canal || [], S.stations.river || []).filter(function (g) { return g.lat != null; }); }
  function cClass(g) {
    var old = !g.time || Date.now() - Date.parse(g.time) > 3 * 3600000, v = g.value;
    if (old || v == null) return "grey";
    if (cMode === "bma") {
      if (g.critical == null && g.warning == null) return "grey";
      if (g.critical != null && v >= g.critical) return "red";
      if (g.warning != null && v >= g.warning) return "orange";
      if (g.warning != null && v < g.warning - 1) return "pink";
      return "green";
    }
    var fb = g.bank != null ? g.bank - v : g.to_bank_m;
    if (fb == null) return "grey";
    return fb < 0 ? "over" : fb <= 0.2 ? "red" : fb <= 0.5 ? "orange" : fb <= 1 ? "yellow" : "blue";
  }
  function initCanal() {
    if (!S) return;
    if (!CM) {
      CM = L.map("cmap", { preferCanvas: true, renderer: L.canvas({ tolerance: 8 }) }).setView([H.lat, H.lon], 12);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd", attribution: "© OpenStreetMap contributors © CARTO" }).addTo(CM);
      ["net", "lit", "gauge", "flood", "other", "gistda", "traffy"].forEach(function (k) { CLY[k] = L.layerGroup().addTo(CM); });
      L.marker([H.lat, H.lon], { interactive: false, icon: L.divIcon({ className: "", html: '<div class="fw-ata" style="width:14px;height:14px"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }) }).addTo(CM);
      document.querySelectorAll("#cmode button").forEach(function (b) { b.onclick = function () { cMode = b.dataset.m; document.querySelectorAll("#cmode button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); drawCanal(); }; });
      document.querySelectorAll("#clayers button").forEach(function (b) { b.onclick = function () { var k = b.dataset.k; cOn[k] = !cOn[k]; b.setAttribute("aria-pressed", cOn[k]); drawExtras(); }; });
      $("cnote").textContent = "กำลังโหลดเส้นทางน้ำ…";
      j(BASE + "canal_net.json").then(function (n) { CNET = n; drawCanal(); }).catch(function () { $("cnote").textContent = "ยังไม่มีข้อมูลเส้นทางน้ำ (รอรอบสร้างชั้นแผนที่)"; });
      j(BASE + "gistda_flood.geojson").then(function (g) { GIS = g; drawExtras(); }).catch(function () { GIS = null; drawExtras(); });
    } else { CM.invalidateSize(); drawCanal(); }
  }
  function drawCanal() {
    if (!CM || !CNET || !S) return;
    CG = {}; cGauges().forEach(function (g) { CG[g.id] = g; });
    CLY.net.clearLayers(); CLY.lit.clearLayers(); CLY.gauge.clearLayers();
    var base = [], groups = {};
    CNET.pieces.forEach(function (p) {
      var ll = p[3].map(function (c) { return [c[1], c[0]]; });
      base.push(ll);
      if (p[1] < 0) return;
      var gid = CNET.gauges[p[1]], g = CG[gid]; if (!g) return;
      var k = gid + "|" + Math.min(8, Math.floor(p[2] / 500));
      (groups[k] = groups[k] || { g: g, d: p[2], name: CNET.names[p[0]], lines: [] }).lines.push(ll);
    });
    L.polyline(base, { color: "#8ecae6", weight: 1.6, opacity: .75, interactive: false }).addTo(CLY.net);
    Object.keys(groups).forEach(function (k) {
      var x = groups[k], cls = cClass(x.g), op = x.d <= 250 ? .95 : Math.max(.15, .95 - (x.d - 250) / 3750 * .8);
      L.polyline(x.lines, { color: CCOL[cls], weight: 4.5, opacity: op }).on("click", function (e) { L.DomEvent.stop(e); canalSheet(x, cls); }).addTo(CLY.lit);
    });
    var cnt = {};
    cGauges().forEach(function (g) {
      var cls = cClass(g); cnt[cls] = (cnt[cls] || 0) + 1;
      if (cOn.gauge) L.circleMarker([g.lat, g.lon], { radius: 5.5, color: "#fff", weight: 1.5, fillColor: CCOL[cls], fillOpacity: 1 })
        .on("click", function (e) { L.DomEvent.stop(e); g.km = km(H.lat, H.lon, g.lat, g.lon); g.st = g.status || "unknown"; gaugeSheet(g); }).addTo(CLY.gauge);
    });
    $("clegend").innerHTML = CLEG[cMode].map(function (x) { return '<span><i style="background:' + CCOL[x[0]] + '"></i>' + x[1] + (cnt[x[0]] ? " <b>" + cnt[x[0]] + "</b>" : "") + "</span>"; }).join("");
    $("cnote").innerHTML = "เส้นฟ้าจาง = ทางน้ำทั้งหมด · สีเข้ม = ช่วงคลองใกล้จุดวัด ยิ่งไกลจุดวัดยิ่งจาง (ระดับน้ำอาจต่างไป) · " +
      (cMode === "bma" ? "เกณฑ์ของ กทม. จากข้อมูลจุดวัด ส่วน 'น้ำต่ำ' เป็นการประมาณของเรา" : "ระยะถึงตลิ่ง = ตลิ่งของจุดวัด ลบ ระดับน้ำ") + " · ทางน้ำ © OpenStreetMap";
    drawExtras();
  }
  function drawExtras() {
    if (!CM) return;
    ["flood", "other", "gistda", "traffy"].forEach(function (k) { CLY[k].clearLayers(); });
    if (cOn.flood && S) (S.events || []).forEach(function (e) {
      var lv = evLevel(e); L.circleMarker([e.lat, e.lon], { radius: 5, color: "#fff", weight: 1, fillColor: RCOL[lv], fillOpacity: .95 }).on("click", function (ev) { L.DomEvent.stop(ev); e.km = km(H.lat, H.lon, e.lat, e.lon); showEvent(e); }).addTo(CLY.flood);
    });
    if (cOn.traffy) (TR.reports || []).forEach(function (t) { L.circleMarker([t.lat, t.lon], { radius: 3.5, weight: 0, fillColor: COL.traffy, fillOpacity: .6 }).on("click", function (ev) { L.DomEvent.stop(ev); t.km = km(H.lat, H.lon, t.lat, t.lon); showTf(t); }).addTo(CLY.traffy); });
    if (cOn.gistda && GIS && GIS.features) L.geoJSON(GIS, { style: { color: "#5a4fcf", weight: 1, fillColor: "#5a4fcf", fillOpacity: .3 }, interactive: false }).addTo(CLY.gistda);
    var gb = document.querySelector('#clayers [data-k="gistda"]'); if (gb) gb.title = GIS ? "พื้นที่น้ำท่วมจากดาวเทียม GISTDA " + ((GIS.features || []).length) + " แปลง" : "ยังไม่เปิด (ต้องมี key ของ GISTDA)";
    if (cOn.other) {
      if (!OTHERS) { OTHERS = []; fetch("https://event.longdo.com/feed/json").then(function (r) { return r.json(); }).then(function (x) {
        var now = Date.now(); OTHERS = x.filter(function (e) { return e.icon !== "flood" && +e.latitude > 13.4 && +e.latitude < 14.2 && +e.longitude > 100.2 && +e.longitude < 101 && (!e.stop || Date.parse(e.stop.replace(" ", "T") + "+07:00") > now - 3600000); });
        drawExtras(); }).catch(function () {}); }
      OTHERS.forEach(function (e) { L.marker([+e.latitude, +e.longitude], { icon: L.divIcon({ className: "", html: '<div class="fw-oth">!</div>', iconSize: [16, 16], iconAnchor: [8, 8] }) })
        .on("click", function (ev) { L.DomEvent.stop(ev); card('<span class="t">' + esc(e.title || e.icon) + '</span><span class="m">' + esc(({ accident: "อุบัติเหตุ", carbreakdown: "รถเสีย", roadclosed: "ปิดถนน", construction: "ก่อสร้าง", diversion: "เบี่ยงการจราจร", trafficjam: "รถติด" })[e.icon] || e.icon) + " · " + esc(e.start || "") + '</span><span>' + esc((e.description || "").slice(0, 300)) + '</span><span class="m">Longdo Traffic / iTIC</span>'); }).addTo(CLY.other); });
    }
  }
  function canalSheet(x, cls) {
    var g = x.g, fb = g.bank != null && g.value != null ? g.bank - g.value : g.to_bank_m;
    curShare = null;
    openSheet(shHead(x.name || "ทางน้ำ (ไม่มีชื่อใน OSM)", "", "สีอิงจุดวัด " + esc(g.name) + " · ห่างราว " + (x.d < 50 ? "< 50" : x.d.toLocaleString()) + " ม.") +
      '<div class="big" style="color:' + CCOL[cls] + '">' + esc((CLEG[cMode].filter(function (l) { return l[0] === cls; })[0] || ["", ""])[1]) + "</div>" +
      '<div class="m">น้ำ <span class="mono">' + f2(g.value) + "</span> ม.รทก. · เฝ้าระวัง " + f2(g.warning) + " · วิกฤต " + f2(g.critical) + " · ตลิ่ง " + f2(g.bank) + (fb != null ? " · ห่างตลิ่ง " + Math.round(fb * 100) + " ซม." : "") + "</div>" +
      '<div class="m">วัดเมื่อ ' + dm(g.time) + " (" + ago(g.time) + ")</div>" +
      (x.d > 1000 ? '<p class="note">ช่วงนี้อยู่ห่างจุดวัดเกิน 1 กม. ระดับน้ำจริงอาจต่างจากค่าที่จุดวัด</p>' : "") +
      '<button type="button" class="primary" id="cgOpen">ดูรายละเอียดจุดวัด</button>');
    $("cgOpen").onclick = function () { g.km = km(H.lat, H.lon, g.lat, g.lon); g.st = g.status || "unknown"; gaugeSheet(g); };
  }

  /* ---------- tabs: สถานการณ์ / พยากรณ์ / ช่วยเหลือ ---------- */
  var TAB = "now", HL = null;
  function showTab(t, user) {
    if (["now", "fc", "help", "canal"].indexOf(t) < 0) t = "now";
    TAB = t; document.body.setAttribute("data-tab", t);
    document.querySelectorAll(".tabbar button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.tab === t); });
    if (user) { try { history.replaceState(null, "", t === "now" ? location.pathname + location.search : "#" + t); } catch (e) {} window.scrollTo(0, 0); }
    if (t === "now") setTimeout(function () { map.invalidateSize(); }, 60);
    if (t === "fc" && S) { loadRainArea(); renderGList(); }
    if (t === "help" && S) renderHelp();
    if (t === "canal") setTimeout(initCanal, 30);
  }
  document.querySelectorAll(".tabbar button").forEach(function (b) { b.onclick = function () { showTab(b.dataset.tab, true); }; });
  window.addEventListener("hashchange", function () { if (/^#[gp]=/.test(location.hash)) openFromHash(); else showTab(location.hash.slice(1)); });
  function go(t) { return function () { showTab(t, true); }; }

  /* short links from the main page to the other two pages */
  function renderTeasers() {
    var el = $("teasers"), out = [];
    if (OL && OL.gauges) {
      var gs = OL.gauges.filter(function (g) { return !g.stale && g.level != null && g.km <= C.summary_km; }).slice(0, 6);
      if (gs.length) {
        var over = gs.filter(function (g) { return g.over_crit > 0 || g.freeboard < 0; }).length, lo = 0, hi = 0, up = 0, dn = 0;
        gs.forEach(function (g) { var c = g.c24; if (!c) return; var l = c.likely || c.range90 || [0, 0]; lo = Math.min(lo, l[0]); hi = Math.max(hi, l[1]);
          var sure = c.method && c.method !== "persistence" && c.proven !== false && c.confidence !== "low"; if (sure && c.dir === "rising") up++; if (sure && c.dir === "falling") dn++; });
        out.push(['fc', "คลองใกล้ ATA", "เกินวิกฤต " + over + "/" + gs.length + " จุด · 24 ชม. ข้างหน้า " + cm(lo) + " ถึง " + cm(hi) + " ซม. " + (up ? "(มีจุดแนวโน้มขึ้น)" : dn ? "(มีจุดแนวโน้มลง)" : "(ไม่แน่ชัด)")]);
      }
    }
    if (HL && HL.facilities) {
      var sh = HL.facilities.filter(function (f) { return f.category === "ศูนย์พักพิงชั่วคราว" && f.district === H.district; });
      if (sh.length) { var open = sh.filter(function (f) { var t = fSt(f)[1]; return t !== "เต็ม" && t !== "ปิด"; }).length;
        out.push(['help', "ศูนย์พักพิงเขต" + H.district, "ยังรับได้ " + open + " จาก " + sh.length + " แห่ง · ดูจุดใกล้เคียง จุดจอดรถ จุดรับบริจาค"]); }
    }
    el.innerHTML = out.map(function (o, i) { return '<button type="button" class="teaser" data-i="' + i + '"><span><b>' + esc(o[1]) + "</b> " + esc(o[2]) + '</span><span class="go">›</span></button>'; }).join("");
    el.querySelectorAll(".teaser").forEach(function (b) { b.onclick = go(out[+b.dataset.i][0]); });
  }

  /* ---------- พยากรณ์: rain by district now + next 30 min (Longdo Weather) ---------- */
  var rainAreaAt = 0;
  function rainBadge(st) { if (!st) return rainPill(null); var lv = st.max_intensity || 0; return rainPill(lv) + (lv ? ' <span class="m">' + Math.round(st.rain_coverage_pct) + "% ของพื้นที่</span>" : ""); }
  function loadRainArea(force) {
    var el = $("rainArea");
    if (!LK) { el.innerHTML = '<p class="note">ต้องใส่ longdo_key ใน config.js เพื่อดูฝนรายเขต</p>'; return; }
    if (!force && Date.now() - rainAreaAt < 4 * 60000) return;
    rainAreaAt = Date.now();
    var k = "&key=" + encodeURIComponent(LK);
    var ds = S.districts.filter(function (d) { return d.km <= 12; }).sort(function (a, b) { return a.km - b.km; }).slice(0, 8);
    function j2(u) { return fetch(LW + u + k).then(function (r) { if (!r.ok) throw r.status; return r.json(); }).catch(function () { return null; }); }
    Promise.all([j2("forecast/area?lat=" + H.lat + "&lon=" + H.lon + "&radius_km=15"), j2("area?lat=" + H.lat + "&lon=" + H.lon + "&radius_km=15")]
      .concat(ds.map(function (d) { return j2("area?lat=" + d.lat + "&lon=" + d.lon + "&radius_km=3"); }))).then(function (x) {
      var fc = (x[0] && x[0].forecast) || [], now15 = x[1] && x[1].stats;
      el.innerHTML = '<div class="olhead"><span class="t">รัศมี 15 กม. รอบ ' + esc(H.short) + '</span><div class="olh">' +
          "<div><b>ตอนนี้</b>" + rainBadge(now15) + "</div>" +
          "<div><b>+15 นาที</b>" + rainBadge(fc[0] && fc[0].available ? fc[0].stats : null) + "</div>" +
          "<div><b>+30 นาที</b>" + rainBadge(fc[1] && fc[1].available ? fc[1].stats : null) + "</div></div></div>" +
        '<div class="tbl"><table><thead><tr><th>เขต</th><th class="num">กม.</th><th>ฝนตอนนี้ (รัศมี 3 กม.)</th></tr></thead><tbody>' +
        ds.map(function (d, i) { var st = x[i + 2] && x[i + 2].stats; return "<tr><td>" + esc(d.name) + '</td><td class="num">' + d.km.toFixed(1) + "</td><td>" + rainBadge(st) + "</td></tr>"; }).join("") +
        '</tbody></table></div><p class="olnote">เรดาร์ Longdo Weather อัปเดตทุก 15 นาที · <button type="button" class="linkbtn" id="toRadar">ดูภาพเรดาร์บนแผนที่ ›</button></p>';
      $("toRadar").onclick = function () { var b = document.querySelector('#layers [data-l="radar"]'); if (b && b.getAttribute("aria-pressed") !== "true") b.click(); showTab("now", true); setTimeout(function () { $("map").scrollIntoView({ block: "center" }); }, 80); };
    });
  }

  /* ---------- ช่วยเหลือ: shelters, parking, relief points (BMA Flood Support, via data/help.json) ---------- */
  var helpOpenOnly = true, helpMore = false;
  var DONATE = [
    { name: "อาคารสำนักการระบายน้ำ ชั้น 1 ศาลาว่าการ กทม. (ดินแดง)", tel: ["0816112878", "0954957960"] },
    { name: "โรงเรียนฝึกอาชีพกรุงเทพมหานคร (ประเวศ)", tel: ["0894461855", "0959264555"] }
  ];
  function fUrl(f) { var t = [f.link, f.additionalDetails, f.routeDetails].filter(Boolean).join(" "), m = t.match(/https?:\/\/\S+/); return m ? m[0] : "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(f.name + " เขต" + f.district); }
  function fNote(f) { var t = [f.additionalDetails, f.routeDetails].filter(Boolean).join(" ").replace(/https?:\/\/\S+/g, "").trim(); return t && !/^ไม่มี$/.test(t) ? t.slice(0, 140) : ""; }
  function fSt(f) { var s = f.status || ""; return s.indexOf("ใกล้เต็ม") > -1 ? ["warning", "ใกล้เต็ม"] : s.indexOf("เต็ม") > -1 ? ["severe", "เต็ม"] : /(^|[^เ])ปิด/.test(s) ? ["watch", "ปิด"] : ["normal", "ว่าง"]; }
  function fRow(f) {
    var st = fSt(f), old = (Date.now() - new Date(f.updatedAt).getTime()) / 3600000 > 24, note = fNote(f), unit = f.unitType || "";
    return '<div class="hrow"><div class="top"><span class="nm">' + esc(f.name) + '</span><span class="pill lv-' + st[0] + '">' + st[1] + "</span></div>" +
      '<span class="m">เขต' + esc(f.district) + (f.km != null ? " · " + f.km.toFixed(0) + " กม." : "") +
      (f.capacity ? " · ใช้แล้ว " + (f.occupied || 0) + "/" + f.capacity + " " + esc(unit) : "") + (old ? ' · <span class="old">ข้อมูลเก่ากว่า 24 ชม.</span>' : "") + "</span>" +
      (note ? '<span class="m">' + esc(note) + "</span>" : "") +
      '<a href="' + esc(fUrl(f)) + '" target="_blank" rel="noopener">แผนที่ / นำทาง</a></div>';
  }
  function renderHelp() {
    var el = $("helpBody");
    var don = '<h3 class="hh">จุดรับบริจาคของ กทม. (24 ชม.)</h3>' + DONATE.map(function (d) { return '<div class="hrow"><span class="nm">' + esc(d.name) + '</span><span class="m">' + d.tel.map(function (t) { return '<a href="tel:' + t + '">' + t.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3") + "</a>"; }).join(" · ") + "</span></div>"; }).join("") +
      '<p class="olnote">รับอาหารแห้ง อาหารปรุงสุก น้ำดื่ม นม นมผงเด็ก อุปกรณ์ทำความสะอาด</p>';
    if (!HL || !HL.facilities) { el.innerHTML = '<p class="note">ยังไม่มีข้อมูลศูนย์พักพิง ดูที่ <a href="https://floodsupport.bangkok.go.th/" target="_blank" rel="noopener">floodsupport.bangkok.go.th</a></p>' + don; return; }
    var dk = {}; S.districts.forEach(function (d) { dk[d.name] = d.km; });
    var all = HL.facilities.map(function (f) { f.km = dk[f.district] != null ? dk[f.district] : null; return f; }).filter(function (f) { return f.km != null && f.km <= 12; })
      .sort(function (a, b) { return a.km - b.km || (fSt(a)[1] === "เต็ม") - (fSt(b)[1] === "เต็ม") || (b.available || 0) - (a.available || 0); });
    var sh = all.filter(function (f) { return f.category === "ศูนย์พักพิงชั่วคราว"; }), shOpen = sh.filter(function (f) { return fSt(f)[1] !== "เต็ม" && fSt(f)[1] !== "ปิด"; });
    var list = helpOpenOnly ? shOpen : sh, show = helpMore ? list : list.slice(0, 8);
    var park = all.filter(function (f) { return f.category === "จุดจอดรถ"; }), other = all.filter(function (f) { return f.category !== "ศูนย์พักพิงชั่วคราว" && f.category !== "จุดจอดรถ"; });
    var free = shOpen.reduce(function (a, f) { return a + (f.available || 0); }, 0);
    el.innerHTML = '<div class="olhead"><span class="t">ศูนย์พักพิงในรัศมี ~12 กม.: ยังรับได้ ' + shOpen.length + " จาก " + sh.length + " แห่ง</span>" +
        '<span class="m">ว่างรวมราว ' + free.toLocaleString() + " ที่ · ข้อมูล กทม. ณ " + dm(new Date(new Date(HL.generatedAt || HL.fetched_at).getTime() + 7 * 3600000).toISOString()) + "</span></div>" +
      '<div class="sortrow"><button type="button" id="hOpen" aria-pressed="' + helpOpenOnly + '">เฉพาะที่ยังว่าง</button><button type="button" id="hAll" aria-pressed="' + !helpOpenOnly + '">ทั้งหมด</button></div>' +
      show.map(fRow).join("") +
      (list.length > show.length ? '<button type="button" class="maplink" id="hMore">ดูอีก ' + (list.length - show.length) + " แห่ง</button>" : "") +
      '<h3 class="hh">จุดจอดรถหนีน้ำ</h3>' + (park.length ? park.map(fRow).join("") : '<p class="note">ไม่มีในรัศมีนี้</p>') +
      (other.length ? '<h3 class="hh">จุดแจกอาหาร / แพทย์ / รถรับส่ง</h3>' + other.map(fRow).join("") : '<p class="note">ระบบ กทม. ยังไม่มีจุดแจกอาหาร/รถรับส่งในรัศมีนี้</p>') +
      don + '<p class="olnote">ข้อมูลจาก <a href="https://floodsupport.bangkok.go.th/" target="_blank" rel="noopener">BMA Flood Support</a> · สถานะอาจไม่ทันที โทรยืนยันก่อนเดินทาง · กทม. 1555</p>';
    $("hOpen").onclick = function () { helpOpenOnly = true; helpMore = false; renderHelp(); };
    $("hAll").onclick = function () { helpOpenOnly = false; helpMore = false; renderHelp(); };
    if ($("hMore")) $("hMore").onclick = function () { helpMore = true; renderHelp(); };
  }

  /* ---------- province list ---------- */
  var curP = PROVS[0], sortBy = "near", showNormal = false, openSet = {}; openSet[H.district] = true;
  PROVS.forEach(function (p) {
    var b = document.createElement("button"); b.type = "button"; b.dataset.p = p; b.dataset.label = p === "กรุงเทพมหานคร" ? "กรุงเทพฯ" : p; b.textContent = b.dataset.label; b.setAttribute("aria-pressed", p === curP);
    b.onclick = function () { curP = p; showNormal = false; $("provTabs").querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b); }); renderList(); };
    $("provTabs").appendChild(b);
  });
  $("sNear").onclick = function () { sortBy = "near"; this.setAttribute("aria-pressed", true); $("sSev").setAttribute("aria-pressed", false); renderList(); };
  $("sSev").onclick = function () { sortBy = "sev"; this.setAttribute("aria-pressed", true); $("sNear").setAttribute("aria-pressed", false); renderList(); };

  function renderList() {
    if (!S) return;
    var all = S.districts.filter(function (d) { return d.province === curP; });
    var nNormal = all.filter(function (d) { return d.level === "normal"; }).length;
    var ds = showNormal ? all : all.filter(function (d) { return d.level !== "normal"; });
    $("provTabs").querySelectorAll("button").forEach(function (b) { var n = S.districts.filter(function (d) { return d.province === b.dataset.p && d.level !== "normal"; }).length; b.textContent = b.dataset.label + " (" + n + ")"; });
    ds.sort(sortBy === "near" ? function (a, b) { return a.km - b.km; } : function (a, b) { return (LV[b.level] - LV[a.level]) || (b.score - a.score) || (a.km - b.km); });
    var el = $("dlist"); el.innerHTML = "";
    ds.forEach(function (d) {
      var hotG = d.g.filter(function (x) { return ST[x.st] >= 3 && !x.stale; }).length, rn = S._rain[d.id];
      var ev = [];["measured", "forecast", "reported", "confirmed"].forEach(function (k) { (d.evidence[k] || []).forEach(function (x) { if (x.points > 0 || k === "measured") ev.push(x.text); }); });
      var gs = d.g.filter(function (x) { return ST[x.st] >= 2; }).sort(function (a, b) { return ST[b.st] - ST[a.st]; }), gOk = d.g.length - gs.length;
      var tfs = S._tr.filter(function (t) { return t.district === d.id; }).sort(function (a, b) { return a.time < b.time ? 1 : -1; }).slice(0, 5);
      var det = document.createElement("details"); det.className = "d"; det.open = !!openSet[d.id];
      det.addEventListener("toggle", function () { openSet[d.id] = det.open; });
      det.innerHTML = '<summary><span class="nm">' + esc(d.name) + (d.id === H.district ? " · " + esc(H.short) : "") + '</span><span class="pill lv-' + d.level + '">' + esc(d.level_th) + "</span>" +
        '<span class="cnt">' + d.km.toFixed(1) + " กม. · วัดน้ำเกินวิกฤต " + hotG + "/" + d.g.length + " · น้ำท่วมบนถนน " + d.e.length + " · Traffy " + d.tf + (d.c.length ? " · กล้อง " + d.c.length : "") + "</span></summary>" +
        '<div class="body"><div class="adv">' + esc(d.advice) + "</div>" +
        (ev.length ? "<div><h3>หลักฐาน</h3><ul>" + ev.slice(0, 6).map(function (x) { return "<li>" + esc(x.length > 240 ? x.slice(0, 240) + "…" : x) + "</li>"; }).join("") + "</ul></div>" : "") +
        (rn ? '<div class="m">ฝนสะสม 24 ชม. สูงสุด <span class="mono">' + rn[0] + "</span> มม. ที่ " + esc(rn[1]) + "</div>" : "") +
        (gs.length ? '<div><h3>จุดวัดระดับน้ำ</h3><div class="tbl"><table><thead><tr><th>จุด</th><th class="num">น้ำ</th><th class="num">ตลิ่ง</th><th>สถานะ</th></tr></thead><tbody>' +
          gs.map(function (x) { return "<tr><td>" + esc(x.name) + "<br><small>" + esc(x.canal || "") + " · " + hm(x.time) + (x.stale ? " ค่าเก่า" : "") + '</small></td><td class="num">' + f2(x.value) + '</td><td class="num">' + f2(x.bank) + '</td><td class="st-' + x.st + '">' + STTH[x.st] + "</td></tr>"; }).join("") + "</tbody></table></div>" + (gOk ? '<div class="m">จุดวัดน้ำปกติ/ไม่มีเกณฑ์อีก ' + gOk + " จุด ไม่แสดง</div>" : "") + "</div>" : "") +
        (d.e.length ? "<div><h3>น้ำท่วมบนถนน (Longdo / iTIC / กรมทางหลวง)</h3><ul>" + d.e.slice().sort(function (a, b) { return (evLevel(b) - evLevel(a)) || (a.start < b.start ? 1 : -1); }).map(function (x) { return "<li>" + rpill(evLevel(x)) + " " + esc(x.title) + (x.depth_cm ? " · ลึก " + x.depth_cm + " ซม." : "") + " <small>" + hm(x.start) + " · " + esc(x.source) + "</small></li>"; }).join("") + "</ul></div>" : "") +
        (d.c.length ? "<div><h3>กล้อง</h3><ul>" + d.c.map(function (x) { return '<li><a href="' + esc(x.link) + '" target="_blank" rel="noopener">' + esc(x.title) + "</a> <small>" + esc(x.org) + "</small></li>"; }).join("") + "</ul></div>" : "") +
        (tfs.length ? "<div><h3>Traffy ล่าสุด</h3><ul>" + tfs.map(function (x) { return '<li><a href="' + esc((TR.link_base || "") + x.id) + '" target="_blank" rel="noopener">' + esc((x.text || "").slice(0, 90)) + "…</a> <small>" + hm(x.time) + " · " + esc(TFTH[x.state] || x.state) + "</small></li>"; }).join("") + "</ul></div>" : "") +
        "</div>";
      var btn = document.createElement("button"); btn.type = "button"; btn.className = "maplink"; btn.textContent = "ดูบนแผนที่";
      btn.onclick = function () { setView(null); map.setView([d.lat, d.lon], 14); showDist(d); $("map").scrollIntoView({ behavior: "smooth", block: "center" }); };
      det.querySelector(".body").appendChild(btn);
      el.appendChild(det);
    });
    if (!ds.length) { var em = document.createElement("p"); em.className = "note"; em.textContent = "ไม่มีเขตที่ผิดปกติในจังหวัดนี้"; el.appendChild(em); }
    if (nNormal) { var tg = document.createElement("button"); tg.type = "button"; tg.className = "maplink"; tg.textContent = showNormal ? "ซ่อนเขตปกติ" : "แสดงเขตปกติอีก " + nNormal + " เขต"; tg.onclick = function () { showNormal = !showNormal; renderList(); }; el.appendChild(tg); }
  }

  /* ---------- flooded roads by severity ---------- */
  function showRoad(r) {
    var ev = (S.events || []).filter(function (e) { return r.ids.indexOf(e.id) > -1; }).sort(function (a, b) { return evLevel(b) - evLevel(a); });
    card('<span class="t">' + rpill(r.level) + " " + esc(r.name) + '</span><span class="m">' + r.n + " รายงาน · ยืนยันโดยเจ้าหน้าที่ " + r.official + (r.depth_cm ? " · ลึกสุด ~" + r.depth_cm + " ซม." : "") + (r.uturn ? " · เฉพาะจุดกลับรถ" : "") +
      " · " + km(H.lat, H.lon, r.lat, r.lon).toFixed(1) + " กม. จาก " + esc(H.short) + " · รายงาน " + hm(r.latest) + "</span>" +
      vehRow(r.level, r.depth_cm) + "<ul>" + ev.slice(0, 6).map(function (e) { return "<li>" + rpill(evLevel(e)) + " " + esc((e.text || e.title).slice(0, 140)) + " <small>" + hm(e.start) + " · " + esc(e.source) + "</small></li>"; }).join("") + "</ul>" + lk(r.lat, r.lon));
  }
  function drawRoads() {
    G.ev.clearLayers();
    function show(lv, dep) { return veh ? vVerdict(lv, dep, veh) !== "ok" : lv >= sevMin; }
    function colr(lv, dep) { return veh ? VCOL[vVerdict(lv, dep, veh)] : RCOL[lv]; }
    if (RS) RS.roads.filter(function (r) { return r.lines.length && show(r.level, r.depth_cm); }).slice().reverse().forEach(function (r) {
      var w = { 4: 8, 3: 6, 2: 4, 1: 3 }[r.level];
      L.polyline(r.lines.map(function (s) { return s.map(function (p) { return [p[1], p[0]]; }); }), { color: "#fff", weight: w + 3, opacity: .9, interactive: false }).addTo(G.ev);
      L.polyline(r.lines.map(function (s) { return s.map(function (p) { return [p[1], p[0]]; }); }), { color: colr(r.level, r.depth_cm), weight: w, opacity: .95 }).on("click", function () { showRoad(r); }).addTo(G.ev);
    });
    (S.events || []).filter(function (e) { var x = EVL[e.id] || {}; return show(evLevel(e), x.depth_cm || e.depth_cm); }).sort(function (a, b) { return evLevel(a) - evLevel(b); }).forEach(function (e) {
      var lv = evLevel(e), x = EVL[e.id] || {}, z = { 4: 15, 3: 13, 2: 10, 1: 9 }[lv];
      L.marker([e.lat, e.lon], { zIndexOffset: lv * 100, icon: L.divIcon({ className: "", html: '<div class="fw-ev' + (lv === 4 ? " x" : "") + '" style="width:' + z + "px;height:" + z + "px;background:" + colr(lv, x.depth_cm || e.depth_cm) + '"></div>', iconSize: [z, z], iconAnchor: [z / 2, z / 2] }) })
        .on("click", function () { showEvent(e); }).addTo(G.ev);
    });
  }
  var roadsMore = false;
  function renderRoads() {
    var el = $("rlist"); if (!S) return;
    if (!RS) { el.innerHTML = '<p class="note">ยังไม่มีข้อมูลจัดระดับถนน รอรอบดึงข้อมูลถัดไป</p>'; return; }
    var cnt = { 4: 0, 3: 0, 2: 0, 1: 0 }; RS.roads.forEach(function (r) { cnt[r.level]++; });
    var rs = RS.roads.filter(function (r) { return r.level >= sevMin; }).map(function (r) { r.km = km(H.lat, H.lon, r.lat, r.lon); return r; })
      .sort(function (a, b) { return (b.level - a.level) || (a.km - b.km); });
    var show = roadsMore ? rs : rs.slice(0, 20);
    el.innerHTML = '<div class="rsum">' + [4, 3, 2, 1].map(function (l) { return rpill(l) + " " + cnt[l]; }).join(" ") + "</div>" +
      (show.length ? "" : '<p class="note">ไม่มีถนนในระดับที่เลือก</p>');
    show.forEach(function (r) {
      var b = document.createElement("button"); b.type = "button"; b.className = "rrow";
      b.innerHTML = rpill(r.level) + '<span class="rn">' + esc(r.name) + '</span><span class="rm">' + r.km.toFixed(1) + " กม. · " + r.n + " รายงาน" + (r.official ? " · ยืนยัน " + r.official : " · ประชาชนแจ้ง") +
        (r.depth_cm ? " · ~" + r.depth_cm + " ซม." : "") + (r.uturn ? " · จุดกลับรถ" : "") + " · " + hm(r.latest) + "</span>";
      b.onclick = function () {
        setView(null);
        if (r.lines.length) map.fitBounds(L.latLngBounds([].concat.apply([], r.lines).map(function (p) { return [p[1], p[0]]; })).pad(0.3), { maxZoom: 16 });
        else map.setView([r.lat, r.lon], 15);
        showRoad(r); $("map").scrollIntoView({ behavior: "smooth", block: "center" });
      };
      el.appendChild(b);
    });
    if (rs.length > 20) { var m = document.createElement("button"); m.type = "button"; m.className = "maplink"; m.textContent = roadsMore ? "แสดงน้อยลง" : "ดูอีก " + (rs.length - 20) + " ถนน"; m.onclick = function () { roadsMore = !roadsMore; renderRoads(); }; el.appendChild(m); }
  }
  $("sevMin").onchange = function () { sevMin = +this.value; if (S) { drawRoads(); renderRoads(); } };
  $("veh").onchange = function () { veh = this.value; $("sevMin").disabled = !!veh; if (S) { drawRoads(); drawFB(); } };

  /* ---------- controls ---------- */
  function setView(v) { ["vHome", "vAll", "vMe"].forEach(function (id) { $(id).setAttribute("aria-pressed", id === v); }); }
  $("vHome").onclick = function () { setView("vHome"); map.setView([H.lat, H.lon], 12); showHome(); };
  $("vAll").onclick = function () { setView("vAll"); map.setView([13.78, 100.58], 10); };
  $("vMe").onclick = function () {
    if (!navigator.geolocation) { card('<span class="t">เบราว์เซอร์นี้หาตำแหน่งไม่ได้</span>'); return; }
    setView("vMe");
    navigator.geolocation.getCurrentPosition(function (p) {
      var ll = [p.coords.latitude, p.coords.longitude];
      if (meMarker) map.removeLayer(meMarker);
      meMarker = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="fw-me" style="width:16px;height:16px"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(map);
      map.setView(ll, 15);
      var near = S ? [].concat(S.stations.canal || [], S.stations.river || []).filter(function (s) { return s.lat; }).map(function (s) { return [km(ll[0], ll[1], s.lat, s.lon), s]; }).sort(function (a, b) { return a[0] - b[0]; })[0] : null;
      card('<span class="t">ตำแหน่งของคุณ</span><span class="m">ห่างจาก ' + esc(H.short) + " " + km(ll[0], ll[1], H.lat, H.lon).toFixed(1) + " กม." +
        (near ? " · จุดวัดน้ำใกล้สุด " + esc(near[1].name) + " (" + near[0].toFixed(1) + " กม., " + (STTH[near[1].status] || "") + ")" : "") + "</span>" + lk(ll[0], ll[1]));
    }, function () { card('<span class="t">ยังไม่ได้รับอนุญาตให้ใช้ตำแหน่ง</span><span class="m">อนุญาตการเข้าถึงตำแหน่งในเบราว์เซอร์ แล้วกดอีกครั้ง</span>'); }, { enableHighAccuracy: true, timeout: 10000 });
  };
  document.querySelectorAll("#layers button").forEach(function (b) {
    b.onclick = function () {
      var on = b.getAttribute("aria-pressed") !== "true", l = b.dataset.l; b.setAttribute("aria-pressed", on);
      if (on) { map.addLayer(G[l]); if (l === "radar") loadRadar(); if (l === "cam") map.addLayer(rainCams); } else { map.removeLayer(G[l]); if (l === "cam") map.removeLayer(rainCams); if (l === "radar") { stopRadar(); $("radarBar").hidden = true; } }
    };
  });
  /* ---------- rain radar: Longdo Weather (past 3 h + 30 min forecast, zoom 9) or RainViewer fallback ---------- */
  var RF = [], RL = [], ri = 0, rTimer = null;
  function rTime(t) { return new Date(t * 1000).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) + " น."; }
  function showFrame(i) {
    if (!RL.length) return;
    ri = i; RL.forEach(function (l, k) { l.setOpacity(k === i ? .65 : 0); });
    $("rSlider").value = i;
    var obs = RF.filter(function (f) { return !f.fc; }), last = obs[obs.length - 1].time, mins = Math.round((last - RF[i].time) / 60);
    $("rTime").textContent = rTime(RF[i].time) + (RF[i].fc ? " · พยากรณ์ +" + (-mins) + " นาที" : RF[i].time === last ? " · ล่าสุด" : " · ก่อนล่าสุด " + mins + " นาที");
  }
  function stopRadar() { if (rTimer) { clearInterval(rTimer); rTimer = null; } $("rPlay").textContent = "▶ เล่น"; }
  function playRadar() {
    if (rTimer) { stopRadar(); return; }
    rTimer = setInterval(function () { showFrame((ri + 1) % RL.length); }, 700);
    $("rPlay").textContent = "❚❚ หยุด";
  }
  function setRadar(fr, mk) {
    var playing = !!rTimer; stopRadar();
    G.radar.clearLayers();
    RF = fr; RL = fr.map(mk).map(function (l) { return l.addTo(G.radar); });
    $("rSlider").max = fr.length - 1;
    var lastObs = 0; fr.forEach(function (f, k) { if (!f.fc) lastObs = k; });
    showFrame(lastObs);
    if (playing) playRadar();
  }
  function loadRadar() {
    $("radarBar").hidden = false;
    if (LK) {
      var k = "?key=" + encodeURIComponent(LK);
      fetch(LW + "layer/list" + k).then(function (r) { if (!r.ok) throw r.status; return r.json(); }).then(function (m) {
        var past = ((m.radar && m.radar.past) || []).slice(-12), fc = (m.radar && m.radar.forecast) || [];
        if (!past.length) throw 0;
        var fr = past.map(function (f) { return { time: f.time, path: f.path, z: f.maxzoom || 9 }; })
          .concat(fc.map(function (f) { return { time: f.time, path: f.path, z: f.maxzoom || 6, fc: true }; }));
        $("rSrc").href = "https://weather.longdo.com/"; $("rSrc").textContent = "Longdo Weather";
        setRadar(fr, function (f) { return L.tileLayer("https://weather.longdo.com" + f.path + "/{z}/{x}/{y}.png" + k, { opacity: 0, minNativeZoom: 5, maxNativeZoom: f.z, maxZoom: 19, attribution: "เรดาร์ฝน © Longdo Weather" }); });
      }).catch(loadRainViewer);
      return;
    }
    loadRainViewer();
  }
  function loadRainViewer() {
    fetch("https://api.rainviewer.com/public/weather-maps.json").then(function (r) { return r.json(); }).then(function (m) {
      var fr = [].concat((m.radar && m.radar.past) || [], (m.radar && m.radar.nowcast) || []); if (!fr.length) return;
      (m.radar.nowcast || []).forEach(function (f) { f.fc = true; });
      $("rSrc").href = "https://www.rainviewer.com/map.html?loc=13.742,100.702,9"; $("rSrc").textContent = "เปิด RainViewer";
      setRadar(fr, function (f) { return L.tileLayer(m.host + f.path + "/256/{z}/{x}/{y}/2/1_1.png", { opacity: 0, maxNativeZoom: 7, maxZoom: 19, attribution: "Radar © RainViewer" }); });
    }).catch(function () { $("rTime").textContent = "โหลดเรดาร์ฝนไม่สำเร็จ"; });
  }
  $("rPlay").onclick = playRadar;
  $("rSlider").oninput = function () { stopRadar(); showFrame(+this.value); };
  $("reload").onclick = load;

  showTab(location.hash.slice(1));
  showHome();
  load();
  setInterval(function () { if (!document.hidden) { load(); if (map.hasLayer(G.radar)) loadRadar(); } }, C.refresh_min * 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S && (Date.now() - new Date(S.generated_at).getTime()) > C.refresh_min * 60000) load(); });
})();
