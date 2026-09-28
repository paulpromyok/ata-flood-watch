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
    ev: L.layerGroup().addTo(map), cam: L.layerGroup().addTo(map), radar: L.layerGroup() };
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
  function card(html) { info.innerHTML = html; }
  function lk(lat, lon, extra) { return '<span class="links"><a href="' + gmaps(lat, lon) + '" target="_blank" rel="noopener">Google Maps จราจร</a>' + (extra || "") + "</span>"; }
  function showHome() {
    card('<span class="t">' + esc(H.name) + '</span><span class="m">' + esc(H.addr) + '</span><span class="m">แตะจุดบนแผนที่เพื่อดูรายละเอียด · แตะพื้นเขตเพื่อดูระดับเตือนภัย</span>' +
      lk(H.lat, H.lon, '<a href="https://www.rainviewer.com/map.html?loc=' + H.lat.toFixed(3) + "," + H.lon.toFixed(3) + ',11" target="_blank" rel="noopener">เรดาร์ฝน</a>'));
  }
  function showGauge(d) {
    card('<span class="t">' + esc(d.name) + '</span><span class="m">' + esc(d.canal || "") + " · " + esc(d.district || d.amphoe) + " · " + d.km.toFixed(1) + " กม. จาก " + esc(H.short) + "</span>" +
      '<span>น้ำ <span class="mono">' + f2(d.value) + "</span>" + (d.bank != null ? ' · ตลิ่ง <span class="mono">' + f2(d.bank) + "</span>" : "") + ' ม.รทก. · <span class="st-' + d.st + '">' + STTH[d.st] + "</span>" +
      (d.to_bank_m != null ? ' <span class="m">(ห่างตลิ่ง ' + f2(d.to_bank_m) + " ม.)</span>" : "") + "</span>" +
      '<span class="m">วัดเมื่อ ' + dm(d.time) + (d.stale ? " · ค่าเก่า" : "") + "</span>" + lk(d.lat, d.lon));
  }
  function showEvent(d) {
    var x = EVL[d.id] || {}, dep = x.depth_cm || d.depth_cm;
    card('<span class="t">' + rpill(evLevel(d)) + " " + esc(d.title) + '</span><span class="m">' + esc(d.text) + '</span><span class="m">' + dm(d.start) + " · " + esc(d.source) + (d.official ? " (ยืนยัน)" : " (ประชาชนแจ้ง)") +
      (dep ? " · ลึก ~" + dep + " ซม." : "") + (x.uturn ? " · เฉพาะจุดกลับรถ" : "") + " · " + d.km.toFixed(1) + " กม. จาก " + esc(H.short) + "</span>" + lk(d.lat, d.lon));
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
      CANALS ? Promise.resolve(CANALS) : j(BASE + "canals.geojson"), DISTS ? Promise.resolve(DISTS) : j(BASE + "districts.geojson")])
      .then(function (r) { S = r[0]; TR = r[1] || { reports: [] }; RS = r[2]; CANALS = r[3]; DISTS = r[4]; EVL = {}; if (RS) RS.events.forEach(function (x) { EVL[x.id] = x; }); render(); })
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

    Object.keys(G).forEach(function (k) { if (k !== "radar") G[k].clearLayers(); });
    L.geoJSON(DISTS, {
      style: function (f) { var d = DM[f.properties.id], lv = d ? d.level : "normal"; return { color: "#8aa0a6", weight: 1, fillColor: FILL[lv], fillOpacity: FOP[lv] }; },
      onEachFeature: function (f, l) { l.on("click", function () { var d = DM[f.properties.id]; if (d) showDist(d); }); }
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
    S._rain = rain; S._tr = tr;
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
      "<ul>" + ev.slice(0, 6).map(function (e) { return "<li>" + rpill(evLevel(e)) + " " + esc((e.text || e.title).slice(0, 140)) + " <small>" + hm(e.start) + " · " + esc(e.source) + "</small></li>"; }).join("") + "</ul>" + lk(r.lat, r.lon));
  }
  function drawRoads() {
    G.ev.clearLayers();
    if (RS) RS.roads.filter(function (r) { return r.level >= sevMin && r.lines.length; }).slice().reverse().forEach(function (r) {
      var w = { 4: 8, 3: 6, 2: 4, 1: 3 }[r.level];
      L.polyline(r.lines.map(function (s) { return s.map(function (p) { return [p[1], p[0]]; }); }), { color: "#fff", weight: w + 3, opacity: .9, interactive: false }).addTo(G.ev);
      L.polyline(r.lines.map(function (s) { return s.map(function (p) { return [p[1], p[0]]; }); }), { color: RCOL[r.level], weight: w, opacity: .95 }).on("click", function () { showRoad(r); }).addTo(G.ev);
    });
    (S.events || []).filter(function (e) { return evLevel(e) >= sevMin; }).sort(function (a, b) { return evLevel(a) - evLevel(b); }).forEach(function (e) {
      var lv = evLevel(e), z = { 4: 15, 3: 13, 2: 10, 1: 9 }[lv];
      L.marker([e.lat, e.lon], { zIndexOffset: lv * 100, icon: L.divIcon({ className: "", html: '<div class="fw-ev' + (lv === 4 ? " x" : "") + '" style="width:' + z + "px;height:" + z + "px;background:" + RCOL[lv] + '"></div>', iconSize: [z, z], iconAnchor: [z / 2, z / 2] }) })
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

  showHome();
  load();
  setInterval(function () { if (!document.hidden) { load(); if (map.hasLayer(G.radar)) loadRadar(); } }, C.refresh_min * 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && S && (Date.now() - new Date(S.generated_at).getTime()) > C.refresh_min * 60000) load(); });
})();
