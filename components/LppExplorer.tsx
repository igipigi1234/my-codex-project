"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { NetworkData, RoutingData, Stop } from "@/lib/types";

const TIMES = [15, 30, 45] as const;
type Home = { name: string; lat: number; lon: number };
type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: { name?: string; street?: string; housenumber?: string; city?: string; postcode?: string } };

export default function LppExplorer() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const homeMarker = useRef<Marker | null>(null);
  const [data, setData] = useState<NetworkData | null>(null);
  const [routing, setRouting] = useState<RoutingData | null>(null);
  const [reachableCount, setReachableCount] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Home[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [minutes, setMinutes] = useState<(typeof TIMES)[number]>(30);
  const [home, setHome] = useState<Home | null>(null);

  useEffect(() => {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    Promise.all([
      fetch(`${basePath}/data/lpp-network.json`).then(r => r.json()),
      fetch(`${basePath}/data/lpp-routing.json`).then(r => r.json()),
    ]).then(([network, graph]) => { setData(network); setRouting(graph); });
  }, []);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "osm", type: "raster", source: "osm" }] },
      center: [14.5058, 46.0569], zoom: 11.5, attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.on("click", e => {
      const layers = ["stops", "clusters"].filter(id => map.getLayer(id));
      if (layers.length && map.queryRenderedFeatures(e.point, { layers }).length) return;
      chooseHome({ name: "Izbrana točka na zemljevidu", lon: e.lngLat.lng, lat: e.lngLat.lat });
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const addStops = () => {
      if (map.getSource("stops")) return;
      map.addSource("stops", { type: "geojson", data: toGeoJson(data.stops), cluster: true, clusterMaxZoom: 14, clusterRadius: 38 });
      map.addLayer({ id: "clusters", type: "circle", source: "stops", filter: ["has", "point_count"], paint: { "circle-color": "#25d88a", "circle-radius": ["step", ["get", "point_count"], 16, 20, 20, 80, 25], "circle-stroke-color": "#08221a", "circle-stroke-width": 2 } });
      map.addLayer({ id: "cluster-count", type: "symbol", source: "stops", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#08221a" } });
      map.addLayer({ id: "stops", type: "circle", source: "stops", filter: ["!", ["has", "point_count"]], paint: { "circle-color": "#fff", "circle-radius": 6, "circle-stroke-color": "#00a968", "circle-stroke-width": 3 } });
      map.on("click", "stops", e => { const f = e.features?.[0]; if (f) new maplibregl.Popup({ offset: 10 }).setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setText(f.properties?.name ?? "Postajališče LPP").addTo(map); });
      map.on("click", "clusters", async e => { const feature = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0]; const source = map.getSource("stops") as GeoJSONSource; const zoom = await source.getClusterExpansionZoom(Number(feature.properties?.cluster_id)); map.easeTo({ center: (feature.geometry as GeoJSON.Point).coordinates as [number, number], zoom }); });
    };
    map.loaded() ? addStops() : map.once("load", addStops);
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || !routing || !home) { setReachableCount(0); return; }
    const times = calculateReach(data.stops, routing, home, minutes * 60);
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
    times.forEach((time, index) => { if (Number.isFinite(time) && time <= minutes * 60) features.push({ type: "Feature", geometry: { type: "Point", coordinates: [data.stops[index].lon, data.stops[index].lat] }, properties: { time: Math.round(time / 60), name: data.stops[index].name } }); });
    setReachableCount(features.length);
    const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: "FeatureCollection", features };
    const draw = () => {
      const source = map.getSource("reachable") as GeoJSONSource | undefined;
      if (source) source.setData(geojson);
      else {
        map.addSource("reachable", { type: "geojson", data: geojson });
        map.addLayer({ id: "reach-heat", type: "heatmap", source: "reachable", paint: { "heatmap-weight": ["interpolate", ["linear"], ["get", "time"], 0, 1, minutes, 0.25], "heatmap-intensity": 1.15, "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 28, 15, 55], "heatmap-opacity": 0.5, "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(37,216,138,0)", 0.3, "rgba(37,216,138,.35)", 0.65, "rgba(0,169,104,.55)", 1, "rgba(8,34,26,.7)"] } });
        map.addLayer({ id: "reach-points", type: "circle", source: "reachable", paint: { "circle-radius": 8, "circle-color": ["interpolate", ["linear"], ["get", "time"], 0, "#08221a", minutes, "#25d88a"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      }
    };
    map.loaded() ? draw() : map.once("load", draw);
  }, [data, routing, home, minutes]);

  useEffect(() => {
    if (home || query.trim().length < 3) { setResults([]); setSearchMessage(""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchMessage("");
      try {
        const params = new URLSearchParams({ q: `${query}, Ljubljana, Slovenia`, limit: "6", lat: "46.0569", lon: "14.5058", bbox: "13.9,45.7,15.1,46.4" });
        const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Geocoding failed: ${response.status}`);
        const json = await response.json() as { features: PhotonFeature[] };
        const places = json.features.map(toHome).filter(place => place.name);
        setResults(places);
        setSearchMessage(places.length ? "" : "Naslova nisem našel. Poskusi brez šumnikov ali dodaj poštno številko.");
      } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) { setResults([]); setSearchMessage("Iskanje naslovov trenutno ni dosegljivo. Poskusi znova čez trenutek."); } }
      finally { setSearching(false); }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, home]);

  const nearest = useMemo(() => home && data ? [...data.stops].sort((a, b) => distance(home, a) - distance(home, b)).slice(0, 3) : [], [home, data]);

  function chooseHome(place: Home) {
    setHome(place); setQuery(place.name); setResults([]); homeMarker.current?.remove();
    if (mapRef.current) homeMarker.current = new maplibregl.Marker({ color: "#08221a" }).setLngLat([place.lon, place.lat]).setPopup(new maplibregl.Popup({ offset: 25 }).setText("Tvoj začetni naslov")).addTo(mapRef.current);
    mapRef.current?.flyTo({ center: [place.lon, place.lat], zoom: 15 });
  }

  return <main>
    <section className="panel">
      <div className="brand"><span className="brandMark">D</span><div><strong>Doseg Ljubljana</strong><small>Javni prevoz na enem zemljevidu</small></div></div>
      <h1>Kako daleč prideš<br />z LPP?</h1>
      <p className="lead">Vpiši naslov bivanja ali klikni zemljevid. Doseg temelji na uradnem voznem redu LPP.</p>
      <label className="searchLabel">Naslov bivanja</label>
      <div className="search"><span>⌕</span><input value={query} onChange={e => { setQuery(e.target.value); setHome(null); setSearchMessage(""); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setQuery(value => `${value.trim()} `); } }} placeholder="npr. Slovenska cesta 1" autoComplete="street-address" /></div>
      {searching && <p className="searchHint">Iščem naslov …</p>}
      {!searching && searchMessage && <p className="searchHint">{searchMessage}</p>}
      {results.length > 0 && <div className="results">{results.map((place, i) => <button key={`${place.lon}-${place.lat}-${i}`} onClick={() => chooseHome(place)}>{place.name}</button>)}</div>}
      <label className="searchLabel timeLabel">Čas poti</label>
      <div className="timeButtons">{TIMES.map(t => <button className={minutes === t ? "active" : ""} key={t} onClick={() => setMinutes(t)}>{t}<small> min</small></button>)}</div>
      <div className="status"><span className="statusDot" /><div><strong>{home ? `${reachableCount} dosegljivih postajališč` : "Vpiši naslov ali klikni zemljevid"}</strong><p>{home ? `Načrtovani doseg v ${minutes} minutah. Najbližje: ${nearest.map(s => s.name).join(", ")}.` : "Izračun vključuje hojo, vožnjo in prestope po voznem redu."}</p></div></div>
      <div className="facts"><span><strong>{data?.stops.length ?? "…"}</strong> postajališč</span><span><strong>{data?.routes.length ?? "…"}</strong> linij</span></div>
      <p className="source">Načrtovani časi brez zamud v živo · LPP GTFS · OpenStreetMap</p>
    </section>
    <section className="mapWrap"><div ref={mapNode} className="map" /><div className="beta">MVP · dejanski podatki LPP</div></section>
  </main>;
}

function toHome(feature: PhotonFeature): Home { const p = feature.properties; const street = [p.street ?? p.name, p.housenumber].filter(Boolean).join(" "); return { name: [street, p.postcode, p.city].filter(Boolean).join(", "), lon: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] }; }
function distance(a: Home, b: Stop) { const x = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180); const y = b.lat - a.lat; return x * x + y * y; }
function toGeoJson(stops: Stop[]): GeoJSON.FeatureCollection<GeoJSON.Point> { return { type: "FeatureCollection", features: stops.map(s => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: s })) }; }

function meters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) { const lat = ((a.lat + b.lat) / 2) * Math.PI / 180; const x = (b.lon - a.lon) * 111320 * Math.cos(lat); const y = (b.lat - a.lat) * 110540; return Math.hypot(x, y); }

function calculateReach(stops: Stop[], routing: RoutingData, home: Home, limit: number) {
  const routeStates = routing.routeIds.length + 1, size = stops.length * routeStates;
  const best = new Float64Array(size); best.fill(Infinity); const result = new Float64Array(stops.length); result.fill(Infinity);
  const walking = stops.map(() => [] as Array<[number, number]>);
  for (let a = 0; a < stops.length; a++) for (let b = a + 1; b < stops.length; b++) { const d = meters(stops[a], stops[b]); if (d <= 320) { const t = d / 1.3 + 25; walking[a].push([b, t]); walking[b].push([a, t]); } }
  const heap: Array<[number, number, number]> = [];
  const push = (item: [number, number, number]) => { heap.push(item); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= item[0]) break; heap[i] = heap[p]; i = p; } heap[i] = item; };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= last[0]) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return top; };
  stops.forEach((stop, node) => { const d = meters(home, stop); if (d <= 1300) { const time = d / 1.3; const state = node * routeStates; best[state] = time; push([time, node, -1]); } });
  while (heap.length) {
    const [time, node, route] = pop(); const state = node * routeStates + route + 1; if (time !== best[state] || time > limit) continue; result[node] = Math.min(result[node], time);
    for (const [to, ride, nextRoute] of routing.edges[node]) { const next = time + ride + (route === nextRoute ? 0 : 240); const s = to * routeStates + nextRoute + 1; if (next < best[s] && next <= limit) { best[s] = next; push([next, to, nextRoute]); } }
    for (const [to, walk] of walking[node]) { const next = time + walk, s = to * routeStates; if (next < best[s] && next <= limit) { best[s] = next; push([next, to, -1]); } }
  }
  return result;
}
