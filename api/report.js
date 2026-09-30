// ATA Flood Watch — team flood reports (Vercel serverless function).
//   POST /api/report            {lat, lon, level 1-4, depth_cm, note, photo (data:image/jpeg;base64,...)}
//   GET  /api/report?list=1&hours=24   -> {reports:[{id,time,lat,lon,level,depth_cm,note,photo}]}
//   GET  /api/report?photo=<id>        -> the JPEG
// Reports are stored in a PRIVATE GitHub repo, one file per report, so photos never land in the public repo.
// Vercel environment variables (Project → Settings → Environment Variables):
//   REPORTS_REPO   e.g. "paulpromyok/ata-flood-reports"   (private repo)
//   REPORTS_TOKEN  fine-grained GitHub token, access to that repo only, Contents: Read and write
//   REPORT_PIN     optional: a code staff type once; empty = anyone with the link can report
const API = "https://api.github.com";
const LV = new Set([1, 2, 3, 4]);

function gh(path, init = {}) {
  return fetch(`${API}/repos/${process.env.REPORTS_REPO}/contents/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.REPORTS_TOKEN}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ata-flood-watch", ...(init.headers || {}) },
  });
}
const day = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "/");
const clean = (s) => String(s || "").replace(/[\u0000-\u001f]/g, " ")
  .replace(/(\+?66|0)[\s-]?\d[\d\s-]{7,11}/g, "[เบอร์โทรถูกลบ]").slice(0, 200).trim();

async function list(hours) {
  const since = Date.now() - hours * 3600e3, out = [];
  for (let t = Date.now(); t >= since - 864e5; t -= 864e5) {
    const r = await gh(`reports/${day(t)}`);
    if (!r.ok) continue;
    const files = (await r.json()).filter((f) => f.name.endsWith(".json"));
    const rows = await Promise.all(files.map(async (f) => {
      const x = await gh(f.path, { headers: { Accept: "application/vnd.github.raw" } });
      return x.ok ? x.json() : null;
    }));
    rows.forEach((x) => { if (x && Date.parse(x.time) >= since) out.push(x); });
  }
  return out.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}

module.exports = async function handler(req, res) {
  if (!process.env.REPORTS_REPO || !process.env.REPORTS_TOKEN) return res.status(503).json({ error: "reports not configured" });
  try {
    if (req.method === "GET" && req.query.photo) {
      const id = String(req.query.photo).replace(/[^\w-]/g, "");
      const r = await gh(`photos/${id.slice(0, 10).replace(/-/g, "/")}/${id}.jpg`, { headers: { Accept: "application/vnd.github.raw" } });
      if (!r.ok) return res.status(404).end();
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      return res.send(Buffer.from(await r.arrayBuffer()));
    }
    if (req.method === "GET") {
      const hours = Math.min(72, Math.max(1, +req.query.hours || 24));
      res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
      return res.json({ reports: await list(hours) });
    }
    if (req.method !== "POST") return res.status(405).end();
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (process.env.REPORT_PIN && b.pin !== process.env.REPORT_PIN) return res.status(403).json({ error: "pin" });
    const lat = +b.lat, lon = +b.lon, level = +b.level;
    if (!(lat > 5 && lat < 21 && lon > 97 && lon < 106) || !LV.has(level)) return res.status(400).json({ error: "bad location or level" });
    const depth = b.depth_cm == null || b.depth_cm === "" ? null : Math.max(0, Math.min(200, Math.round(+b.depth_cm)));
    const now = new Date(), id = now.toISOString().slice(0, 10) + "-" + now.getTime().toString(36) + Math.random().toString(36).slice(2, 6);
    let photo = false;
    if (typeof b.photo === "string" && b.photo.startsWith("data:image/jpeg;base64,")) {
      const b64 = b.photo.slice(23);
      if (b64.length > 1.4e6) return res.status(413).json({ error: "photo too large" });
      const r = await gh(`photos/${day(now)}/${id}.jpg`, { method: "PUT", body: JSON.stringify({ message: `photo ${id}`, content: b64 }) });
      photo = r.ok;
    }
    const rec = { id, time: now.toISOString(), lat: +lat.toFixed(5), lon: +lon.toFixed(5), level, depth_cm: depth, note: clean(b.note), photo };
    const r = await gh(`reports/${day(now)}/${id}.json`, { method: "PUT",
      body: JSON.stringify({ message: `report ${id}`, content: Buffer.from(JSON.stringify(rec)).toString("base64") }) });
    if (!r.ok) return res.status(502).json({ error: "store failed", status: r.status });
    return res.status(201).json(rec);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
