// Pure helpers + constants shared across the app.

export const CUISINES = [
  { id: "japanese", label: "Japanese", color: "#3A5BA0" },
  { id: "chinese", label: "Chinese", color: "#C0392B" },
  { id: "thai", label: "Thai", color: "#1E8A6E" },
  { id: "malaysian", label: "Malaysian", color: "#E0A52E" },
  { id: "indian", label: "Indian", color: "#D9622B" },
  { id: "other", label: "Other", color: "#7A3B52" },
];
export const cuisineMap = Object.fromEntries(CUISINES.map((c) => [c.id, c]));

export const SOURCES = [
  "Google", "Instagram", "Facebook", "Threads", "Little Red Note", "Word of mouth", "Other",
];

export const SLOTS = {
  saturday: { label: "Saturday dinner", sub: "Keep it close to home", tiers: ["close"] },
  sunday: { label: "Sunday brunch", sub: "Happy to venture farther", tiers: ["close", "far"] },
};

// Parse a FULL Google Maps URL. Short maps.app.goo.gl links must be
// resolved server-side first (see /api/resolve-maps).
export function parseMapsUrl(url) {
  if (!url) return null;
  const nameM = url.match(/\/place\/([^/@]+)/);
  const pin = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/); // real marker
  const view = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/); // viewport fallback
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

export const isShortMapsLink = (u) => /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(u || "");

// Pull the first http(s) URL out of arbitrary shared text.
export const firstUrl = (s) => (String(s || "").match(/https?:\/\/\S+/) || [])[0] || "";

export function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function milesBetween(place, settings) {
  if (place?.lat == null || settings?.homeLat == null) return null;
  return haversineMiles(settings.homeLat, settings.homeLng, place.lat, place.lng);
}
