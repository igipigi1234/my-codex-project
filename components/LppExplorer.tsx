"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { NetworkData, Stop } from "@/lib/types";

const TIMES = [15, 30, 45] as const;

export default function LppExplorer() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [data, setData] = useState<NetworkData | null>(null);
  const [query, setQuery] = useState("");
  const [minutes, setMinutes] = useState<(typeof TIMES)[number]>(30);
  const [selected, setSelected] = useState<Stop | null>(null);

  useEffect(() => { fetch("/data/lpp-network.json").then(r => r.json()).then(setData); }, []);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [14.5058, 46.0569],
      zoom: 11.5,
      attributionControl: false,
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
      map.addLayer({ id: "stops", type: "circle", source: "stops", filter: ["!", ["has", "point_count"]], paint: { "circle-color": "#f7fff9", "circle-radius": 6, "circle-stroke-color": "#00a968", "circle-stroke-width": 3 } });
      map.on("click", "stops", e => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        setSelected({ id: p.id, name: p.name, lat: Number(p.lat), lon: Number(p.lon) });
      });
      map.on("click", "clusters", async e => {
        const feature = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
        const source = map.getSource("stops") as GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(Number(feature.properties?.cluster_id));
        map.easeTo({ center: (feature.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
      });
    };
    map.loaded() ? addStops() : map.once("load", addStops);
  }, [data]);

  const results = useMemo(() => {
    if (!data || query.trim().length < 2) return [];
    const q = query.toLocaleLowerCase("sl");
    return data.stops.filter(s => s.name.toLocaleLowerCase("sl").includes(q)).slice(0, 6);
  }, [data, query]);

  function chooseStop(stop: Stop) {
    setSelected(stop); setQuery(stop.name);
    mapRef.current?.flyTo({ center: [stop.lon, stop.lat], zoom: 15.5 });
  }

  return <main>
    <section className="panel">
      <div className="brand"><span className="brandMark">D</span><div><strong>Doseg Ljubljana</strong><small>Javni prevoz na enem zemljevidu</small></div></div>
      <h1>Kako daleč prideš<br />z LPP?</h1>
      <p className="lead">Izberi začetno postajališče in čas. Zemljevid že uporablja uradne podatke LPP.</p>
      <label className="searchLabel">Začetno postajališče</label>
      <div className="search"><span>⌕</span><input value={query} onChange={e => { setQuery(e.target.value); setSelected(null); }} placeholder="npr. Bavarski dvor" /></div>
      {results.length > 0 && <div className="results">{results.map(s => <button key={s.id} onClick={() => chooseStop(s)}>{s.name}</button>)}</div>}
      <label className="searchLabel timeLabel">Čas poti</label>
      <div className="timeButtons">{TIMES.map(t => <button className={minutes === t ? "active" : ""} key={t} onClick={() => setMinutes(t)}>{t}<small> min</small></button>)}</div>
      <div className="status">
        <span className="statusDot" />
        <div><strong>{selected ? selected.name : "Izberi postajališče"}</strong><p>{selected ? `Pravi izračun dosega za ${minutes} minut bo dodan z usmerjevalnikom.` : "Nato bomo izračunali dosegljivo območje."}</p></div>
      </div>
      <div className="facts"><span><strong>{data?.stops.length ?? "…"}</strong> postajališč</span><span><strong>{data?.routes.length ?? "…"}</strong> linij</span></div>
      <p className="source">Vir: LPP GTFS, posodobljeno {data?.sourceUpdatedAt ?? "…"}</p>
    </section>
    <section className="mapWrap"><div ref={mapNode} className="map" /><div className="beta">MVP · dejanski podatki LPP</div></section>
  </main>;
}

function toGeoJson(stops: Stop[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: "FeatureCollection", features: stops.map(s => ({ type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] }, properties: s })) };
}
