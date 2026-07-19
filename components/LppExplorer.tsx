"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { NetworkData, Stop } from "@/lib/types";

const TIMES = [15, 30, 45] as const;
type Home = { name: string; lat: number; lon: number };
type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: { name?: string; street?: string; housenumber?: string; city?: string; postcode?: string } };

export default function LppExplorer() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const homeMarker = useRef<Marker | null>(null);
  const [data, setData] = useState<NetworkData | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Home[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [minutes, setMinutes] = useState<(typeof TIMES)[number]>(30);
  const [home, setHome] = useState<Home | null>(null);

  useEffect(() => {
    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    fetch(`${basePath}/data/lpp-network.json`).then(r => r.json()).then(setData);
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
      <p className="lead">Vpiši naslov bivanja in izberi čas poti. Na zemljevidu so uradna postajališča LPP.</p>
      <label className="searchLabel">Naslov bivanja</label>
      <div className="search"><span>⌕</span><input value={query} onChange={e => { setQuery(e.target.value); setHome(null); setSearchMessage(""); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setQuery(value => `${value.trim()} `); } }} placeholder="npr. Slovenska cesta 1" autoComplete="street-address" /></div>
      {searching && <p className="searchHint">Iščem naslov …</p>}
      {!searching && searchMessage && <p className="searchHint">{searchMessage}</p>}
      {results.length > 0 && <div className="results">{results.map((place, i) => <button key={`${place.lon}-${place.lat}-${i}`} onClick={() => chooseHome(place)}>{place.name}</button>)}</div>}
      <label className="searchLabel timeLabel">Čas poti</label>
      <div className="timeButtons">{TIMES.map(t => <button className={minutes === t ? "active" : ""} key={t} onClick={() => setMinutes(t)}>{t}<small> min</small></button>)}</div>
      <div className="status"><span className="statusDot" /><div><strong>{home ? "Naslov je izbran" : "Vpiši in izberi naslov"}</strong><p>{home ? `Najbližje: ${nearest.map(s => s.name).join(", ")}. Izračun dosega za ${minutes} minut je naslednji korak.` : "Med zadetki izberi pravi naslov bivanja."}</p></div></div>
      <div className="facts"><span><strong>{data?.stops.length ?? "…"}</strong> postajališč</span><span><strong>{data?.routes.length ?? "…"}</strong> linij</span></div>
      <p className="source">Vir prevoza: LPP GTFS · zemljevid in naslovi: OpenStreetMap</p>
    </section>
    <section className="mapWrap"><div ref={mapNode} className="map" /><div className="beta">MVP · dejanski podatki LPP</div></section>
  </main>;
}

function toHome(feature: PhotonFeature): Home { const p = feature.properties; const street = [p.street ?? p.name, p.housenumber].filter(Boolean).join(" "); return { name: [street, p.postcode, p.city].filter(Boolean).join(", "), lon: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] }; }
function distance(a: Home, b: Stop) { const x = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180); const y = b.lat - a.lat; return x * x + y * y; }
function toGeoJson(stops: Stop[]): GeoJSON.FeatureCollection<GeoJSON.Point> { return { type: "FeatureCollection", features: stops.map(s => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: s })) }; }
