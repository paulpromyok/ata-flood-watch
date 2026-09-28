// ATA Flood Watch — settings. Edit here, no other file needs to change.
window.FW_CONFIG = {
  // Map center / "home" point
  home: {
    name: "บริษัท เอที เทคโนโลยี เอนนี่แวร์ จำกัด",
    short: "ATA",
    addr: "216/22 ถ.กาญจนาภิเษก แขวงทับช้าง เขตสะพานสูง กรุงเทพฯ",
    district: "สะพานสูง",
    lat: 13.7420531,
    lon: 100.7022086
  },
  // Where the page reads data/*.json. On Vercel, point this at the GitHub repo so data
  // refreshes every 15 min without redeploying. Replace OWNER with the GitHub account/org.
  // Leave "" to read from the same site (GitHub Pages / local test).
  data_base: "https://raw.githubusercontent.com/paulpromyok/ata-flood-watch/main/data/",
  rings_km: [5, 10],        // dashed circles around home
  summary_km: 5,            // radius used for the home summary numbers
  traffy_km: 10,            // Traffy reports shown on the map within this radius
  refresh_min: 5,           // how often the open page re-reads data/latest.json
  stale_min: 60,            // warn when data is older than this
  // Longdo Map API key (api.longdo.com/console). Enables Longdo rain radar (zoom 9, 15-min),
  // rain now / +15 / +30 min at the office, and cameras where it is raining. Leave "" to use RainViewer.
  // In the Longdo console, limit this key's Domain to ata-flood-watch.vercel.app.
  longdo_key: "59937ebbe7feb21f5aeb31b3ff2e99b0"
};

