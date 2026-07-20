"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { DayProfile, NetworkData, Route, ScheduleData, Stop } from "@/lib/types";

type Location = { name: string; lat: number; lon: number };
type Mode = "reach" | "route" | "lines";
type Target = "start" | "end";
type DayKind = "weekday" | "saturday" | "sunday";
type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: { name?: string; street?: string; housenumber?: string; city?: string; postcode?: string } };
type Pred = { kind: "access" | "walk" | "ride"; from: number; trip?: number; route?: number; dep?: number; arr?: number } | null;
type JourneyStep = { kind: "walk" | "ride"; from?: number; to: number; trip?: number; route?: number; dep?: number; arr?: number; minutes: number };
type Journey = { arrival: number; duration: number; steps: JourneyStep[]; destinationStop: number };

const TIMES = [15, 30, 45] as const;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export default function LppExplorer() {
  const mapNode = useRef<HTMLDivElement>(null), mapRef = useRef<MapLibreMap | null>(null);
  const startMarker = useRef<Marker | null>(null), endMarker = useRef<Marker | null>(null);
  const [network, setNetwork] = useState<NetworkData | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [mode, setMode] = useState<Mode>("reach");
  const [target, setTarget] = useState<Target>("start");
  const [start, setStart] = useState<Location | null>(null), [end, setEnd] = useState<Location | null>(null);
  const [startQuery, setStartQuery] = useState(""), [endQuery, setEndQuery] = useState("");
  const [results, setResults] = useState<Location[]>([]), [searching, setSearching] = useState(false), [searchMessage, setSearchMessage] = useState("");
  const [minutes, setMinutes] = useState<(typeof TIMES)[number]>(30), [time, setTime] = useState("08:00"), [dayKind, setDayKind] = useState<DayKind>("weekday");
  const [reachTimes, setReachTimes] = useState<Float64Array | null>(null), [journey, setJourney] = useState<Journey | null>(null);
  const [selectedRoute, setSelectedRoute] = useState(0), [direction, setDirection] = useState(0);
  const [selectedLineStop, setSelectedLineStop] = useState<number | null>(null);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    Promise.all([fetch(`${base}/data/lpp-network.json`).then(r => r.json()), loadSchedule(`${base}/data/lpp-schedule.json.gz.b64`)]).then(([n, s]) => { setNetwork(n); setSchedule(s); });
  }, []);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: mapNode.current, style: { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "osm", type: "raster", source: "osm" }] }, center: [14.5058, 46.0569], zoom: 11.4, attributionControl: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right"); map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left"); mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map || !network) return;
    const draw = () => {
      if (map.getSource("stops")) return;
      map.addSource("stops", { type: "geojson", data: stopGeoJson(network.stops), cluster: true, clusterMaxZoom: 14, clusterRadius: 38 });
      map.addLayer({ id: "clusters", type: "circle", source: "stops", filter: ["has", "point_count"], paint: { "circle-color": "#25d88a", "circle-radius": ["step", ["get", "point_count"], 15, 20, 19, 80, 23], "circle-stroke-color": "#08221a", "circle-stroke-width": 2 } });
      map.addLayer({ id: "cluster-count", type: "symbol", source: "stops", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11 }, paint: { "text-color": "#08221a" } });
      map.addLayer({ id: "stops", type: "circle", source: "stops", filter: ["!", ["has", "point_count"]], paint: { "circle-color": "#fff", "circle-radius": 5, "circle-stroke-color": "#00a968", "circle-stroke-width": 2 } });
      ensureOverlayLayers(map);
      map.on("click", "stops", e => { const f = e.features?.[0]; if (f) new maplibregl.Popup({ offset: 10 }).setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setText(f.properties?.name ?? "Postajališče LPP").addTo(map); });
      map.on("click", "clusters", async e => { const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0]; const source = map.getSource("stops") as GeoJSONSource; map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: await source.getClusterExpansionZoom(Number(f.properties?.cluster_id)) }); });
    };
    map.loaded() ? draw() : map.once("load", draw);
  }, [network]);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const click = (e: maplibregl.MapMouseEvent) => { if (mode === "lines") return; const layers = ["stops", "clusters"].filter(id => map.getLayer(id)); if (layers.length && map.queryRenderedFeatures(e.point, { layers }).length) return; place(target, { name: "Izbrana točka", lat: e.lngLat.lat, lon: e.lngLat.lng }); };
    map.on("click", click); return () => { map.off("click", click); };
  }, [target, mode]);

  const activeQuery = target === "start" ? startQuery : endQuery;
  useEffect(() => {
    if (activeQuery.trim().length < 3) { setResults([]); setSearchMessage(""); return; }
    const controller = new AbortController(); const timer = window.setTimeout(async () => {
      setSearching(true); setSearchMessage("");
      try { const p = new URLSearchParams({ q: `${activeQuery}, Ljubljana, Slovenia`, limit: "6", lat: "46.0569", lon: "14.5058", bbox: "13.9,45.7,15.1,46.4" }); const response = await fetch(`https://photon.komoot.io/api/?${p}`, { signal: controller.signal }); if (!response.ok) throw new Error(); const json = await response.json() as { features: PhotonFeature[] }; const places = json.features.map(toLocation).filter(x => x.name); setResults(places); if (!places.length) setSearchMessage("Ni zadetkov. Naslov izberi s klikom na zemljevid."); }
      catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) setSearchMessage("Iskanje ni dosegljivo. Lokacijo izberi na zemljevidu."); } finally { setSearching(false); }
    }, 400); return () => { clearTimeout(timer); controller.abort(); };
  }, [activeQuery, target]);

  const profile = schedule?.profiles[dayKind]; const departure = parseTime(time);
  useEffect(() => {
    if (!network || !profile || !start || mode !== "reach") { setReachTimes(null); return; }
    setReachTimes(runCsa(network.stops, profile, start, departure, minutes * 60).earliest);
  }, [network, profile, start, departure, minutes, mode]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !network || !schedule) return;
    const render = () => {
      ensureOverlayLayers(map); toggleStops(map, mode === "lines" || (mode === "reach" && !start));
      for (const id of ["plan", "line-view", "transfer-lines", "selected-stop", "reachable", "reach-lines"]) setSource(map, id, EMPTY);
      if (mode === "reach" && reachTimes && profile) {
        const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
        reachTimes.forEach((arrival, i) => { if (Number.isFinite(arrival) && arrival - departure <= minutes * 60) features.push({ type: "Feature", geometry: { type: "Point", coordinates: [network.stops[i].lon, network.stops[i].lat] }, properties: { time: Math.round((arrival - departure) / 60), name: network.stops[i].name } }); });
        setSource(map, "reachable", { type: "FeatureCollection", features }); setSource(map, "reach-lines", reachableConnectionFeatures(profile, reachTimes, departure, minutes * 60, network));
      }
      if (mode === "lines") {
        const patterns = profile?.patterns.filter(p => p[0] === selectedRoute) ?? [], chosen = patterns[direction] ? [patterns[direction]] : patterns.slice(0, 1); setSource(map, "line-view", shapeFeatures(schedule, network.routes, chosen));
        if (selectedLineStop !== null) { const s = network.stops[selectedLineStop]; setSource(map, "selected-stop", { type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: { name: s.name } }); const transferPatterns = profile?.patterns.filter(p => transferRoutes.includes(p[0])) ?? []; setSource(map, "transfer-lines", shapeFeatures(schedule, network.routes, transferPatterns)); }
      }
    };
    map.isStyleLoaded() ? render() : map.once("load", render);
  }, [mode, reachTimes, network, schedule, profile, departure, minutes, start, selectedRoute, direction, selectedLineStop]);

  function place(which: Target, location: Location) {
    const map = mapRef.current; setResults([]); setSearchMessage("");
    if (which === "start") { setStart(location); setStartQuery(location.name); startMarker.current?.remove(); if (map) startMarker.current = marker("A", "#08221a").setLngLat([location.lon, location.lat]).addTo(map); if (mode === "route") setTarget("end"); }
    else { setEnd(location); setEndQuery(location.name); endMarker.current?.remove(); if (map) endMarker.current = marker("B", "#d97706").setLngLat([location.lon, location.lat]).addTo(map); }
    map?.flyTo({ center: [location.lon, location.lat], zoom: 14 });
  }

  function findJourney() {
    if (!network || !profile || !start || !end) return; const result = planJourney(network.stops, profile, start, end, departure); setJourney(result);
    if (result && schedule && mapRef.current) { const map = mapRef.current, features = journeyFeatures(result, start, end, network, schedule, profile); ensureOverlayLayers(map); setSource(map, "plan", features); fitFeatures(map, features, 70); }
  }

  const reachable = useMemo(() => reachTimes && network ? network.stops.map((stop, i) => ({ stop, time: reachTimes[i] - departure })).filter(x => Number.isFinite(x.time) && x.time <= minutes * 60).sort((a, b) => b.time - a.time) : [], [reachTimes, network, departure, minutes]);
  const linePatterns = profile?.patterns.filter(p => p[0] === selectedRoute) ?? [], activePattern = linePatterns[direction] ?? linePatterns[0];
  const transferRoutes = useMemo(() => { if (!network || !profile || selectedLineStop === null) return [] as number[]; const selected = network.stops[selectedLineStop], found = new Set<number>(); for (const p of profile.patterns) if (p[0] !== selectedRoute && p[3].some(i => meters(selected, network.stops[i]) <= 140)) found.add(p[0]); return [...found].sort((a, b) => network.routes[a].shortName.localeCompare(network.routes[b].shortName, undefined, { numeric: true })); }, [network, profile, selectedLineStop, selectedRoute]);

  useEffect(() => { if (mode !== "lines" || !network || !schedule || !activePattern || !mapRef.current) return; const features = shapeFeatures(schedule, network.routes, [activePattern]); const map = mapRef.current; const show = () => { ensureOverlayLayers(map); setSource(map, "line-view", features); fitFeatures(map, features, 55); }; map.isStyleLoaded() ? show() : map.once("load", show); }, [mode, network, schedule, selectedRoute, direction]);

  function chooseLineStop(stopIndex: number) { if (!network || !mapRef.current) return; setSelectedLineStop(stopIndex); const stop = network.stops[stopIndex]; mapRef.current.flyTo({ center: [stop.lon, stop.lat], zoom: 16 }); new maplibregl.Popup({ offset: 18 }).setLngLat([stop.lon, stop.lat]).setHTML(`<strong>${stop.name}</strong>`).addTo(mapRef.current); }

  return <main>
    <section className="panel appPanel">
      <div className="brand"><span className="brandMark">D</span><div><strong>Doseg Ljubljana</strong><small>Po voznem redu LPP</small></div></div>
      <nav className="tabs"><button className={mode === "reach" ? "active" : ""} onClick={() => { setMode("reach"); setTarget("start"); }}>Doseg</button><button className={mode === "route" ? "active" : ""} onClick={() => { setMode("route"); setTarget(start ? "end" : "start"); }}>Pot A–B</button><button className={mode === "lines" ? "active" : ""} onClick={() => setMode("lines")}>Linije</button></nav>

      {mode !== "lines" && <>
        <h1>{mode === "reach" ? "Kam lahko prideš?" : "Načrtuj pot"}</h1>
        <LocationInput label="Začetek" badge="A" value={startQuery} active={target === "start"} onFocus={() => setTarget("start")} onChange={value => { setStartQuery(value); setStart(null); }} placeholder="Naslov ali klik na zemljevid" />
        {mode === "route" && <LocationInput label="Cilj" badge="B" value={endQuery} active={target === "end"} onFocus={() => setTarget("end")} onChange={value => { setEndQuery(value); setEnd(null); }} placeholder="Kam želiš?" />}
        {(searching || searchMessage || results.length > 0) && <div className="searchResults">{searching && <p>Iščem …</p>}{searchMessage && <p>{searchMessage}</p>}{results.map((r, i) => <button key={`${r.lon}-${r.lat}-${i}`} onClick={() => place(target, r)}>{r.name}</button>)}</div>}
        <div className="controls"><label>Odhod<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label><label>Dan<select value={dayKind} onChange={e => setDayKind(e.target.value as DayKind)}><option value="weekday">Delavnik</option><option value="saturday">Sobota</option><option value="sunday">Nedelja</option></select></label></div>
      </>}

      {mode === "reach" && <>
        <div className="timeButtons">{TIMES.map(t => <button className={minutes === t ? "active" : ""} key={t} onClick={() => setMinutes(t)}>{t}<small> min</small></button>)}</div>
        <div className="legend"><span><i className="l15" />do 15 min</span><span><i className="l30" />15–30</span><span><i className="l45" />30–45</span></div>
        <div className="summary"><strong>{start ? `${reachable.length} dosegljivih postajališč` : "Izberi začetno lokacijo"}</strong><p>{start ? `Odhod ob ${time}, ${dayLabel(dayKind).toLowerCase()}.` : "Vpiši naslov ali klikni zemljevid."}</p></div>
        {reachable.length > 0 && <div className="destinationList"><h3>Najdlje dosegljivo</h3>{reachable.slice(0, 5).map(x => <button key={x.stop.id} onClick={() => mapRef.current?.flyTo({ center: [x.stop.lon, x.stop.lat], zoom: 14 })}><span>{x.stop.name}</span><strong>{Math.round(x.time / 60)} min</strong></button>)}</div>}
      </>}

      {mode === "route" && <>
        <button className="primary" disabled={!start || !end} onClick={findJourney}>Poišči povezave</button>
        {journey ? <JourneyCard journey={journey} network={network!} profile={profile!} /> : <div className="emptyCard">Izberi A in B. Lokaciji lahko določiš tudi zaporednima klikoma na zemljevid.</div>}
      </>}

      {mode === "lines" && network && <>
        <h1>Linije LPP</h1><label className="fieldLabel">Izberi linijo<select className="lineSelect" value={selectedRoute} onChange={e => { setSelectedRoute(Number(e.target.value)); setDirection(0); }}>{network.routes.map((r, i) => <option value={i} key={r.id}>Linija {r.shortName}</option>)}</select></label>
        <div className="directionButtons">{linePatterns.map((p, i) => <button className={direction === i ? "active" : ""} key={`${p[1]}-${i}`} onClick={() => { setDirection(i); setSelectedLineStop(null); }}>{p[1] || `Smer ${i + 1}`}</button>)}</div>
        {selectedLineStop !== null && <div className="transferCard"><strong>{network.stops[selectedLineStop].name}</strong><small>Prestopi na druge linije</small>{transferRoutes.length ? <div>{transferRoutes.map(r => <button key={r} style={{ background: `#${network.routes[r].color}`, color: `#${network.routes[r].textColor}` }} onClick={() => { setSelectedRoute(r); setDirection(0); setSelectedLineStop(null); }}>{network.routes[r].shortName}</button>)}</div> : <p>Na tem postajališču ni drugih linij.</p>}</div>}
        {activePattern && <div className="stopList"><h3>{activePattern[3].length} postajališč</h3>{activePattern[3].map((s, i) => <button className={selectedLineStop === s ? "selected" : ""} key={`${s}-${i}`} onClick={() => chooseLineStop(s)}><i style={{ background: `#${network.routes[selectedRoute].color}` }}>{i + 1}</i>{network.stops[s].name}</button>)}</div>}
      </>}
      <p className="source">Načrtovani časi, brez zamud v živo · LPP GTFS · OpenStreetMap</p>
    </section>
    <section className="mapWrap"><div ref={mapNode} className="map" /><div className="mapHint">{mode === "lines" ? "Izberi postajališče v seznamu" : `Klik na zemljevid izbere ${target === "start" ? "začetek A" : "cilj B"}`}</div></section>
  </main>;
}

function LocationInput({ label, badge, value, active, onFocus, onChange, placeholder }: { label: string; badge: string; value: string; active: boolean; onFocus: () => void; onChange: (v: string) => void; placeholder: string }) { return <label className={`locationField ${active ? "active" : ""}`}><span>{badge}</span><div><small>{label}</small><input value={value} onFocus={onFocus} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></div></label>; }
function JourneyCard({ journey, network, profile }: { journey: Journey; network: NetworkData; profile: DayProfile }) { return <div className="journeyCard"><div className="journeyHead"><div><strong>{Math.round(journey.duration / 60)} min</strong><small>prihod {formatTime(journey.arrival)}</small></div><span>{journey.steps.filter(s => s.kind === "ride").length} odsekov</span></div>{journey.steps.map((s, i) => s.kind === "walk" ? <div className="step walk" key={i}><i>↟</i><p>{i === journey.steps.length - 1 ? "Hoja do cilja" : `Hoja do ${network.stops[s.to].name}`}<small>{s.minutes} min</small></p></div> : <div className="step" key={i}><i style={{ background: `#${network.routes[s.route!].color}`, color: `#${network.routes[s.route!].textColor}` }}>{network.routes[s.route!].shortName}</i><p>{profile.trips[s.trip!][1] || network.stops[s.to].name}<small>{formatTime(s.dep!)}–{formatTime(s.arr!)} · do {network.stops[s.to].name}</small></p></div>)}</div>; }

function marker(letter: string, color: string) { const el = document.createElement("div"); el.className = "letterMarker"; el.textContent = letter; el.style.background = color; return new maplibregl.Marker({ element: el }); }
async function loadSchedule(url: string): Promise<ScheduleData> { const encoded = await fetch(url).then(r => r.text()); const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")); return JSON.parse(await new Response(stream).text()); }
function toLocation(f: PhotonFeature): Location { const p = f.properties, street = [p.street ?? p.name, p.housenumber].filter(Boolean).join(" "); return { name: [street, p.postcode, p.city].filter(Boolean).join(", "), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }; }
function parseTime(value: string) { const [h, m] = value.split(":").map(Number); return h * 3600 + m * 60; }
function formatTime(value: number) { const v = value % 86400; return `${String(Math.floor(v / 3600)).padStart(2, "0")}:${String(Math.floor((v % 3600) / 60)).padStart(2, "0")}`; }
function dayLabel(day: DayKind) { return day === "weekday" ? "Delavnik" : day === "saturday" ? "Sobota" : "Nedelja"; }
function meters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) { const lat = ((a.lat + b.lat) / 2) * Math.PI / 180; return Math.hypot((b.lon - a.lon) * 111320 * Math.cos(lat), (b.lat - a.lat) * 110540); }
function stopGeoJson(stops: Stop[]): GeoJSON.FeatureCollection<GeoJSON.Point> { return { type: "FeatureCollection", features: stops.map(s => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: s })) }; }
function setSource(map: MapLibreMap | null, id: string, data: GeoJSON.GeoJSON) { (map?.getSource(id) as GeoJSONSource | undefined)?.setData(data); }
function ensureOverlayLayers(map: MapLibreMap) {
  for (const id of ["reach-lines", "reachable", "plan", "line-view", "transfer-lines", "selected-stop"]) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY });
  if (!map.getLayer("reach-line-layer")) map.addLayer({ id: "reach-line-layer", type: "line", source: "reach-lines", paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 15, 5], "line-opacity": .78 } });
  if (!map.getLayer("reachable-layer")) map.addLayer({ id: "reachable-layer", type: "circle", source: "reachable", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 15, 8], "circle-color": ["step", ["get", "time"], "#08221a", 15, "#00a968", 30, "#f0b429"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": .95 } });
  if (!map.getLayer("transfer-line-layer")) map.addLayer({ id: "transfer-line-layer", type: "line", source: "transfer-lines", paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": .35, "line-dasharray": [2, 2] } });
  if (!map.getLayer("plan-shadow")) map.addLayer({ id: "plan-shadow", type: "line", source: "plan", paint: { "line-color": "#fff", "line-width": 9, "line-opacity": .92 } });
  if (!map.getLayer("plan-layer")) map.addLayer({ id: "plan-layer", type: "line", source: "plan", paint: { "line-color": ["get", "color"], "line-width": 5 } });
  if (!map.getLayer("line-view-layer")) map.addLayer({ id: "line-view-layer", type: "line", source: "line-view", paint: { "line-color": ["get", "color"], "line-width": 6, "line-opacity": .92 } });
  if (!map.getLayer("selected-stop-layer")) map.addLayer({ id: "selected-stop-layer", type: "circle", source: "selected-stop", paint: { "circle-radius": 11, "circle-color": "#fff", "circle-stroke-color": "#08221a", "circle-stroke-width": 5 } });
}
function toggleStops(map: MapLibreMap, visible: boolean) { for (const id of ["clusters", "cluster-count", "stops"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none"); }
function shapeFeatures(schedule: ScheduleData, routes: Route[], patterns: DayProfile["patterns"]): GeoJSON.FeatureCollection<GeoJSON.LineString> { const seen = new Set<string>(); return { type: "FeatureCollection", features: patterns.flatMap(p => { if (!p[2] || seen.has(p[2]) || !schedule.shapes[p[2]]) return []; seen.add(p[2]); return [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: schedule.shapes[p[2]] }, properties: { color: `#${routes[p[0]].color}` } }]; }) }; }
function reachableConnectionFeatures(profile: DayProfile, earliest: Float64Array, departure: number, limit: number, network: NetworkData): GeoJSON.FeatureCollection<GeoJSON.LineString> { const seen = new Set<string>(), features: GeoJSON.Feature<GeoJSON.LineString>[] = []; for (const [dep, arr, from, to, , route] of profile.connections) { if (dep < departure || arr > departure + limit || !Number.isFinite(earliest[from]) || earliest[from] > dep) continue; const key = `${from}-${to}-${route}`; if (seen.has(key)) continue; seen.add(key); features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[network.stops[from].lon, network.stops[from].lat], [network.stops[to].lon, network.stops[to].lat]] }, properties: { color: `#${network.routes[route].color}` } }); } return { type: "FeatureCollection", features }; }
function fitFeatures(map: MapLibreMap, features: GeoJSON.FeatureCollection<GeoJSON.LineString>, padding: number) { const coords = features.features.flatMap(f => f.geometry.coordinates); if (!coords.length) return; const bounds = coords.reduce((b, c) => b.extend(c as [number, number]), new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number])); map.fitBounds(bounds, { padding, maxZoom: 15, duration: 700 }); }

function walkingGraph(stops: Stop[]) { const graph = stops.map(() => [] as Array<[number, number]>); for (let a = 0; a < stops.length; a++) for (let b = a + 1; b < stops.length; b++) { const d = meters(stops[a], stops[b]); if (d <= 280) { const t = d / 1.3 + 20; graph[a].push([b, t]); graph[b].push([a, t]); } } return graph; }
function runCsa(stops: Stop[], profile: DayProfile, origin: Location, departure: number, limit = 3 * 3600) {
  const earliest = new Float64Array(stops.length); earliest.fill(Infinity); const pred: Pred[] = Array(stops.length).fill(null), walk = walkingGraph(stops), tripReached = new Uint8Array(profile.trips.length);
  stops.forEach((s, i) => { const d = meters(origin, s); if (d <= 1400) { earliest[i] = departure + d / 1.3; pred[i] = { kind: "access", from: -1 }; } });
  const relaxWalk = (from: number) => { for (const [to, duration] of walk[from]) if (earliest[from] + duration < earliest[to]) { earliest[to] = earliest[from] + duration; pred[to] = { kind: "walk", from }; } };
  earliest.forEach((v, i) => { if (Number.isFinite(v)) relaxWalk(i); });
  for (const [dep, arr, from, to, trip, route] of profile.connections) { if (dep < departure || dep > departure + limit) continue; if (!tripReached[trip] && earliest[from] + 75 > dep) continue; tripReached[trip] = 1; if (arr < earliest[to]) { earliest[to] = arr; pred[to] = { kind: "ride", from, trip, route, dep, arr }; relaxWalk(to); } }
  return { earliest, pred };
}
function planJourney(stops: Stop[], profile: DayProfile, origin: Location, destination: Location, departure: number): Journey | null {
  const { earliest, pred } = runCsa(stops, profile, origin, departure, 5 * 3600); let best = Infinity, destinationStop = -1;
  stops.forEach((s, i) => { const d = meters(destination, s); if (d <= 1800 && earliest[i] + d / 1.3 < best) { best = earliest[i] + d / 1.3; destinationStop = i; } }); if (destinationStop < 0) return null;
  const reversed: JourneyStep[] = [{ kind: "walk", from: destinationStop, to: destinationStop, minutes: Math.max(1, Math.round(meters(destination, stops[destinationStop]) / 1.3 / 60)) }]; let node = destinationStop, guard = 0;
  while (pred[node] && guard++ < 200) { const p = pred[node]!; if (p.kind === "access") { reversed.push({ kind: "walk", to: node, minutes: Math.max(1, Math.round((earliest[node] - departure) / 60)) }); break; } reversed.push({ kind: p.kind, from: p.from, to: node, trip: p.trip, route: p.route, dep: p.dep, arr: p.arr, minutes: Math.max(1, Math.round(((p.arr ?? earliest[node]) - (p.dep ?? earliest[p.from])) / 60)) }); node = p.from; }
  const raw = reversed.reverse(), steps: JourneyStep[] = [];
  for (const s of raw) { const last = steps.at(-1); if (s.kind === "ride" && last?.kind === "ride" && last.trip === s.trip) { last.to = s.to; last.arr = s.arr; last.minutes = Math.round(((last.arr ?? 0) - (last.dep ?? 0)) / 60); } else if (!(s.kind === "walk" && s.minutes === 0)) steps.push({ ...s }); }
  return { arrival: best, duration: best - departure, steps, destinationStop };
}
function journeyFeatures(journey: Journey, start: Location, end: Location, network: NetworkData, schedule: ScheduleData, profile: DayProfile): GeoJSON.FeatureCollection<GeoJSON.LineString> { const features: GeoJSON.Feature<GeoJSON.LineString>[] = []; let previous: [number, number] = [start.lon, start.lat]; for (const step of journey.steps) { const stop = network.stops[step.to], to: [number, number] = [stop.lon, stop.lat]; if (step.kind === "ride" && step.trip !== undefined && step.from !== undefined) { const shape = schedule.shapes[profile.trips[step.trip][2]], fromStop = network.stops[step.from]; if (shape) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: sliceShape(shape, [fromStop.lon, fromStop.lat], to) }, properties: { color: `#${network.routes[step.route!].color}` } }); } else features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [previous, to] }, properties: { color: "#66756f" } }); previous = to; } features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [previous, [end.lon, end.lat]] }, properties: { color: "#66756f" } }); return { type: "FeatureCollection", features }; }
function sliceShape(shape: Array<[number, number]>, from: [number, number], to: [number, number]) { const nearest = (point: [number, number]) => { let best = 0, value = Infinity; shape.forEach((p, i) => { const d = (p[0] - point[0]) ** 2 + (p[1] - point[1]) ** 2; if (d < value) { value = d; best = i; } }); return best; }; const a = nearest(from), b = nearest(to); const part = a <= b ? shape.slice(a, b + 1) : shape.slice(b, a + 1).reverse(); return part.length >= 2 ? part : [from, to]; }
