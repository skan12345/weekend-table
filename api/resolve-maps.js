// Vercel serverless function: POST { url } -> resolves a short Google Maps
// link by following its redirect (which a browser can't do), then parses the
// full URL. CORS doesn't apply here, so short links finally work.
//
// Google returns more than one URL shape for the same short link:
//   A) /place/Name/@lat,lng/...!3d<lat>!4d<lng>   -> name + coordinates
//   B) /place/Name,+Full+Address/data=...         -> name+address, NO coordinates
// This handles both: it splits the name off the address, and when a URL has no
// coordinates (shape B) it forward-geocodes the address to recover them.
//
// Set GOOGLE_MAPS_API_KEY in Vercel for the address/forward-geocode features.

function splitPlaceSegment(url) {
  const m = url.match(/\/place\/([^/@]+)/);
  if (!m) return { name: "", addressText: "" };
  const full = decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
  const i = full.indexOf(",");
  return i >= 0
    ? { name: full.slice(0, i).trim(), addressText: full.slice(i + 1).trim() }
    : { name: full, addressText: "" };
}

function parseCoords(url) {
  const pin = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/); // real marker
  const view = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);    // viewport fallback
  const c = pin || view;
  return c ? { lat: parseFloat(c[1]), lng: parseFloat(c[2]) } : { lat: null, lng: null };
}

function parseGoogleId(url) {
  const m = url.match(/!16s(%2F[^!?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function reverseGeocode(lat, lng, key) {
  try {
    const u = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`;
    const j = await (await fetch(u)).json();
    return j.results?.[0]?.formatted_address || "";
  } catch {
    return "";
  }
}

async function forwardGeocode(addressText, key) {
  try {
    const u = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressText)}&key=${key}`;
    const j = await (await fetch(u)).json();
    const res = j.results?.[0];
    if (!res) return null;
    return {
      lat: res.geometry?.location?.lat ?? null,
      lng: res.geometry?.location?.lng ?? null,
      address: res.formatted_address || "",
    };
  } catch {
    return null;
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

    const { name, addressText } = splitPlaceSegment(longUrl);
    let { lat, lng } = parseCoords(longUrl);
    const googleId = parseGoogleId(longUrl);
    let address = "";

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (key) {
      if (lat != null) {
        // Shape A: have coordinates -> reverse-geocode for a clean street address.
        address = await reverseGeocode(lat, lng, key);
      } else if (addressText) {
        // Shape B: no coordinates -> forward-geocode the address to recover them.
        const g = await forwardGeocode(addressText, key);
        if (g) { lat = g.lat; lng = g.lng; address = g.address; }
      }
    } else if (addressText) {
      // No key: at least surface the address text we already have from the URL.
      address = addressText;
    }

    res.status(200).json({ longUrl, name, lat, lng, googleId, address, phone: "" });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
