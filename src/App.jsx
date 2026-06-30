import { useState, useEffect, useRef, useCallback } from "react";
import {
  Moon, Sun, Shuffle, Plus, MapPin, Link2, Trash2, Check, X,
  Search, Star, Pencil, ExternalLink, UtensilsCrossed,
  Settings, Sparkles, Home, Phone, Loader2,
} from "lucide-react";
import {
  CUISINES, cuisineMap, SOURCES, SLOTS,
  parseMapsUrl, isShortMapsLink, firstUrl, haversineMiles, milesBetween,
} from "./lib.js";
import {
  hasSupabase, supabase,
  listRestaurants, addRestaurant, updateRestaurant, deleteRestaurant,
  getSettings, saveSettings,
} from "./db.js";

const DEFAULT_SETTINGS = { homeLat: null, homeLng: null, homeLabel: "", thresholdMiles: 5 };

/* Resolve a short Maps link via our serverless function. */
async function resolveShortLink(url) {
  const res = await fetch("/api/resolve-maps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`resolver ${res.status}`);
  return res.json(); // { longUrl, name, lat, lng, googleId, address, phone }
}

export default function App() {
  const [places, setPlaces] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("decide");
  const [showSettings, setShowSettings] = useState(false);
  const [sharedLink, setSharedLink] = useState("");

  const reload = useCallback(async () => {
    const rows = await listRestaurants();
    setPlaces(rows);
  }, []);

  // Initial load
  useEffect(() => {
    if (!hasSupabase) { setLoading(false); return; }
    Promise.all([listRestaurants(), getSettings()])
      .then(([rows, s]) => { setPlaces(rows); setSettings(s); })
      .catch((e) => setError(e.message || String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Live sync between the two of you
  useEffect(() => {
    if (!hasSupabase) return;
    const ch = supabase
      .channel("restaurants-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurants" }, () => { reload(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  // Catch an incoming share (Android share-target or iOS Shortcut → ?url/?text/?title)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const raw = p.get("url") || p.get("text") || p.get("title") || "";
    const link = firstUrl(raw) || (p.get("url") || "");
    if (link) {
      setSharedLink(link);
      setTab("places");
      // clean the URL so a refresh doesn't re-trigger
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const addPlace = async (data) => { await addRestaurant(data); await reload(); };
  const updatePlace = async (id, patch) => { await updateRestaurant(id, patch); await reload(); };
  const deletePlace = async (id) => { await deleteRestaurant(id); await reload(); };

  const updateSettings = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try { await saveSettings(next); } catch (e) { setError(e.message || String(e)); }
  };

  return (
    <div className="wt-root">
      <header className="wt-header">
        <div className="wt-header-row">
          <div className="wt-brand">
            <UtensilsCrossed size={20} strokeWidth={2.2} />
            <span>Weekend Table</span>
          </div>
          <button className="wt-gear" onClick={() => setShowSettings(true)} aria-label="Settings">
            <Settings size={18} />
          </button>
        </div>
        <p className="wt-tag">For the two of us, every Saturday and Sunday</p>
      </header>

      <nav className="wt-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "decide"} className={tab === "decide" ? "on" : ""} onClick={() => setTab("decide")}>
          Decide
        </button>
        <button role="tab" aria-selected={tab === "places"} className={tab === "places" ? "on" : ""} onClick={() => setTab("places")}>
          Our places{places.length ? <span className="wt-count">{places.length}</span> : null}
        </button>
      </nav>

      <main className="wt-main">
        {!hasSupabase ? (
          <SetupNotice />
        ) : error ? (
          <p className="wt-error">Couldn't reach the database: {error}</p>
        ) : loading ? (
          <p className="wt-loading">Setting the table…</p>
        ) : tab === "decide" ? (
          <Decide
            places={places}
            onVisited={(id) => updatePlace(id, { status: "been", lastVisited: new Date().toISOString() })}
            goAdd={() => setTab("places")}
          />
        ) : (
          <Places
            places={places} add={addPlace} update={updatePlace} remove={deletePlace}
            settings={settings} sharedLink={sharedLink} clearShared={() => setSharedLink("")}
          />
        )}
      </main>

      {showSettings && (
        <SettingsSheet settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="wt-empty">
      <p className="wt-empty-h">Almost there</p>
      <p className="wt-empty-b">
        Add your Supabase URL and anon key as <code>VITE_SUPABASE_URL</code> and{" "}
        <code>VITE_SUPABASE_ANON_KEY</code> (in <code>.env</code> locally, or in Vercel's
        environment variables), then reload. The README has the full setup.
      </p>
    </div>
  );
}

/* ---------------------------- decide view ---------------------------- */

function Decide({ places, onVisited, goAdd }) {
  const [cuisineFilter, setCuisineFilter] = useState(() => new Set(CUISINES.map((c) => c.id)));
  const [picker, setPicker] = useState({ phase: "idle" });
  const rollRef = useRef(null);

  useEffect(() => () => clearTimeout(rollRef.current), []);

  const toggleCuisine = (id) =>
    setCuisineFilter((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const candidatesFor = (slot) =>
    places.filter((p) => p.status === "want" && SLOTS[slot].tiers.includes(p.tier) && cuisineFilter.has(p.cuisine));

  const run = (slot) => {
    clearTimeout(rollRef.current);
    const pool = candidatesFor(slot);
    if (pool.length === 0) { setPicker({ phase: "empty", slot }); return; }
    setPicker({ phase: "rolling", slot, current: pool[0] });
    let ticks = 0;
    const total = Math.min(20, 9 + pool.length);
    const step = (delay) => {
      rollRef.current = setTimeout(() => {
        ticks += 1;
        if (ticks >= total) {
          setPicker({ phase: "result", slot, result: pool[Math.floor(Math.random() * pool.length)] });
        } else {
          setPicker((p) => ({ ...p, current: pool[Math.floor(Math.random() * pool.length)] }));
          step(Math.min(255, delay * 1.13));
        }
      }, delay);
    };
    step(55);
  };

  const slotIcon = { saturday: Moon, sunday: Sun };

  if (places.length === 0) {
    return (
      <div className="wt-empty">
        <p className="wt-empty-h">No places saved yet</p>
        <p className="wt-empty-b">
          Add the spots you find on Instagram, Threads, Little Red Note and Google — or share a link
          straight into the app. When neither of you can decide, this picks for you.
        </p>
        <div className="wt-empty-actions">
          <button className="wt-btn primary" onClick={goAdd}>Add a place</button>
        </div>
      </div>
    );
  }

  return (
    <div className="wt-decide">
      <div className="wt-filters">
        <span className="wt-filters-label">In the mood for</span>
        <div className="wt-chips">
          {CUISINES.map((c) => {
            const on = cuisineFilter.has(c.id);
            return (
              <button key={c.id} className={`wt-chip ${on ? "on" : ""}`} onClick={() => toggleCuisine(c.id)}
                style={on ? { borderColor: c.color, color: c.color } : undefined}>
                <span className="dot" style={{ background: c.color }} />{c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="wt-slots">
        {Object.entries(SLOTS).map(([key, s]) => {
          const Icon = slotIcon[key];
          const n = candidatesFor(key).length;
          return (
            <button key={key} className="wt-slot" onClick={() => run(key)} disabled={picker.phase === "rolling"}>
              <Icon size={22} strokeWidth={2} />
              <span className="wt-slot-label">{s.label}</span>
              <span className="wt-slot-sub">{s.sub}</span>
              <span className="wt-slot-n">{n} place{n === 1 ? "" : "s"} fit</span>
            </button>
          );
        })}
      </div>

      {picker.phase !== "idle" && (
        <Ticket picker={picker} onReroll={() => run(picker.slot)} onClose={() => setPicker({ phase: "idle" })} onVisited={onVisited} />
      )}
    </div>
  );
}

function Ticket({ picker, onReroll, onClose, onVisited }) {
  const slot = SLOTS[picker.slot];

  if (picker.phase === "empty") {
    return (
      <div className="wt-ticket">
        <div className="wt-ticket-top"><span className="wt-ticket-slot">{slot.label}</span></div>
        <p className="wt-ticket-empty">
          Nothing saved fits that yet. {picker.slot === "saturday"
            ? "Add a close-by spot, or loosen the cuisine filter."
            : "Loosen the cuisine filter or add more places."}
        </p>
        <button className="wt-btn ghost small" onClick={onClose}>Close</button>
      </div>
    );
  }

  const rolling = picker.phase === "rolling";
  const place = rolling ? picker.current : picker.result;
  const c = cuisineMap[place.cuisine];

  return (
    <div className={`wt-ticket ${rolling ? "rolling" : "settled"}`}>
      <div className="wt-ticket-top">
        <span className="wt-ticket-slot">{slot.label}</span>
        {!rolling && <button className="wt-ticket-x" onClick={onClose} aria-label="Dismiss"><X size={16} /></button>}
      </div>
      <p className="wt-ticket-eyebrow">{rolling ? "Choosing…" : "Tonight you're going to"}</p>
      <h2 className="wt-ticket-name" key={place.id}>{place.name}</h2>
      <div className="wt-ticket-meta">
        <span className="wt-tag-cuisine" style={{ color: c.color }}>
          <span className="dot" style={{ background: c.color }} /> {c.label}
        </span>
        <span className="wt-tag-tier"><MapPin size={13} /> {place.tier === "close" ? "Close" : "Worth the trip"}</span>
      </div>
      {!rolling && (
        <div className="wt-ticket-actions">
          <button className="wt-btn ghost small" onClick={onReroll}><Shuffle size={15} /> Shuffle again</button>
          {place.url ? <a className="wt-btn ghost small" href={place.url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open</a> : null}
          <button className="wt-btn primary small" onClick={() => { onVisited(place.id); onClose(); }}><Check size={15} /> Lock it in</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- places view ---------------------------- */

function Places({ places, add, update, remove, settings, sharedLink, clearShared }) {
  const [query, setQuery] = useState("");
  const [fCuisine, setFCuisine] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  // Open the form pre-filled when a link is shared into the app
  useEffect(() => {
    if (sharedLink) { setEditing(null); setShowForm(true); }
  }, [sharedLink]);

  const visible = places
    .filter((p) => (fCuisine === "all" ? true : p.cuisine === fCuisine))
    .filter((p) => (fStatus === "all" ? true : p.status === fStatus))
    .filter((p) => (query ? (p.name + " " + (p.notes || "") + " " + (p.address || "")).toLowerCase().includes(query.toLowerCase()) : true));

  const closeForm = () => { setShowForm(false); setEditing(null); clearShared(); };

  return (
    <div className="wt-places">
      <div className="wt-places-bar">
        <div className="wt-search">
          <Search size={16} />
          <input placeholder="Search saved places" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="wt-btn primary small" onClick={() => { setEditing(null); setShowForm(true); }}>
          <Plus size={16} /> Add
        </button>
      </div>

      <div className="wt-place-filters">
        <select value={fCuisine} onChange={(e) => setFCuisine(e.target.value)}>
          <option value="all">All cuisines</option>
          {CUISINES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="all">Want + visited</option>
          <option value="want">Want to try</option>
          <option value="been">Visited</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="wt-none">{places.length === 0 ? "Nothing saved yet. Tap Add to start your list." : "No places match those filters."}</p>
      ) : (
        <ul className="wt-list">
          {visible.map((p) => {
            const c = cuisineMap[p.cuisine];
            const mi = milesBetween(p, settings);
            return (
              <li key={p.id} className="wt-card">
                <span className="wt-card-stripe" style={{ background: c.color }} />
                <div className="wt-card-body">
                  <div className="wt-card-head">
                    <h3>{p.name}</h3>
                    <div className="wt-card-tools">
                      <button aria-label="Edit" onClick={() => { setEditing(p); setShowForm(true); }}><Pencil size={15} /></button>
                      <button aria-label="Remove" onClick={() => remove(p.id)}><Trash2 size={15} /></button>
                    </div>
                  </div>
                  <div className="wt-card-meta">
                    <span style={{ color: c.color }}><span className="dot" style={{ background: c.color }} />{c.label}</span>
                    <span><MapPin size={12} /> {p.tier === "close" ? "Close" : "Worth the trip"}{mi != null ? ` · ${mi.toFixed(1)} mi` : ""}</span>
                    <span className="wt-src">{p.source}</span>
                  </div>
                  {p.address ? <p className="wt-card-addr"><MapPin size={12} /> {p.address}</p> : null}
                  {p.notes ? <p className="wt-card-notes">{p.notes}</p> : null}
                  <div className="wt-card-foot">
                    <button className={`wt-status ${p.status}`} onClick={() => update(p.id, { status: p.status === "want" ? "been" : "want", lastVisited: p.status === "want" ? new Date().toISOString() : null })}>
                      {p.status === "want" ? <><Star size={13} /> Want to try</> : <><Check size={13} /> Visited</>}
                    </button>
                    {p.phone ? <a className="wt-card-link" href={`tel:${p.phone.replace(/[^+\d]/g, "")}`}><Phone size={13} /> Call</a> : null}
                    {p.url ? <a className="wt-card-link" href={p.url} target="_blank" rel="noreferrer"><Link2 size={13} /> Link</a> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showForm && (
        <PlaceForm
          initial={editing} settings={settings} initialLink={sharedLink}
          onClose={closeForm}
          onSave={async (data) => { editing ? await update(editing.id, data) : await add(data); closeForm(); }}
        />
      )}
    </div>
  );
}

function PlaceForm({ initial, settings, initialLink, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [cuisine, setCuisine] = useState(initial?.cuisine || "japanese");
  const [tier, setTier] = useState(initial?.tier || "close");
  const [source, setSource] = useState(initial?.source || "Instagram");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [address, setAddress] = useState(initial?.address || "");
  const [phone, setPhone] = useState(initial?.phone || "");
  const [coords, setCoords] = useState(
    initial?.lat != null ? { lat: initial.lat, lng: initial.lng, googleId: initial.googleId || null } : null
  );
  const [coordText, setCoordText] = useState(initial?.lat != null ? `${initial.lat}, ${initial.lng}` : "");
  const [hint, setHint] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);

  const homeSet = settings?.homeLat != null;

  const applyCoords = (lat, lng, googleId, placeName) => {
    setCoords({ lat, lng, googleId: googleId || null });
    setCoordText(`${lat}, ${lng}`);
    if (placeName && !name.trim()) setName(placeName);
    if (homeSet) {
      const mi = haversineMiles(settings.homeLat, settings.homeLng, lat, lng);
      const t = mi <= settings.thresholdMiles ? "close" : "far";
      setTier(t);
      setHint({ type: "ok", text: `Found ${placeName || "the place"} · ${mi.toFixed(1)} mi from home → tagged ${t === "close" ? "Close" : "Worth the trip"}.` });
    } else {
      setHint({ type: "ok", text: `Found ${placeName || "the place"}. Set your home in Settings to auto-tag close vs. far.` });
    }
  };

  const handleLink = async (value) => {
    setUrl(value);
    const v = value.trim();
    if (!v) { setHint(null); setCoords(null); return; }

    if (isShortMapsLink(v)) {
      setResolving(true);
      setHint({ type: "ok", text: "Resolving the short link…" });
      try {
        const r = await resolveShortLink(v);
        if (r.lat != null) {
          applyCoords(r.lat, r.lng, r.googleId, r.name);
          if (r.address && !address.trim()) setAddress(r.address);
          if (r.phone && !phone.trim()) setPhone(r.phone);
        } else if (r.name) {
          if (!name.trim()) setName(r.name);
          setHint({ type: "ok", text: `Found ${r.name}. No coordinates in the link — pick the distance below.` });
        } else {
          setHint({ type: "short", text: "Couldn't read that short link. Open it in Maps and paste the full link, or type the name below." });
        }
      } catch {
        setHint({ type: "short", text: "Resolver unavailable (it runs once deployed). For now, open the link in Maps and paste the full URL, or type the name below." });
      } finally {
        setResolving(false);
      }
      return;
    }

    const parsed = parseMapsUrl(v);
    if (!parsed) { setHint(null); return; } // ordinary social link, keep as URL
    if (parsed.lat != null) applyCoords(parsed.lat, parsed.lng, parsed.googleId, parsed.name);
    else { if (parsed.name && !name.trim()) setName(parsed.name); setHint({ type: "ok", text: `Found ${parsed.name}. No coordinates — pick the distance below.` }); }
  };

  // Auto-process a link shared into the app
  const ranInitial = useRef(false);
  useEffect(() => {
    if (initialLink && !ranInitial.current) { ranInitial.current = true; handleLink(initialLink); }
  }, [initialLink]);

  const onCoordChange = (value) => {
    setCoordText(value);
    const m = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (m) setCoords((c) => ({ lat: parseFloat(m[1]), lng: parseFloat(m[2]), googleId: c?.googleId ?? null }));
    else if (!value.trim()) setCoords(null);
  };

  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(), url: url.trim(), cuisine, tier, source, notes: notes.trim(),
        address: address.trim(), phone: phone.trim(),
        lat: coords?.lat ?? null, lng: coords?.lng ?? null, googleId: coords?.googleId ?? null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wt-modal" onClick={onClose}>
      <div className="wt-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="wt-sheet-head">
          <h3>{initial ? "Edit place" : "Add a place"}</h3>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <label className="wt-field">
          <span>Paste a link <em>(a Google Maps link auto-fills the rest)</em></span>
          <input autoFocus value={url} onChange={(e) => handleLink(e.target.value)} placeholder="Maps, IG, Threads, Little Red Note…" />
        </label>
        {hint && (
          <p className={`wt-mapshint ${hint.type}`}>
            {resolving ? <Loader2 size={14} className="wt-spin" /> : hint.type === "ok" ? <Sparkles size={14} /> : <MapPin size={14} />}
            <span>{hint.text}</span>
          </p>
        )}

        <label className="wt-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="What's it called?" />
        </label>

        <label className="wt-field">
          <span>Address</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="212-08 41st Ave, Bayside, NY 11361" />
        </label>

        <label className="wt-field">
          <span>Coordinates <em>(lat, lng — auto-filled from a Maps link)</em></span>
          <input value={coordText} onChange={(e) => onCoordChange(e.target.value)} placeholder="40.763310, -73.772691" inputMode="decimal" />
        </label>

        <label className="wt-field">
          <span>Telephone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(718) 819-8516" inputMode="tel" />
        </label>

        <div className="wt-field">
          <span>Cuisine</span>
          <div className="wt-chips tight">
            {CUISINES.map((c) => (
              <button key={c.id} type="button" className={`wt-chip ${cuisine === c.id ? "on" : ""}`} onClick={() => setCuisine(c.id)}
                style={cuisine === c.id ? { borderColor: c.color, color: c.color } : undefined}>
                <span className="dot" style={{ background: c.color }} />{c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="wt-field">
          <span>How far{coords && homeSet ? <em> · auto-set from the link</em> : null}</span>
          <div className="wt-toggle">
            <button type="button" className={tier === "close" ? "on" : ""} onClick={() => setTier("close")}>Close — good for Saturday</button>
            <button type="button" className={tier === "far" ? "on" : ""} onClick={() => setTier("far")}>Worth the trip — Sunday</button>
          </div>
        </div>

        <label className="wt-field">
          <span>Where you found it</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>

        <label className="wt-field">
          <span>Notes</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Get the laksa, book ahead…" />
        </label>

        <div className="wt-sheet-actions">
          <button className="wt-btn ghost" onClick={onClose}>Cancel</button>
          <button className="wt-btn primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : initial ? "Save changes" : "Add place"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsSheet({ settings, onChange, onClose }) {
  const [homeUrl, setHomeUrl] = useState("");
  const [hint, setHint] = useState(null);
  const [resolving, setResolving] = useState(false);

  const setHome = (lat, lng, label) => {
    onChange({ homeLat: lat, homeLng: lng, homeLabel: label || "Home" });
    setHint({ type: "ok", text: `Home set${label ? ` near ${label}` : ""}. Distances now use this point.` });
  };

  const handleHome = async (value) => {
    setHomeUrl(value);
    const v = value.trim();
    if (!v) { setHint(null); return; }
    if (isShortMapsLink(v)) {
      setResolving(true);
      setHint({ type: "ok", text: "Resolving the short link…" });
      try {
        const r = await resolveShortLink(v);
        if (r.lat != null) setHome(r.lat, r.lng, r.name);
        else setHint({ type: "short", text: "Couldn't read that link — paste the full Maps link." });
      } catch {
        setHint({ type: "short", text: "Resolver unavailable (it runs once deployed). Paste the full Maps link instead." });
      } finally { setResolving(false); }
      return;
    }
    const parsed = parseMapsUrl(v);
    if (parsed && parsed.lat != null) setHome(parsed.lat, parsed.lng, parsed.name);
    else setHint({ type: "short", text: "Couldn't find coordinates in that link." });
  };

  return (
    <div className="wt-modal" onClick={onClose}>
      <div className="wt-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="wt-sheet-head">
          <h3>Settings</h3>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="wt-field">
          <span>Home base</span>
          {settings.homeLat != null ? (
            <div className="wt-home-set">
              <Home size={15} />
              <span className="wt-home-label">{settings.homeLabel || "Home"} · {settings.homeLat.toFixed(4)}, {settings.homeLng.toFixed(4)}</span>
              <button onClick={() => { onChange({ homeLat: null, homeLng: null, homeLabel: "" }); setHomeUrl(""); setHint(null); }}>Clear</button>
            </div>
          ) : (
            <p className="wt-field-help">Paste a Google Maps link to your home so the app can tell close from far, and auto-tag new places.</p>
          )}
          <input value={homeUrl} onChange={(e) => handleHome(e.target.value)} placeholder="Paste your home's Maps link" />
          {hint && (
            <p className={`wt-mapshint ${hint.type}`}>
              {resolving ? <Loader2 size={14} className="wt-spin" /> : hint.type === "ok" ? <Sparkles size={14} /> : <MapPin size={14} />}
              <span>{hint.text}</span>
            </p>
          )}
        </div>

        <div className="wt-field">
          <span>“Close” means within {settings.thresholdMiles} mi</span>
          <input type="range" min="1" max="20" step="1" value={settings.thresholdMiles}
            onChange={(e) => onChange({ thresholdMiles: parseInt(e.target.value, 10) })} className="wt-range" />
          <p className="wt-field-help">Saturday picks stay inside this radius. Anything farther becomes a Sunday “worth the trip” spot.</p>
        </div>

        <div className="wt-sheet-actions">
          <button className="wt-btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
