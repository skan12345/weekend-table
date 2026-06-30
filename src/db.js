import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabase = Boolean(URL && KEY);
export const supabase = hasSupabase ? createClient(URL, KEY) : null;

/* ---- row <-> app object mapping ---- */
const fromRow = (r) => ({
  id: r.id,
  name: r.name,
  address: r.address || "",
  phone: r.phone || "",
  cuisine: r.cuisine,
  tier: r.tier,
  source: r.source,
  url: r.url || "",
  notes: r.notes || "",
  status: r.status || "want",
  lat: r.lat ?? null,
  lng: r.lng ?? null,
  googleId: r.google_id || null,
  lastVisited: r.last_visited || null,
  createdAt: r.created_at,
});

const toRow = (o) => ({
  name: o.name,
  address: o.address || null,
  phone: o.phone || null,
  cuisine: o.cuisine,
  tier: o.tier,
  source: o.source,
  url: o.url || null,
  notes: o.notes || null,
  status: o.status || "want",
  lat: o.lat ?? null,
  lng: o.lng ?? null,
  google_id: o.googleId || null,
  last_visited: o.lastVisited || null,
});

/* ---- restaurants ---- */
export async function listRestaurants() {
  const { data, error } = await supabase
    .from("restaurants")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(fromRow);
}

export async function addRestaurant(obj) {
  const { data, error } = await supabase
    .from("restaurants")
    .insert(toRow(obj))
    .select()
    .single();
  if (error) throw error;
  return fromRow(data);
}

export async function updateRestaurant(id, patch) {
  // patch uses app keys; translate the ones that differ
  const row = {};
  const map = { googleId: "google_id", lastVisited: "last_visited" };
  for (const [k, v] of Object.entries(patch)) row[map[k] || k] = v;
  const { data, error } = await supabase
    .from("restaurants")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return fromRow(data);
}

export async function deleteRestaurant(id) {
  const { error } = await supabase.from("restaurants").delete().eq("id", id);
  if (error) throw error;
}

/* ---- settings (single shared row, id = 1) ---- */
export async function getSettings() {
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { homeLat: null, homeLng: null, homeLabel: "", thresholdMiles: 5 };
  return {
    homeLat: data.home_lat ?? null,
    homeLng: data.home_lng ?? null,
    homeLabel: data.home_label || "",
    thresholdMiles: data.threshold_miles ?? 5,
  };
}

export async function saveSettings(s) {
  const { error } = await supabase.from("settings").upsert({
    id: 1,
    home_lat: s.homeLat,
    home_lng: s.homeLng,
    home_label: s.homeLabel,
    threshold_miles: s.thresholdMiles,
  });
  if (error) throw error;
}
