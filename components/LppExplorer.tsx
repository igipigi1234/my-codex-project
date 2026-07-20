"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { DayProfile, NetworkData, Pattern, Route, ScheduleData, Stop } from "@/lib/types";
import {
  buildWalkGraph,
  estimatedAccess,
  findJourneyOptions,
  lineShape,
  meters,
  nextDepartures,
  planJourney,
  profileForDate,
  routeBadges,
  runCsa,
  sliceShape,
  tripStopTimes,
  type Access,
  type Journey,
  type Location,
} from "@/lib/routing";

type Mode = "reach" | "route" | "lines" | "compare";
type Target = "start" | "end";
type TimeMode = "depart" | "arrive";
type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: { name?: string; street?: string; housenumber?: string; city?: string; postcode?: string } };
type LoadState = "loading" | "ready" | "error";

const TIMES = [15, 30, 45] as const;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const POIS: Array<Location & { category: string }> = [
  { name: "UKC Ljubljana", category: "Zdravje", lat: 46.0534, lon: 14.5222 },
  { name: "Prešernov trg", category: "Središče", lat: 46.0514, lon: 14.5060 },
  { name: "Tivoli", category: "Prosti čas", lat: 46.0547, lon: 14.4952 },
  { name: "BTC City", category: "Nakupi", lat: 46.0654, lon: 14.5417 },
  { name: "Športni park Stožice", category: "Šport", lat: 46.0812, lon: 14.5227 },
  { name: "Železniška postaja", category: "Prestop", lat: 46.0580, lon: 14.5103 },
  { name: "Fakultete Bežigrad", category: "Izobraževanje", lat: 46.0740, lon: 14.5165 },
  { name: "Nakupovalno središče Rudnik", category: "Nakupi", lat: 46.0245, lon: 14.5365 },
];

export default function LppExplorer() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const startMarker = useRef<Marker | null>(null);
  const endMarker = useRef<Marker | null>(null);
  const [network, setNetwork] = useState<NetworkData | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadMessage, setLoadMessage] = useState("Nalagam vozni red LPP …");
  const [mode, setMode] = useState<Mode>("reach");
  const [target, setTarget] = useState<Target>("start");
  const [start, setStart] = useState<Location | null>(null);
  const [end, setEnd] = useState<Location | null>(null);
  const [startQuery, setStartQuery] = useState("");
  const [endQuery, setEndQuery] = useState("");
  const [results, setResults] = useState<Location[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [date, setDate] = useState(todayString());
  const [time, setTime] = useState(currentTimeString());
  const [timeMode, setTimeMode] = useState<TimeMode>("depart");
  const [minutes, setMinutes] = useState<(typeof TIMES)[number]>(30);
  const [startAccess, setStartAccess] = useState<Access[]>([]);
  const [endAccess, setEndAccess] = useState<Access[]>([]);
  const [routingWalk, setRoutingWalk] = useState(false);
  const [reachTimes, setReachTimes] = useState<Float64Array | null>(null);
  const [compareTimes, setCompareTimes] = useState<Float64Array | null>(null);
  const [selectedReachStop, setSelectedReachStop] = useState<number | null>(null);
  const [selectedReachLocation, setSelectedReachLocation] = useState<Location | null>(null);
  const [reachJourney, setReachJourney] = useState<Journey | null>(null);
  const [journeyOptions, setJourneyOptions] = useState<Journey[]>([]);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [routeSearched, setRouteSearched] = useState(false);
  const [routeSearching, setRouteSearching] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [direction, setDirection] = useState(0);
  const [selectedLineStop, setSelectedLineStop] = useState<number | null>(null);
  const [highContrast, setHighContrast] = useState(false);
  const [savedHome, setSavedHome] = useState<Location | null>(null);
  const modeRef = useRef(mode);
  const targetRef = useRef(target);
  modeRef.current = mode;
  targetRef.current = target;

  useEffect(() => {
    const saved = localStorage.getItem("doseg-home");
    if (saved) try { setSavedHome(JSON.parse(saved)); } catch { localStorage.removeItem("doseg-home"); }
    const params = new URLSearchParams(location.search);
    const sharedMode = params.get("mode") as Mode | null;
    if (["reach", "route", "lines", "compare"].includes(sharedMode ?? "")) setMode(sharedMode!);
    if (params.get("date")) setDate(params.get("date")!);
    if (params.get("time")) setTime(params.get("time")!);
    const sharedMinutes = Number(params.get("minutes"));
    if (TIMES.includes(sharedMinutes as (typeof TIMES)[number])) setMinutes(sharedMinutes as (typeof TIMES)[number]);
    const sharedStart = locationFromParams(params, "a");
    const sharedEnd = locationFromParams(params, "b");
    if (sharedStart) { setStart(sharedStart); setStartQuery(sharedStart.name); }
    if (sharedEnd) { setEnd(sharedEnd); setEndQuery(sharedEnd.name); }
  }, []);

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    let cancelled = false;
    Promise.all([
      fetch(`${base}/data/lpp-network.json`).then(response => response.ok ? response.json() : Promise.reject()),
      loadSchedule(`${base}/data/lpp-schedule.json.gz.b64`, message => !cancelled && setLoadMessage(message)),
    ]).then(([networkData, scheduleData]) => {
      if (cancelled) return;
      setNetwork(networkData);
      setSchedule(scheduleData);
      setLoadState("ready");
    }).catch(() => {
      if (!cancelled) { setLoadState("error"); setLoadMessage("Voznega reda ni bilo mogoče naložiti. Preveri povezavo in poskusi znova."); }
    });
    return () => { cancelled = true; };
  }, []);

  const walkGraph = useMemo(() => network ? buildWalkGraph(network.stops) : null, [network]);
  const profileInfo = useMemo(() => schedule ? profileForDate(schedule, date) : { profile: null, exact: false }, [schedule, date]);
  const profile = profileInfo.profile;
  const departure = parseTime(time);

  useEffect(() => {
    if (!network || !start) { setStartAccess([]); return; }
    const fallback = estimatedAccess(start, network.stops);
    setStartAccess(fallback);
    const controller = new AbortController();
    setRoutingWalk(true);
    routeAccess(start, network.stops, fallback, false, controller.signal).then(setStartAccess).finally(() => !controller.signal.aborted && setRoutingWalk(false));
    return () => controller.abort();
  }, [network, start]);

  useEffect(() => {
    if (!network || !end) { setEndAccess([]); return; }
    const fallback = estimatedAccess(end, network.stops);
    setEndAccess(fallback);
    const controller = new AbortController();
    setRoutingWalk(true);
    routeAccess(end, network.stops, fallback, true, controller.signal).then(setEndAccess).finally(() => !controller.signal.aborted && setRoutingWalk(false));
    return () => controller.abort();
  }, [network, end]);

  useEffect(() => {
    if (!profile || !walkGraph || !startAccess.length || (mode !== "reach" && mode !== "compare")) { setReachTimes(null); return; }
    setSelectedReachStop(null);
    setSelectedReachLocation(null);
    setReachJourney(null);
    setReachTimes(runCsa(profile, departure, walkGraph, startAccess, minutes * 60).earliest);
  }, [profile, walkGraph, startAccess, departure, minutes, mode]);

  useEffect(() => {
    if (mode !== "compare" || !profile || !walkGraph || !endAccess.length) { setCompareTimes(null); return; }
    setCompareTimes(runCsa(profile, departure, walkGraph, endAccess, minutes * 60).earliest);
  }, [mode, profile, walkGraph, endAccess, departure, minutes]);

  useEffect(() => {
    setJourney(null);
    setJourneyOptions([]);
    setRouteSearched(false);
  }, [start, end, date, departure, timeMode]);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: {
        version: 8,
        sources: { carto: { type: "raster", tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors © CARTO" } },
        layers: [{ id: "carto", type: "raster", source: "carto" }],
      },
      center: [14.5058, 46.0569],
      zoom: 11.4,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [loadState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !network) return;
    const draw = () => {
      if (!map.getSource("stops")) {
        map.addSource("stops", { type: "geojson", data: stopGeoJson(network.stops), cluster: true, clusterMaxZoom: 14, clusterRadius: 38 });
        map.addLayer({ id: "clusters", type: "circle", source: "stops", filter: ["has", "point_count"], paint: { "circle-color": "#53e0aa", "circle-radius": ["step", ["get", "point_count"], 15, 20, 19, 80, 23], "circle-stroke-color": "#052b22", "circle-stroke-width": 2 } });
        map.addLayer({ id: "cluster-count", type: "symbol", source: "stops", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11 }, paint: { "text-color": "#052b22" } });
        map.addLayer({ id: "stops", type: "circle", source: "stops", filter: ["!", ["has", "point_count"]], paint: { "circle-color": "#fff", "circle-radius": 5, "circle-stroke-color": "#00a968", "circle-stroke-width": 2 } });
      }
      ensureOverlayLayers(map);
    };
    map.isStyleLoaded() ? draw() : map.once("load", draw);
  }, [network]);

  const place = useCallback((which: Target, value: Location) => {
    const map = mapRef.current;
    setResults([]);
    setSearchMessage("");
    if (which === "start") {
      setStart(value);
      setStartQuery(value.name);
      startMarker.current?.remove();
      if (map) startMarker.current = marker("A", "#052b22").setLngLat([value.lon, value.lat]).addTo(map);
      if (modeRef.current === "route" || modeRef.current === "compare") setTarget("end");
    } else {
      setEnd(value);
      setEndQuery(value.name);
      endMarker.current?.remove();
      if (map) endMarker.current = marker("B", "#d97706").setLngLat([value.lon, value.lat]).addTo(map);
    }
    map?.flyTo({ center: [value.lon, value.lat], zoom: 14, essential: true });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !network) return;
    const click = async (event: maplibregl.MapMouseEvent) => {
      const lineFeatures = map.getLayer("line-stop-layer") ? map.queryRenderedFeatures(event.point, { layers: ["line-stop-layer"] }) : [];
      if (lineFeatures.length) { setSelectedLineStop(Number(lineFeatures[0].properties?.index)); return; }
      const reachableFeatures = map.getLayer("reachable-layer") ? map.queryRenderedFeatures(event.point, { layers: ["reachable-layer"] }) : [];
      if (reachableFeatures.length && modeRef.current === "reach") { chooseReachStop(Number(reachableFeatures[0].properties?.index)); return; }
      const clusters = ["stops", "clusters"].filter(id => map.getLayer(id));
      const stopFeatures = clusters.length ? map.queryRenderedFeatures(event.point, { layers: clusters }) : [];
      if (stopFeatures.length) {
        const feature = stopFeatures[0];
        if (feature.properties?.cluster && map.getSource("stops")) {
          const source = map.getSource("stops") as GeoJSONSource;
          map.easeTo({ center: (feature.geometry as GeoJSON.Point).coordinates as [number, number], zoom: await source.getClusterExpansionZoom(Number(feature.properties.cluster_id)) });
        }
        return;
      }
      if (modeRef.current !== "lines") place(targetRef.current, { name: "Izbrana točka na zemljevidu", lat: event.lngLat.lat, lon: event.lngLat.lng });
    };
    map.on("click", click);
    return () => { map.off("click", click); };
  }, [network, place]);

  useEffect(() => {
    const query = target === "start" ? startQuery : endQuery;
    const selected = target === "start" ? start : end;
    if (selected?.name === query || query.trim().length < 3) { setResults([]); setSearchMessage(""); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchMessage("");
      try {
        const params = new URLSearchParams({ q: `${query}, Ljubljana, Slovenia`, limit: "6", lat: "46.0569", lon: "14.5058", bbox: "13.9,45.7,15.1,46.4" });
        const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const json = await response.json() as { features: PhotonFeature[] };
        const places = [...new Map(json.features.map(toLocation).filter(value => value.name).map(value => [value.name.toLocaleLowerCase("sl"), value])).values()];
        setResults(places);
        if (!places.length) setSearchMessage("Ni zadetkov. Lokacijo lahko izbereš na zemljevidu.");
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setSearchMessage("Iskanje trenutno ni dosegljivo. Lokacijo izberi na zemljevidu.");
      } finally { if (!controller.signal.aborted) setSearching(false); }
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [target, startQuery, endQuery, start, end]);

  useEffect(() => {
    if (!network || !schedule || !profile || !mapRef.current) return;
    const map = mapRef.current;
    const render = () => {
      ensureOverlayLayers(map);
      for (const id of ["reach-area", "compare-area", "compare-stops", "plan", "line-view", "line-stops", "transfer-lines", "selected-stop", "reachable", "reach-lines"]) setSource(map, id, EMPTY);
      toggleBaseStops(map, mode === "reach" && !start || mode === "route" && (!start || !end));

      if (mode === "reach" && reachJourney && selectedReachLocation) {
        const features = journeyFeatures(reachJourney, start!, selectedReachLocation, network, schedule, profile);
        setSource(map, "plan", features);
        fitFeatures(map, features, 58);
      } else if (mode === "reach" && reachTimes) {
        setSource(map, "reach-area", reachAreaFeatures(reachTimes, departure, network.stops, minutes));
        setSource(map, "reachable", reachablePointFeatures(reachTimes, departure, network.stops, minutes));
        setSource(map, "reach-lines", reachableLineFeatures(profile, schedule, network, reachTimes, departure, minutes * 60));
      } else if (mode === "compare" && reachTimes && compareTimes) {
        setSource(map, "compare-area", compareAreaFeatures(reachTimes, compareTimes, departure, network.stops, minutes));
        setSource(map, "compare-stops", comparePointFeatures(reachTimes, compareTimes, departure, network.stops, minutes));
      } else if (mode === "route" && journey && start && end) {
        const features = journeyFeatures(journey, start, end, network, schedule, profile);
        setSource(map, "plan", features);
        fitFeatures(map, features, 58);
      } else if (mode === "lines") {
        const chosen = activePattern ? [activePattern] : [];
        const lineFeatures = shapeFeatures(schedule, network.routes, chosen);
        setSource(map, "line-view", lineFeatures);
        if (activePattern) setSource(map, "line-stops", lineStopFeatures(activePattern, network.stops, network.routes[selectedRoute]));
        if (selectedLineStop !== null) {
          const stop = network.stops[selectedLineStop];
          setSource(map, "selected-stop", pointFeature(stop.lon, stop.lat, { name: stop.name }));
          const transferPatterns = profile.patterns.filter(pattern => transferRoutes.some(value => value.route === pattern[0]));
          setSource(map, "transfer-lines", shapeFeatures(schedule, network.routes, transferPatterns));
        }
      }
    };
    map.isStyleLoaded() ? render() : map.once("load", render);
  }, [mode, network, schedule, profile, reachTimes, compareTimes, reachJourney, selectedReachLocation, journey, start, end, departure, minutes, selectedRoute, direction, selectedLineStop]);

  const linePatterns = useMemo(() => profile?.patterns.filter(pattern => pattern[0] === selectedRoute) ?? [], [profile, selectedRoute]);
  const activePattern = linePatterns[direction] ?? linePatterns[0];
  const activeRouteIndices = useMemo(() => {
    if (!profile || !network) return [] as number[];
    return [...new Set(profile.patterns.map(pattern => pattern[0]))].sort((a, b) => network.routes[a].shortName.localeCompare(network.routes[b].shortName, "sl", { numeric: true }));
  }, [profile, network]);
  useEffect(() => {
    if (activeRouteIndices.length && !activeRouteIndices.includes(selectedRoute)) {
      setSelectedRoute(activeRouteIndices[0]);
      setDirection(0);
      setSelectedLineStop(null);
    }
  }, [activeRouteIndices, selectedRoute]);
  const transferRoutes = useMemo(() => {
    if (!network || !profile || selectedLineStop === null) return [] as Array<{ route: number; distance: number }>;
    const selected = network.stops[selectedLineStop];
    const found = new Map<number, number>();
    for (const pattern of profile.patterns) {
      if (pattern[0] === selectedRoute) continue;
      for (const stopIndex of pattern[3]) {
        const distance = meters(selected, network.stops[stopIndex]);
        if (distance <= 220 && distance < (found.get(pattern[0]) ?? Infinity)) found.set(pattern[0], distance);
      }
    }
    return [...found.entries()].map(([route, distance]) => ({ route, distance })).sort((a, b) => a.distance - b.distance || network.routes[a.route].shortName.localeCompare(network.routes[b.route].shortName, undefined, { numeric: true }));
  }, [network, profile, selectedLineStop, selectedRoute]);

  useEffect(() => {
    if (mode !== "lines" || !network || !activePattern || !mapRef.current || selectedLineStop !== null) return;
    const coordinates = activePattern[3].map(index => [network.stops[index].lon, network.stops[index].lat] as [number, number]);
    fitCoordinates(mapRef.current, coordinates, 60);
  }, [mode, network, activePattern, selectedLineStop]);

  useEffect(() => {
    if (mode !== "lines" || !network || selectedLineStop === null || !mapRef.current) return;
    const stop = network.stops[selectedLineStop];
    mapRef.current.flyTo({ center: [stop.lon, stop.lat], zoom: 15, essential: true });
  }, [mode, network, selectedLineStop]);

  useEffect(() => {
    if (!network || !mapRef.current) return;
    if (start) {
      startMarker.current?.remove();
      startMarker.current = marker("A", "#052b22").setLngLat([start.lon, start.lat]).addTo(mapRef.current);
    }
    if (end) {
      endMarker.current?.remove();
      endMarker.current = marker("B", "#d97706").setLngLat([end.lon, end.lat]).addTo(mapRef.current);
    }
  }, [network, start, end]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("mode", mode);
    params.set("date", date);
    params.set("time", time);
    params.set("minutes", String(minutes));
    addLocationParams(params, "a", start);
    addLocationParams(params, "b", end);
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }, [mode, date, time, minutes, start, end]);

  const reachable = useMemo(() => {
    if (!reachTimes || !network) return [];
    const byName = new Map<string, { stop: Stop; index: number; time: number }>();
    network.stops.forEach((stop, index) => {
      const value = reachTimes[index] - departure;
      if (!Number.isFinite(value) || value > minutes * 60) return;
      const current = byName.get(stop.name);
      if (!current || value > current.time) byName.set(stop.name, { stop, index, time: value });
    });
    return [...byName.values()].sort((a, b) => b.time - a.time);
  }, [reachTimes, network, departure, minutes]);

  const reachablePois = useMemo(() => {
    if (!network || !reachTimes) return [];
    return POIS.map(poi => {
      let stop = 0, distance = Infinity;
      network.stops.forEach((candidate, index) => { const value = meters(poi, candidate); if (value < distance) { distance = value; stop = index; } });
      return { ...poi, stop, seconds: reachTimes[stop] - departure + distance * 1.22 / 1.25 };
    }).filter(poi => Number.isFinite(poi.seconds) && poi.seconds <= minutes * 60).sort((a, b) => a.seconds - b.seconds);
  }, [network, reachTimes, departure, minutes]);

  const compareSummary = useMemo(() => {
    if (!reachTimes || !compareTimes) return null;
    let a = 0, b = 0, both = 0;
    for (let index = 0; index < reachTimes.length; index++) {
      const inA = reachTimes[index] - departure <= minutes * 60;
      const inB = compareTimes[index] - departure <= minutes * 60;
      if (inA) a++;
      if (inB) b++;
      if (inA && inB) both++;
    }
    return { a, b, both, difference: a - b };
  }, [reachTimes, compareTimes, departure, minutes]);

  const selectedDepartures = useMemo(() => selectedLineStop !== null && profile ? nextDepartures(profile, selectedLineStop, departure, 8) : [], [selectedLineStop, profile, departure]);

  function chooseReachStop(stopIndex: number) {
    if (!network || !profile || !walkGraph || !startAccess.length) return;
    const stop = network.stops[stopIndex];
    const result = planJourney(profile, departure, walkGraph, startAccess, [{ stop: stopIndex, seconds: 0, distance: 0 }]);
    if (result) {
      setSelectedReachStop(stopIndex);
      setSelectedReachLocation({ name: stop.name, lat: stop.lat, lon: stop.lon });
      setReachJourney(result);
    }
  }

  async function chooseReachPoi(poi: Location & { stop: number }) {
    if (!network || !profile || !walkGraph || !startAccess.length) return;
    setRouteSearching(true);
    const fallback = estimatedAccess(poi, network.stops);
    const egress = await routeAccess(poi, network.stops, fallback, true).catch(() => fallback);
    const result = planJourney(profile, departure, walkGraph, startAccess, egress);
    setRouteSearching(false);
    if (result) {
      setSelectedReachStop(poi.stop);
      setSelectedReachLocation(poi);
      setReachJourney(result);
    }
  }

  function searchJourneys() {
    if (!profile || !walkGraph || !startAccess.length || !endAccess.length) return;
    setRouteSearching(true);
    setRouteSearched(false);
    window.setTimeout(() => {
      const options = findJourneyOptions(profile, departure, walkGraph, startAccess, endAccess, timeMode === "arrive");
      setJourney(null);
      setJourneyOptions(options);
      setRouteSearched(true);
      setRouteSearching(false);
      if (mapRef.current) setSource(mapRef.current, "plan", EMPTY);
    }, 20);
  }

  function selectJourney(value: Journey) {
    setJourney(value);
  }

  function useCurrentLocation(which: Target) {
    if (!navigator.geolocation) { setSearchMessage("Brskalnik ne podpira določanja lokacije."); return; }
    setSearchMessage("Pridobivam trenutno lokacijo …");
    navigator.geolocation.getCurrentPosition(
      position => place(which, { name: "Moja trenutna lokacija", lat: position.coords.latitude, lon: position.coords.longitude }),
      () => setSearchMessage("Lokacije ni bilo mogoče pridobiti. Dovoljenje lahko spremeniš v nastavitvah brskalnika."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function saveHome() {
    if (!start) return;
    localStorage.setItem("doseg-home", JSON.stringify(start));
    setSavedHome(start);
  }

  function swapLocations() {
    const previousStart = start, previousQuery = startQuery;
    setStart(end);
    setStartQuery(endQuery);
    setEnd(previousStart);
    setEndQuery(previousQuery);
    setTarget("end");
  }

  function chooseLineStop(stopIndex: number) {
    setSelectedLineStop(stopIndex);
  }

  function setStopAs(which: Target) {
    if (!network || selectedLineStop === null) return;
    const stop = network.stops[selectedLineStop];
    place(which, { name: stop.name, lat: stop.lat, lon: stop.lon });
    setMode(which === "start" ? "reach" : "route");
  }

  function switchMode(value: Mode) {
    setMode(value);
    setTarget(value === "route" || value === "compare" ? (start ? "end" : "start") : "start");
    setResults([]);
  }

  if (loadState !== "ready" || !network || !schedule) {
    return <main className={`loadingScreen ${highContrast ? "contrast" : ""}`}><div className="loadingCard" role="status" aria-live="polite"><div className="brandMark">D</div><h1>Doseg Ljubljana</h1><div className="loader" /><p>{loadMessage}</p>{loadState === "error" && <button className="primary" onClick={() => location.reload()}>Poskusi znova</button>}</div></main>;
  }

  return <main className={highContrast ? "contrast" : ""}>
    <a className="skipLink" href="#controls">Preskoči na iskalnik</a>
    <section className="panel appPanel" id="controls" aria-label="Načrtovanje poti">
      <header className="appHeader">
        <div className="brand"><span className="brandMark" aria-hidden="true">D</span><div><strong>Doseg Ljubljana</strong><small>Javni prevoz razumljivo</small></div></div>
        <button className="iconButton" aria-pressed={highContrast} onClick={() => setHighContrast(value => !value)} title="Visok kontrast">◐<span className="srOnly">Visok kontrast</span></button>
      </header>

      <nav className="tabs" aria-label="Glavni načini">
        <button className={mode === "reach" ? "active" : ""} aria-current={mode === "reach" ? "page" : undefined} onClick={() => switchMode("reach")}>Doseg</button>
        <button className={mode === "route" ? "active" : ""} aria-current={mode === "route" ? "page" : undefined} onClick={() => switchMode("route")}>Pot A–B</button>
        <button className={mode === "lines" ? "active" : ""} aria-current={mode === "lines" ? "page" : undefined} onClick={() => switchMode("lines")}>Linije</button>
        <button className={mode === "compare" ? "active" : ""} aria-current={mode === "compare" ? "page" : undefined} onClick={() => switchMode("compare")}>Primerjaj</button>
      </nav>

      {mode !== "lines" && <>
        <div className="titleRow"><div><span className="eyebrow">{mode === "reach" ? "Raziskuj mesto" : mode === "route" ? "Navodila po korakih" : "Primerjaj dva naslova"}</span><h1>{mode === "reach" ? "Kam lahko prideš?" : mode === "route" ? "Načrtuj pot" : "Kateri naslov je bolje povezan?"}</h1></div>{routingWalk && <span className="statusPill">Preverjam hojo …</span>}</div>
        <LocationInput label={mode === "compare" ? "Naslov A" : "Začetek"} badge="A" value={startQuery} active={target === "start"} selected={Boolean(start)} onFocus={() => setTarget("start")} onChange={value => { setStartQuery(value); setStart(null); }} placeholder="Vpiši naslov ali izberi na zemljevidu" onLocate={() => useCurrentLocation("start")} />
        {(mode === "route" || mode === "compare") && <LocationInput label={mode === "compare" ? "Naslov B" : "Cilj"} badge="B" value={endQuery} active={target === "end"} selected={Boolean(end)} onFocus={() => setTarget("end")} onChange={value => { setEndQuery(value); setEnd(null); }} placeholder={mode === "compare" ? "Drugi naslov" : "Kam želiš?"} onLocate={() => useCurrentLocation("end")} />}
        {(mode === "route" || mode === "compare") && <button className="swapButton" onClick={swapLocations} disabled={!start && !end}>⇅ Zamenjaj A in B</button>}
        {(searching || searchMessage || results.length > 0) && <div className="searchResults" role="listbox" aria-live="polite">{searching && <p>Iščem naslov …</p>}{searchMessage && <p>{searchMessage}</p>}{results.map((result, index) => <button role="option" key={`${result.lon}-${result.lat}-${index}`} onClick={() => place(target, result)}>{result.name}</button>)}</div>}
        <div className={`controls ${mode === "route" ? "three" : ""}`}>
          {mode === "route" && <label>Način<select value={timeMode} onChange={event => setTimeMode(event.target.value as TimeMode)}><option value="depart">Odhod ob</option><option value="arrive">Prihod do</option></select></label>}
          <label>Datum<input type="date" min={schedule.validFrom} max={schedule.validThrough} value={date} onChange={event => setDate(event.target.value)} /></label>
          <label>{timeMode === "arrive" && mode === "route" ? "Prihod" : "Odhod"}<span className="timeControl"><input type="time" value={time} onChange={event => setTime(event.target.value)} /><button type="button" onClick={() => { setDate(todayString()); setTime(currentTimeString()); }}>Zdaj</button></span></label>
        </div>
        {!profileInfo.exact && <div className="notice" role="status"><strong>Okvirni profil dneva</strong><span>Za izbrani datum ni natančnega koledarja, zato je uporabljen običajen vozni red iste vrste dneva.</span></div>}
        <div className="quickActions">{start && <button onClick={saveHome}>{savedHome?.lat === start.lat && savedHome?.lon === start.lon ? "✓ Dom shranjen" : "☆ Shrani kot dom"}</button>}{savedHome && <button onClick={() => place("start", savedHome)}>⌂ Uporabi dom</button>}</div>
      </>}

      {mode === "reach" && <>
        <TimeSelector minutes={minutes} onChange={setMinutes} />
        {reachJourney && selectedReachLocation ? <div className="selectedJourney"><button className="backButton" onClick={() => { setReachJourney(null); setSelectedReachStop(null); setSelectedReachLocation(null); }}>← Celoten doseg</button><div className="summary focus"><span className="summaryIcon">◎</span><div><strong>{selectedReachLocation.name}</strong><p>Izbrana povezava iz točke A.</p></div></div><JourneyCard journey={reachJourney} network={network} profile={profile!} /></div> : <>
          <div className="summary"><span className="summaryIcon">{start ? "✓" : "A"}</span><div><strong>{start ? `${reachable.length} dosegljivih postajališč` : "Najprej izberi začetek"}</strong><p>{start ? `${formatDate(date)}, odhod ${time}. Izberi cilj na seznamu ali zemljevidu.` : "Vpiši naslov, uporabi trenutno lokacijo ali klikni zemljevid."}</p></div></div>
          {reachablePois.length > 0 && <div className="destinationList"><div className="sectionHeading"><h2>Uporabni cilji</h2><small>v izbranem času</small></div>{reachablePois.slice(0, 6).map(poi => <button key={poi.name} onClick={() => chooseReachPoi(poi)}><span><small>{poi.category}</small>{poi.name}</span><strong>{Math.round(poi.seconds / 60)} min</strong></button>)}</div>}
          {reachable.length > 0 && <div className="destinationList"><div className="sectionHeading"><h2>Rob dosega</h2><small>najbolj oddaljena postajališča</small></div>{reachable.slice(0, 6).map(value => <button key={value.stop.id} onClick={() => chooseReachStop(value.index)}><span>{value.stop.name}</span><strong>{Math.round(value.time / 60)} min</strong></button>)}</div>}
        </>}
      </>}

      {mode === "route" && <>
        <button className="primary" disabled={!start || !end || routeSearching || !profile} onClick={searchJourneys}>{routeSearching ? "Računam najboljše povezave …" : "Poišči povezave"}</button>
        {journey ? <><div className="resultActions"><button className="backButton" onClick={() => setJourney(null)}>← Druge povezave</button><ShareButton /></div><JourneyCard journey={journey} network={network} profile={profile!} /></> : journeyOptions.length ? <div className="journeyOptions"><div className="sectionHeading"><h2>Izberi povezavo</h2><small>primerjaj čas, hojo in prestope</small></div>{journeyOptions.map((option, index) => <JourneyOption key={`${option.arrival}-${index}`} journey={option} network={network} onClick={() => selectJourney(option)} />)}</div> : routeSearched ? <div className="emptyCard"><strong>Za izbrani čas povezave ni.</strong><p>Poskusi spremeniti čas, datum ali eno od lokacij.</p></div> : <div className="emptyCard"><strong>Pripravljeno za načrtovanje.</strong><p>Izberi A in B. Obe lokaciji lahko določiš tudi s klikom na zemljevid.</p></div>}
      </>}

      {mode === "compare" && <>
        <TimeSelector minutes={minutes} onChange={setMinutes} />
        {compareSummary && start && end ? <div className="comparison"><div className="compareCard a"><span>A</span><strong>{compareSummary.a}</strong><small>dosegljivih postajališč</small></div><div className="compareCard b"><span>B</span><strong>{compareSummary.b}</strong><small>dosegljivih postajališč</small></div><div className="comparisonResult"><strong>{compareSummary.difference === 0 ? "Naslova sta podobno povezana" : `${compareSummary.difference > 0 ? "Naslov A" : "Naslov B"} doseže ${Math.abs(compareSummary.difference)} postajališč več`}</strong><p>{compareSummary.both} postajališč je dosegljivih z obeh naslovov v {minutes} minutah.</p></div></div> : <div className="emptyCard"><strong>Primerjaj dostopnost dveh naslovov.</strong><p>Ko izbereš A in B, se na zemljevidu pokažeta obe območji in število dosegljivih postajališč.</p></div>}
      </>}

      {mode === "lines" && <>
        <span className="eyebrow">Trase, postaje in odhodi</span><h1>Linije LPP</h1>
        <label className="fieldLabel">Izberi linijo<select className="lineSelect" value={selectedRoute} onChange={event => { setSelectedRoute(Number(event.target.value)); setDirection(0); setSelectedLineStop(null); }}>{activeRouteIndices.map(index => { const route = network.routes[index]; return <option value={index} key={route.id}>Linija {route.shortName}{route.longName ? ` · ${route.longName}` : ""}</option>; })}</select></label>
        <div className="directionButtons" aria-label="Smer linije">{linePatterns.map((pattern, index) => <button className={direction === index ? "active" : ""} key={`${pattern[1]}-${index}`} onClick={() => { setDirection(index); setSelectedLineStop(null); }}>{pattern[1] || `Smer ${index + 1}`}</button>)}</div>
        {selectedLineStop !== null && <div className="stopDetail"><div className="stopDetailHead"><span className="stopDot" style={{ background: `#${network.routes[selectedRoute].color}` }} /><div><strong>{network.stops[selectedLineStop].name}</strong><small>Naslednji načrtovani odhodi po {formatTime(departure)}</small></div></div><div className="departures">{selectedDepartures.length ? selectedDepartures.map(value => <div key={`${value.trip}-${value.time}`}><time>{formatTime(value.time)}</time><RouteBadge route={network.routes[value.route]} /><span>{value.headsign}</span></div>) : <p>Za izbrani čas ni več odhodov.</p>}</div><div className="stopActions"><button onClick={() => setStopAs("start")}>Začni tukaj</button><button onClick={() => setStopAs("end")}>Cilj tukaj</button></div>{transferRoutes.length > 0 && <div className="transferCard"><small>Prestopi v bližini</small><div>{transferRoutes.slice(0, 12).map(value => <button key={value.route} style={{ background: `#${network.routes[value.route].color}`, color: `#${network.routes[value.route].textColor}` }} onClick={() => { setSelectedRoute(value.route); setDirection(0); setSelectedLineStop(null); }} title={`${Math.max(1, Math.round(value.distance * 1.22 / 1.25 / 60))} min hoje`}>{network.routes[value.route].shortName}</button>)}</div></div>}</div>}
        {activePattern && <div className="stopList"><div className="sectionHeading"><h2>{activePattern[3].length} postajališč</h2><small>klik pokaže odhode</small></div>{activePattern[3].map((stopIndex, index) => <button className={selectedLineStop === stopIndex ? "selected" : ""} key={`${stopIndex}-${index}`} onClick={() => chooseLineStop(stopIndex)} aria-pressed={selectedLineStop === stopIndex}><i style={{ background: `#${network.routes[selectedRoute].color}`, color: `#${network.routes[selectedRoute].textColor}` }}>{index + 1}</i><span>{network.stops[stopIndex].name}</span></button>)}</div>}
      </>}

      <footer className="source"><strong>Načrtovani podatki LPP</strong><span>Veljavnost {formatDate(schedule.validFrom ?? network.validFrom)}–{formatDate(schedule.validThrough ?? network.validThrough)}. Brez zamud in obvozov v živo.</span><details><summary>Metodologija in zasebnost</summary><p>Vozni red in trase so iz statičnega LPP GTFS. Začetna in končna hoja se preverita po OpenStreetMap prek BRouterja; ob nedosegljivosti se uporabi konservativna ocena. Vpisani naslov se zaradi iskanja pošlje storitvi Photon, koordinate za preverjanje hoje pa BRouterju. Naslov se ne shranjuje, razen če izbereš »Shrani kot dom«, ko ostane samo v tvojem brskalniku.</p></details></footer>
    </section>
    <section className="mapWrap" aria-label="Zemljevid Ljubljane"><div ref={mapNode} className="map" /><div className="mapHint">{mode === "lines" ? "Izberi postajališče na trasi" : `Klik izbere ${target === "start" ? "začetek A" : "cilj B"}`}</div><div className="mapLegend" aria-hidden="true">{mode === "reach" ? <><span><i className="l15" /> do 15 min</span><span><i className="l30" /> 15–30</span><span><i className="l45" /> 30–45</span></> : mode === "compare" ? <><span><i className="compareA" /> naslov A</span><span><i className="compareB" /> naslov B</span><span><i className="compareBoth" /> oba</span></> : null}</div></section>
  </main>;
}

function LocationInput({ label, badge, value, active, selected, onFocus, onChange, placeholder, onLocate }: { label: string; badge: string; value: string; active: boolean; selected: boolean; onFocus: () => void; onChange: (value: string) => void; placeholder: string; onLocate: () => void }) {
  return <div className={`locationField ${active ? "active" : ""} ${selected ? "selected" : ""}`}><span aria-hidden="true">{badge}</span><label><small>{label}</small><input aria-label={label} autoComplete="street-address" value={value} onFocus={onFocus} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label><button type="button" onClick={onLocate} title="Uporabi trenutno lokacijo">⌖<span className="srOnly">Uporabi trenutno lokacijo za {label.toLowerCase()}</span></button></div>;
}

function TimeSelector({ minutes, onChange }: { minutes: (typeof TIMES)[number]; onChange: (value: (typeof TIMES)[number]) => void }) {
  return <><div className="timeButtons" aria-label="Čas dosega">{TIMES.map(value => <button className={minutes === value ? "active" : ""} aria-pressed={minutes === value} key={value} onClick={() => onChange(value)}><strong>{value}</strong><small> min</small></button>)}</div></>;
}

function JourneyOption({ journey, network, onClick }: { journey: Journey; network: NetworkData; onClick: () => void }) {
  const routes = routeBadges(journey, network);
  return <button className="journeyOption" onClick={onClick}><div className="optionTop"><span className="optionLabel">{journey.label}</span><strong>{Math.round(journey.duration / 60)} min</strong><small>{formatTime(journey.departure)}–{formatTime(journey.arrival)}</small></div><div className="optionRoute">{routes.map((route, index) => <RouteBadge route={route} key={`${route.id}-${index}`} />)}<span className="chevron">›</span></div><div className="optionStats"><span>Peš {journey.walkingMinutes} min</span><span>Čakanje {journey.waitingMinutes} min</span><span>{journey.transfers ? `${journey.transfers} prestop` : "Brez prestopa"}</span></div></button>;
}

function JourneyCard({ journey, network, profile }: { journey: Journey; network: NetworkData; profile: DayProfile }) {
  const [showSchedule, setShowSchedule] = useState(true);
  return <article className="journeyCard"><header className="journeyHead"><div><span className="optionLabel">{journey.label ?? "Izbrana pot"}</span><strong>{Math.round(journey.duration / 60)} min</strong><small>odhod {formatTime(journey.departure)} · prihod {formatTime(journey.arrival)}</small></div><div className="journeyMetrics"><span>{journey.walkingMinutes} min hoje</span><span>{journey.transfers ? `${journey.transfers} prestop` : "brez prestopa"}</span></div></header><div className="timeline">{journey.steps.map((step, index) => step.kind === "walk" ? <div className="step walk" key={index}><i aria-hidden="true">↟</i><div><p>{index === journey.steps.length - 1 ? "Hoja do cilja" : `Hoja do ${network.stops[step.to].name}`}</p><small>približno {step.minutes} min</small></div></div> : <div className="step" key={index}><RouteBadge route={network.routes[step.route!]} /><div><p>Proti {profile.trips[step.trip!]?.[1] || network.stops[step.to].name}</p><small>{formatTime(step.dep!)}–{formatTime(step.arr!)} · izstop {network.stops[step.to].name}</small></div></div>)}</div><button className="scheduleToggle" aria-expanded={showSchedule} onClick={() => setShowSchedule(value => !value)}>{showSchedule ? "Skrij podroben vozni red" : "Prikaži podroben vozni red"}</button>{showSchedule && <div className="tripSchedule">{journey.steps.filter(step => step.kind === "ride").map((step, index) => <section className="scheduleRide" key={`${step.trip}-${index}`}><h3><RouteBadge route={network.routes[step.route!]} /> proti {profile.trips[step.trip!]?.[1]}</h3>{tripStopTimes(step, profile).map(([stop, value], row) => <div className="scheduleRow" key={`${stop}-${row}`}><time>{formatTime(value)}</time><span>{network.stops[stop].name}</span></div>)}</section>)}</div>}</article>;
}

function RouteBadge({ route }: { route: Route }) { return <i className="routeBadge" style={{ background: `#${route.color}`, color: `#${route.textColor}` }}>{route.shortName}</i>; }
function ShareButton() { const [copied, setCopied] = useState(false); return <button className="shareButton" onClick={async () => { await navigator.clipboard?.writeText(location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }}>{copied ? "✓ Povezava kopirana" : "Deli pot"}</button>; }

async function loadSchedule(url: string, onProgress: (message: string) => void): Promise<ScheduleData> {
  onProgress("Prenašam vozni red LPP …");
  const response = await fetch(url);
  if (!response.ok) throw new Error("schedule");
  const encoded = await response.text();
  onProgress("Pripravljam povezave …");
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  if (!("DecompressionStream" in window)) throw new Error("compression");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

async function routeAccess(locationValue: Location, stops: Stop[], fallback: Access[], reverse: boolean, signal?: AbortSignal): Promise<Access[]> {
  const candidates = fallback.slice(0, 7);
  const routed = await Promise.all(candidates.map(async candidate => {
    const stop = stops[candidate.stop];
    const points = reverse ? `${stop.lon},${stop.lat}|${locationValue.lon},${locationValue.lat}` : `${locationValue.lon},${locationValue.lat}|${stop.lon},${stop.lat}`;
    try {
      const params = new URLSearchParams({ lonlats: points, profile: "hiking-mountain", alternativeidx: "0", format: "geojson" });
      const response = await fetch(`https://brouter.de/brouter?${params}`, { signal });
      const data = await response.json() as GeoJSON.FeatureCollection<GeoJSON.LineString, { "total-time"?: string; "track-length"?: string }>;
      const feature = data.features[0];
      const seconds = Number(feature?.properties?.["total-time"]);
      const distance = Number(feature?.properties?.["track-length"]);
      if (!feature || !Number.isFinite(seconds) || !Number.isFinite(distance)) return candidate;
      return { stop: candidate.stop, seconds: Math.max(30, seconds), distance, geometry: feature.geometry.coordinates as Array<[number, number]> };
    } catch { return candidate; }
  }));
  return routed;
}

function journeyFeatures(journey: Journey, start: Location, end: Location, network: NetworkData, schedule: ScheduleData, profile: DayProfile): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  journey.steps.forEach((step, index) => {
    let coordinates: Array<[number, number]>;
    if (step.kind === "ride" && step.trip !== undefined && step.from !== undefined) {
      coordinates = lineShape(schedule, profile, step.trip, network.stops[step.from], network.stops[step.to]);
    } else if (step.geometry?.length) {
      coordinates = step.geometry;
    } else if (index === 0) {
      coordinates = [[start.lon, start.lat], [network.stops[step.to].lon, network.stops[step.to].lat]];
    } else if (index === journey.steps.length - 1) {
      coordinates = [[network.stops[step.to].lon, network.stops[step.to].lat], [end.lon, end.lat]];
    } else {
      coordinates = [[network.stops[step.from!].lon, network.stops[step.from!].lat], [network.stops[step.to].lon, network.stops[step.to].lat]];
    }
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: { color: step.kind === "ride" ? `#${network.routes[step.route!].color}` : "#4c5f58", kind: step.kind } });
  });
  return { type: "FeatureCollection", features };
}

function reachableLineFeatures(profile: DayProfile, schedule: ScheduleData, network: NetworkData, earliest: Float64Array, departure: number, limit: number): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const seen = new Set<string>();
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const [dep, arr, from, to, trip, route] of profile.connections) {
    if (dep < departure || arr > departure + limit || !Number.isFinite(earliest[from]) || earliest[from] + 89 > dep) continue;
    const key = `${from}-${to}-${route}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const shape = schedule.shapes[profile.trips[trip]?.[2]];
    const fromStop = network.stops[from], toStop = network.stops[to];
    const coordinates = shape ? sliceShape(shape, [fromStop.lon, fromStop.lat], [toStop.lon, toStop.lat]) : [[fromStop.lon, fromStop.lat], [toStop.lon, toStop.lat]];
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: { color: `#${network.routes[route].color}` } });
  }
  return { type: "FeatureCollection", features };
}

function reachablePointFeatures(earliest: Float64Array, departure: number, stops: Stop[], limit: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  earliest.forEach((arrival, index) => {
    const time = Math.round((arrival - departure) / 60);
    if (Number.isFinite(arrival) && time <= limit) features.push({ type: "Feature", geometry: { type: "Point", coordinates: [stops[index].lon, stops[index].lat] }, properties: { time, name: stops[index].name, index } });
  });
  return { type: "FeatureCollection", features };
}

function reachAreaFeatures(earliest: Float64Array, departure: number, stops: Stop[], limit: number): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const thresholds = TIMES.filter(value => value <= limit).sort((a, b) => b - a);
  const features = thresholds.flatMap(threshold => {
    const points = stops.filter((_, index) => earliest[index] - departure <= threshold * 60).map(stop => [stop.lon, stop.lat] as [number, number]);
    const hull = convexHull(points);
    return hull.length >= 3 ? [{ type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [[...hull, hull[0]]] }, properties: { threshold } }] : [];
  });
  return { type: "FeatureCollection", features };
}

function compareAreaFeatures(a: Float64Array, b: Float64Array, departure: number, stops: Stop[], limit: number): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  [[a, "a"], [b, "b"]].forEach(([times, owner]) => {
    const values = times as Float64Array;
    const hull = convexHull(stops.filter((_, index) => values[index] - departure <= limit * 60).map(stop => [stop.lon, stop.lat] as [number, number]));
    if (hull.length >= 3) features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...hull, hull[0]]] }, properties: { owner } });
  });
  return { type: "FeatureCollection", features };
}

function comparePointFeatures(a: Float64Array, b: Float64Array, departure: number, stops: Stop[], limit: number): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features = stops.flatMap((stop, index) => {
    const inA = a[index] - departure <= limit * 60, inB = b[index] - departure <= limit * 60;
    return inA || inB ? [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [stop.lon, stop.lat] }, properties: { owner: inA && inB ? "both" : inA ? "a" : "b" } }] : [];
  });
  return { type: "FeatureCollection", features };
}

function convexHull(points: Array<[number, number]>) {
  const sorted = [...new Map(points.map(point => [`${point[0]}:${point[1]}`, point])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length <= 2) return sorted;
  const cross = (origin: [number, number], a: [number, number], b: [number, number]) => (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
  const lower: Array<[number, number]> = [];
  for (const point of sorted) { while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop(); lower.push(point); }
  const upper: Array<[number, number]> = [];
  for (const point of [...sorted].reverse()) { while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop(); upper.push(point); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function shapeFeatures(schedule: ScheduleData, routes: Route[], patterns: Pattern[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const seen = new Set<string>();
  return { type: "FeatureCollection", features: patterns.flatMap(pattern => {
    if (!pattern[2] || seen.has(pattern[2]) || !schedule.shapes[pattern[2]]) return [];
    seen.add(pattern[2]);
    return [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: schedule.shapes[pattern[2]] }, properties: { color: `#${routes[pattern[0]].color}` } }];
  }) };
}

function lineStopFeatures(pattern: Pattern, stops: Stop[], route: Route): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: "FeatureCollection", features: pattern[3].map((stopIndex, sequence) => ({ type: "Feature", geometry: { type: "Point", coordinates: [stops[stopIndex].lon, stops[stopIndex].lat] }, properties: { index: stopIndex, sequence: sequence + 1, name: stops[stopIndex].name, color: `#${route.color}` } })) };
}

function ensureOverlayLayers(map: MapLibreMap) {
  for (const id of ["reach-area", "compare-area", "compare-stops", "reach-lines", "reachable", "plan", "line-view", "line-stops", "transfer-lines", "selected-stop"]) if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: EMPTY });
  if (!map.getLayer("reach-area-layer")) map.addLayer({ id: "reach-area-layer", type: "fill", source: "reach-area", paint: { "fill-color": ["match", ["get", "threshold"], 15, "#052b22", 30, "#00a968", "#efb126"], "fill-opacity": .11, "fill-outline-color": ["match", ["get", "threshold"], 15, "#052b22", 30, "#00a968", "#d89500"] } });
  if (!map.getLayer("compare-area-layer")) map.addLayer({ id: "compare-area-layer", type: "fill", source: "compare-area", paint: { "fill-color": ["match", ["get", "owner"], "a", "#00a968", "#d97706"], "fill-opacity": .16, "fill-outline-color": ["match", ["get", "owner"], "a", "#007f50", "#b45309"] } });
  if (!map.getLayer("reach-line-layer")) map.addLayer({ id: "reach-line-layer", type: "line", source: "reach-lines", paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2, 15, 4.5], "line-opacity": .62 } });
  if (!map.getLayer("reachable-layer")) map.addLayer({ id: "reachable-layer", type: "circle", source: "reachable", paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 15, 7], "circle-color": ["step", ["get", "time"], "#052b22", 15, "#00a968", 30, "#efb126"], "circle-stroke-color": "#fff", "circle-stroke-width": 1.5, "circle-opacity": .96 } });
  if (!map.getLayer("compare-stop-layer")) map.addLayer({ id: "compare-stop-layer", type: "circle", source: "compare-stops", paint: { "circle-radius": 5, "circle-color": ["match", ["get", "owner"], "a", "#00a968", "b", "#d97706", "#553c9a"], "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
  if (!map.getLayer("transfer-line-layer")) map.addLayer({ id: "transfer-line-layer", type: "line", source: "transfer-lines", paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": .3, "line-dasharray": [2, 2] } });
  if (!map.getLayer("plan-shadow")) map.addLayer({ id: "plan-shadow", type: "line", source: "plan", paint: { "line-color": "#fff", "line-width": 10, "line-opacity": .94 } });
  if (!map.getLayer("plan-ride-layer")) map.addLayer({ id: "plan-ride-layer", type: "line", source: "plan", filter: ["==", ["get", "kind"], "ride"], paint: { "line-color": ["get", "color"], "line-width": 6, "line-opacity": .95 } });
  if (!map.getLayer("plan-walk-layer")) map.addLayer({ id: "plan-walk-layer", type: "line", source: "plan", filter: ["==", ["get", "kind"], "walk"], paint: { "line-color": ["get", "color"], "line-width": 4, "line-dasharray": [2, 1.5], "line-opacity": .95 } });
  if (!map.getLayer("line-view-layer")) map.addLayer({ id: "line-view-layer", type: "line", source: "line-view", paint: { "line-color": ["get", "color"], "line-width": 7, "line-opacity": .92 } });
  if (!map.getLayer("line-stop-layer")) map.addLayer({ id: "line-stop-layer", type: "circle", source: "line-stops", paint: { "circle-radius": 7, "circle-color": "#fff", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 3 } });
  if (!map.getLayer("selected-stop-layer")) map.addLayer({ id: "selected-stop-layer", type: "circle", source: "selected-stop", paint: { "circle-radius": 12, "circle-color": "#fff", "circle-stroke-color": "#052b22", "circle-stroke-width": 5 } });
}

function stopGeoJson(stops: Stop[]): GeoJSON.FeatureCollection<GeoJSON.Point> { return { type: "FeatureCollection", features: stops.map((stop, index) => ({ type: "Feature", geometry: { type: "Point", coordinates: [stop.lon, stop.lat] }, properties: { ...stop, index } })) }; }
function pointFeature(lon: number, lat: number, properties: GeoJSON.GeoJsonProperties): GeoJSON.FeatureCollection<GeoJSON.Point> { return { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties }] }; }
function setSource(map: MapLibreMap | null, id: string, data: GeoJSON.GeoJSON) { (map?.getSource(id) as GeoJSONSource | undefined)?.setData(data); }
function toggleBaseStops(map: MapLibreMap, visible: boolean) { for (const id of ["clusters", "cluster-count", "stops"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none"); }
function fitFeatures(map: MapLibreMap, features: GeoJSON.FeatureCollection<GeoJSON.LineString>, padding: number) { fitCoordinates(map, features.features.flatMap(feature => feature.geometry.coordinates as Array<[number, number]>), padding); }
function fitCoordinates(map: MapLibreMap, coordinates: Array<[number, number]>, padding: number) { if (!coordinates.length) return; const bounds = coordinates.reduce((value, coordinate) => value.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0])); map.fitBounds(bounds, { padding, maxZoom: 15, duration: 650, essential: true }); }
function marker(letter: string, color: string) { const element = document.createElement("div"); element.className = "letterMarker"; element.textContent = letter; element.style.background = color; element.setAttribute("aria-label", letter === "A" ? "Začetna lokacija" : "Ciljna lokacija"); return new maplibregl.Marker({ element }); }
function toLocation(feature: PhotonFeature): Location { const properties = feature.properties; const street = [properties.street ?? properties.name, properties.housenumber].filter(Boolean).join(" "); return { name: [street, properties.postcode, properties.city].filter(Boolean).join(", "), lon: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] }; }
function parseTime(value: string) { const [hours, minutes] = value.split(":").map(Number); return hours * 3600 + minutes * 60; }
function formatTime(value: number) { const normalized = ((value % 86400) + 86400) % 86400; return `${String(Math.floor(normalized / 3600)).padStart(2, "0")}:${String(Math.floor((normalized % 3600) / 60)).padStart(2, "0")}`; }
function todayString() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`; }
function currentTimeString() { const now = new Date(); now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0); return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; }
function formatDate(value?: string) { if (!value) return "ni znano"; return new Intl.DateTimeFormat("sl-SI", { day: "numeric", month: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function addLocationParams(params: URLSearchParams, prefix: string, value: Location | null) { if (!value) return; params.set(`${prefix}lat`, value.lat.toFixed(6)); params.set(`${prefix}lon`, value.lon.toFixed(6)); params.set(`${prefix}name`, value.name); }
function locationFromParams(params: URLSearchParams, prefix: string): Location | null { const lat = Number(params.get(`${prefix}lat`)), lon = Number(params.get(`${prefix}lon`)), name = params.get(`${prefix}name`); return name && Number.isFinite(lat) && Number.isFinite(lon) ? { name, lat, lon } : null; }
