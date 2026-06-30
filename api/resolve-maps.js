// Vercel serverless function: POST { url } -> structured place data, using
// Google's OFFICIAL Maps Tools Resolution API + Places Details. No HTML
// scraping: ToS-compliant, and immune to the consent/redirect walls that block
// server-side redirect-following.
//
// Flow:
//   1. resolveMapsUrls(url)      -> Place ID   (accepts maps.app.goo.gl short links)
//   2. Places Details(placeId)   -> name, address, coordinates, phone
//
// Requires GOOGLE_MAPS_API_KEY, with these APIs enabled on the key:
//   - Maps Tools API     (mapstools.googleapis.com)
//   - Places API (New)   (places.googleapis.com)

const RESOLVE_ENDPOINT = "https://mapstools.googleapis.com/v1alpha:resolveMapsUrls";
const PLACES_BASE = "https://places.googleapis.com/v1/";

async function urlToPlaceId(url, key) {
  const r = await fetch(RESOLVE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({ urls: [url] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `resolveMapsUrls ${r.status}`);
  // Batch response: entities[i] is {} when item i failed to resolve.
  return j?.entities?.[0]?.place || null; // e.g. "places/ChIJ..."
}

async function placeDetails(placeResource, key) {
  const r = await fetch(`${PLACES_BASE}${placeResource}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "id,displayName,formattedAddress,location,nationalPhoneNumber",
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `places details ${r.status}`);
  return {
    name: j?.displayName?.text || "",
    address: j?.formattedAddress || "",
    lat: j?.location?.latitude ?? null,
    lng: j?.location?.longitude ?? null,
    phone: j?.nationalPhoneNumber || "",
    googleId: j?.id || placeResource,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { url } = body;
    if (!url) { res.status(400).json({ error: "url required" }); return; }

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      res.status(200).json({ name: "", lat: null, lng: null, address: "", phone: "", error: "GOOGLE_MAPS_API_KEY not set" });
      return;
    }

    const place = await urlToPlaceId(url, key);
    if (!place) {
      res.status(200).json({ name: "", lat: null, lng: null, address: "", phone: "", error: "unresolved" });
      return;
    }

    const details = await placeDetails(place, key);
    res.status(200).json({ longUrl: url, ...details });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
}
