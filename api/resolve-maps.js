// Vercel serverless function: POST { url } -> resolves a short Google Maps
// link by following its redirect (which a browser can't do), then parses the
// full URL. CORS doesn't apply here, so short links finally work.
//
// Optional: set GOOGLE_MAPS_API_KEY in Vercel to also fill in the street
// address (reverse-geocoded from the resolved coordinates).

function parseMapsUrl(url) {
  if (!url) return null;
  const nameM = url.match(/\/place\/([^/@]+)/);
  const pin = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const view = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const c = pin || view;
  const idM = url.match(/!16s(%2F[^!?]+)/);
  if (!nameM && !c) return null;
  return {
    name: nameM ? decodeURIComponent(nameM[1].replace(/\+/g, " ")) : "",
    lat: c ? parseFloat(c[1]) : null,
    lng: c ? parseFloat(c[2]) : null,
    googleId: idM ? decodeURIComponent(idM[1]) : null,
  };
}

async function reverseGeocode(lat, lng, key) {
  try {
    const u = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`;
    const r = await fetch(u);
    const j = await r.json();
    return j.results?.[0]?.formatted_address || "";
  } catch {
    return "";
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { url } = body;
    if (!url) { res.status(400).json({ error: "url required" }); return; }

    // Follow redirects to the canonical Maps URL.
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" } });
    const longUrl = r.url;
    const parsed = parseMapsUrl(longUrl) || {};

    let address = "";
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (key && parsed.lat != null) {
      address = await reverseGeocode(parsed.lat, parsed.lng, key);
    }

    res.status(200).json({ longUrl, ...parsed, address, phone: "" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
