"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import {
  decodePolyline,
  fullTrip,
  geocodeSlovenia,
  modeLabel,
  planTrip,
  reachableFrom,
  selectedTransitModes,
  stopDepartures,
  type GeocodeMatch,
  type Itinerary,
  type PlannerPreferences,
  type ReachablePlace,
  type StopTime,
  type TransitLeg,
  type TransitMode,
  type TransitPlace,
} from "@/lib/transitous";

type AppMode = "reach" | "route" | "departures" | "compare";
type Target = "start" | "end";
type Status = "idle" | "loading" | "error";

const REACH_TIMES = [30, 60, 90, 180] as const;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const DEFAULT_PREFS: PlannerPreferences = { bus: true, train: true, other: true, wheelchair: false, bikeOnBoard: false };
const SLOVENIA_BOUNDS: [[number, number], [number, number]] = [[13.32, 45.40], [16.62, 46.88]];

export default function SloveniaExplorer() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const startMarker = useRef<Marker | null>(null);
  const endMarker = useRef<Marker | null>(null);
  const [mode, setMode] = useState<AppMode>("route");
  const [target, setTarget] = useState<Target>("start");
  const [start, setStart] = useState<TransitPlace | null>(null);
  const [end, setEnd] = useState<TransitPlace | null>(null);
  const [startQuery, setStartQuery] = useState("");
  const [endQuery, setEndQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodeMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [date, setDate] = useState(todayString());
  const [time, setTime] = useState(currentTimeString());
  const [arriveBy, setArriveBy] = useState(false);
  const [minutes, setMinutes] = useState<(typeof REACH_TIMES)[number]>(60);
  const [preferences, setPreferences] = useState(DEFAULT_PREFS);
  const [status, setStatus] = useState<Status>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [reachables, setReachables] = useState<ReachablePlace[]>([]);
  const [compareA, setCompareA] = useState<ReachablePlace[]>([]);
  const [compareB, setCompareB] = useState<ReachablePlace[]>([]);
  const [itineraries, setItineraries] = useState<Itinerary[]>([]);
  const [activeJourney, setActiveJourney] = useState<Itinerary | null>(null);
  const [activeReach, setActiveReach] = useState<ReachablePlace | null>(null);
  const [departures, setDepartures] = useState<StopTime[]>([]);
  const [activeDeparture, setActiveDeparture] = useState<StopTime | null>(null);
  const [activeTrip, setActiveTrip] = useState<Itinerary | null>(null);
  const [mapError, setMapError] = useState("");
  const [highContrast, setHighContrast] = useState(false);
  const [savedHome, setSavedHome] = useState<TransitPlace | null>(null);
  const [shareMessage, setShareMessage] = useState("");

  const modeRef = useRef(mode);
  const targetRef = useRef(target);
  const reachablesRef = useRef(reachables);
  modeRef.current = mode;
  targetRef.current = target;
  reachablesRef.current = reachables;

  useEffect(() => {
    const saved = localStorage.getItem("doseg-slovenija-home");
    if (saved) try { setSavedHome(JSON.parse(saved)); } catch { localStorage.removeItem("doseg-slovenija-home"); }
    const params = new URLSearchParams(location.search);
    const sharedMode = params.get("mode") as AppMode | null;
    if (sharedMode && ["reach", "route", "departures", "compare"].includes(sharedMode)) setMode(sharedMode);
    if (params.get("date")) setDate(params.get("date")!);
    if (params.get("time")) setTime(params.get("time")!);
    const sharedMinutes = Number(params.get("minutes"));
    if (REACH_TIMES.includes(sharedMinutes as (typeof REACH_TIMES)[number])) setMinutes(sharedMinutes as (typeof REACH_TIMES)[number]);
    const sharedStart = placeFromParams(params, "a");
    const sharedEnd = placeFromParams(params, "b");
    if (sharedStart) { setStart(sharedStart); setStartQuery(sharedStart.name); }
    if (sharedEnd) { setEnd(sharedEnd); setEndQuery(sharedEnd.name); }
  }, []);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    try {
      const map = new maplibregl.Map({
        container: mapNode.current,
        style: {
          version: 8,
          sources: {
            carto: {
              type: "raster",
              tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors © CARTO",
            },
          },
          layers: [{ id: "carto", type: "raster", source: "carto" }],
        },
        center: [14.92, 46.12],
        zoom: 7.35,
        minZoom: 6.5,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
      mapRef.current = map;
      map.once("load", () => ensureMapLayers(map));
      setMapError("");
      return () => { map.remove(); mapRef.current = null; };
    } catch {
      setMapError("Ta brskalnik ne podpira izrisa zemljevida. Iskanje povezav in vozni red kljub temu delujeta.");
    }
  }, []);

  const place = useCallback((which: Target, value: TransitPlace) => {
    setSuggestions([]);
    setSearchMessage("");
    setStatusMessage("");
    if (which === "start") {
      setStart(value);
      setStartQuery(value.name);
      if (modeRef.current === "route" || modeRef.current === "compare") setTarget("end");
    } else {
      setEnd(value);
      setEndQuery(value.name);
    }
    const map = mapRef.current;
    if (map) map.flyTo({ center: [value.lon, value.lat], zoom: modeRef.current === "departures" ? 13.5 : 11.5, essential: true });
  }, []);

  useEffect(() => {
    const query = target === "start" ? startQuery : endQuery;
    const selected = target === "start" ? start : end;
    if (selected?.name === query || query.trim().length < 3) {
      setSuggestions([]);
      setSearchMessage("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchMessage("");
      try {
        const values = await geocodeSlovenia(query, controller.signal);
        setSuggestions(values);
        if (!values.length) setSearchMessage("V Sloveniji ni zadetkov. Lokacijo lahko izbereš na zemljevidu.");
      } catch (error) {
        if (!isAbort(error)) setSearchMessage("Iskanje naslovov trenutno ni dosegljivo. Lokacijo izberi na zemljevidu.");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 420);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [target, startQuery, endQuery, start, end]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    startMarker.current?.remove();
    endMarker.current?.remove();
    startMarker.current = start ? letterMarker("A", "#072d24").setLngLat([start.lon, start.lat]).addTo(map) : null;
    endMarker.current = end ? letterMarker("B", "#c96618").setLngLat([end.lon, end.lat]).addTo(map) : null;
  }, [start, end]);

  const openReachDestination = useCallback(async (reachable: ReachablePlace) => {
    if (!start) return;
    setActiveReach(reachable);
    setStatus("loading");
    setStatusMessage(`Iščem najboljšo povezavo do ${reachable.place.name} …`);
    try {
      const response = await planTrip(start, reachable.place, date, time, false, preferences);
      const journey = response.itineraries[0] ?? response.direct[0];
      if (!journey) throw new Error("Za izbrano postajališče ni bilo mogoče sestaviti podrobne povezave.");
      setActiveJourney(journey);
      setStatus("idle");
      setStatusMessage("");
    } catch (error) {
      setStatus("error");
      setStatusMessage(humanError(error));
    }
  }, [start, date, time, preferences]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (event: maplibregl.MapMouseEvent) => {
      if (map.getLayer("reachable-points")) {
        const hit = map.queryRenderedFeatures(event.point, { layers: ["reachable-points"] })[0];
        if (hit && modeRef.current === "reach") {
          const reachable = reachablesRef.current[Number(hit.properties?.index)];
          if (reachable) void openReachDestination(reachable);
          return;
        }
      }
      const value: TransitPlace = { name: "Izbrana točka na zemljevidu", lat: event.lngLat.lat, lon: event.lngLat.lng };
      if (modeRef.current === "departures") place("start", value);
      else place(targetRef.current, value);
    };
    map.on("click", onClick);
    return () => { map.off("click", onClick); };
  }, [place, openReachDestination]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const render = () => {
      ensureMapLayers(map);
      for (const id of ["reach", "compare", "plan", "trip", "selected"]) setSource(map, id, EMPTY);
      if (mode === "reach" && activeJourney) {
        const features = itineraryFeatures(activeJourney);
        setSource(map, "plan", features);
        fitFeatureCollection(map, features);
      } else if (mode === "reach" && reachables.length) {
        setSource(map, "reach", reachableFeatures(reachables, minutes));
      } else if (mode === "route" && activeJourney) {
        const features = itineraryFeatures(activeJourney);
        setSource(map, "plan", features);
        fitFeatureCollection(map, features);
      } else if (mode === "departures" && activeTrip) {
        const features = itineraryFeatures(activeTrip);
        setSource(map, "trip", features);
        fitFeatureCollection(map, features);
      } else if (mode === "compare" && (compareA.length || compareB.length)) {
        setSource(map, "compare", compareFeatures(compareA, compareB));
      }
    };
    map.isStyleLoaded() ? render() : map.once("load", render);
  }, [mode, reachables, minutes, activeJourney, activeTrip, compareA, compareB]);

  const resetResults = useCallback(() => {
    setReachables([]);
    setCompareA([]);
    setCompareB([]);
    setItineraries([]);
    setActiveJourney(null);
    setActiveReach(null);
    setDepartures([]);
    setActiveDeparture(null);
    setActiveTrip(null);
    setStatus("idle");
    setStatusMessage("");
  }, []);

  const updateQuery = (which: Target, value: string) => {
    setTarget(which);
    setSearchMessage("");
    if (which === "start") {
      setStartQuery(value);
      if (start?.name !== value) setStart(null);
    } else {
      setEndQuery(value);
      if (end?.name !== value) setEnd(null);
    }
    resetResults();
  };

  const switchMode = (value: AppMode) => {
    setMode(value);
    setTarget("start");
    resetResults();
    if (value === "departures") setEnd(null);
  };

  const executeReach = async (overrideMinutes = minutes) => {
    if (!start) { setStatus("error"); setStatusMessage("Najprej vpiši ali izberi začetno lokacijo."); return; }
    setActiveJourney(null);
    setActiveReach(null);
    setStatus("loading");
    setStatusMessage("Računam doseg po vsej Sloveniji …");
    try {
      const response = await reachableFrom(start, date, time, overrideMinutes, preferences);
      const values = normalizeReachables(response.all);
      setReachables(values);
      setStatus("idle");
      setStatusMessage(values.length ? "" : "V izbranem času ni dosegljivih postajališč.");
      fitReachables(mapRef.current, start, values);
    } catch (error) {
      setStatus("error");
      setStatusMessage(humanError(error));
    }
  };

  const executeRoute = async () => {
    if (!start || !end) { setStatus("error"); setStatusMessage("Vpiši začetno in končno lokacijo."); return; }
    setStatus("loading");
    setStatusMessage("Iščem povezave med vsemi slovenskimi prevozniki …");
    setActiveJourney(null);
    try {
      const response = await planTrip(start, end, date, time, arriveBy, preferences);
      const values = [...response.itineraries];
      if (!values.length && response.direct.length) values.push(...response.direct);
      if (!values.length) throw new Error("V izbranem časovnem oknu ni bilo najdene povezave.");
      setItineraries(values);
      setActiveJourney(values[0]);
      setStatus("idle");
      setStatusMessage("");
    } catch (error) {
      setItineraries([]);
      setStatus("error");
      setStatusMessage(humanError(error));
    }
  };

  const executeDepartures = async () => {
    if (!start) { setStatus("error"); setStatusMessage("Vpiši postajo, naslov ali izberi točko na zemljevidu."); return; }
    setStatus("loading");
    setStatusMessage("Iščem odhode na postajališčih v bližini …");
    setActiveTrip(null);
    setActiveDeparture(null);
    try {
      const response = await stopDepartures(start, date, time, preferences);
      const values = normalizeDepartures(response.stopTimes, start);
      setDepartures(values);
      setStatus("idle");
      setStatusMessage(values.length ? "" : "Ni najdenih prihodnjih odhodov.");
    } catch (error) {
      setDepartures([]);
      setStatus("error");
      setStatusMessage(humanError(error));
    }
  };

  const openDeparture = async (departure: StopTime) => {
    setActiveDeparture(departure);
    setStatus("loading");
    setStatusMessage(`Nalagam celotno vožnjo ${departure.routeShortName || departure.displayName} …`);
    try {
      setActiveTrip(selectTripRun(await fullTrip(departure.tripId), departure.tripId));
      setStatus("idle");
      setStatusMessage("");
    } catch (error) {
      setStatus("error");
      setStatusMessage(humanError(error));
    }
  };

  const executeCompare = async () => {
    if (!start || !end) { setStatus("error"); setStatusMessage("Za primerjavo vpiši obe lokaciji."); return; }
    setStatus("loading");
    setStatusMessage("Primerjam nacionalno dosegljivost obeh lokacij …");
    try {
      const [a, b] = await Promise.all([
        reachableFrom(start, date, time, minutes, preferences),
        reachableFrom(end, date, time, minutes, preferences),
      ]);
      setCompareA(normalizeReachables(a.all));
      setCompareB(normalizeReachables(b.all));
      setStatus("idle");
      setStatusMessage("");
      mapRef.current?.fitBounds(SLOVENIA_BOUNDS, { padding: 30, duration: 700 });
    } catch (error) {
      setStatus("error");
      setStatusMessage(humanError(error));
    }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setStatus("error"); setStatusMessage("Brskalnik ne podpira trenutne lokacije."); return; }
    setStatus("loading");
    setStatusMessage("Pridobivam trenutno lokacijo …");
    navigator.geolocation.getCurrentPosition(position => {
      place(target, { name: "Moja trenutna lokacija", lat: position.coords.latitude, lon: position.coords.longitude });
      setStatus("idle");
      setStatusMessage("");
    }, () => {
      setStatus("error");
      setStatusMessage("Dostop do lokacije ni bil dovoljen.");
    }, { enableHighAccuracy: true, timeout: 12_000 });
  };

  const saveHome = () => {
    if (!start) return;
    localStorage.setItem("doseg-slovenija-home", JSON.stringify(start));
    setSavedHome(start);
  };

  const share = async () => {
    const params = new URLSearchParams({ mode, date, time, minutes: String(minutes) });
    addPlaceParams(params, "a", start);
    addPlaceParams(params, "b", end);
    const url = `${location.origin}${location.pathname}?${params}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage("Povezava je kopirana.");
    } catch {
      setShareMessage(url);
    }
    window.setTimeout(() => setShareMessage(""), 3500);
  };

  const reachableByDistance = useMemo(() => {
    if (!start) return [];
    const sorted = [...reachables]
      .map(item => ({ ...item, distance: distanceKm(start, item.place) }))
      .sort((a, b) => b.distance - a.distance);
    return sorted.filter((item, index, values) => {
      const name = item.place.name.toLocaleLowerCase("sl").replace(/\s+/g, " ").trim();
      return !values.slice(0, index).some(previous =>
        previous.place.name.toLocaleLowerCase("sl").replace(/\s+/g, " ").trim() === name
        && distanceKm(previous.place, item.place) < 0.6
      );
    }).slice(0, 12);
  }, [reachables, start]);
  const optionLabels = useMemo(() => labelItineraries(itineraries), [itineraries]);
  const commonCompare = useMemo(() => compareOverlap(compareA, compareB), [compareA, compareB]);

  return (
    <main className={highContrast ? "contrast" : ""}>
      <a className="skipLink" href="#content">Preskoči na vsebino</a>
      <aside className="panel" id="content">
        <div className="appPanel">
          <header className="appHeader">
            <div className="brand"><span className="brandMark">S</span><span><strong>Doseg Slovenija</strong><small>Vsi javni prevozi na enem mestu</small></span></div>
            <button className="iconButton" type="button" onClick={() => setHighContrast(value => !value)} aria-label="Preklopi visok kontrast" title="Visok kontrast">◐</button>
          </header>

          <nav className="tabs" aria-label="Način uporabe">
            <button className={mode === "reach" ? "active" : ""} onClick={() => switchMode("reach")}>Doseg</button>
            <button className={mode === "route" ? "active" : ""} onClick={() => switchMode("route")}>Pot A–B</button>
            <button className={mode === "departures" ? "active" : ""} onClick={() => switchMode("departures")}>Odhodi</button>
            <button className={mode === "compare" ? "active" : ""} onClick={() => switchMode("compare")}>Primerjaj</button>
          </nav>

          {mode === "reach" && <ReachPanel
            start={start} query={startQuery} setQuery={value => updateQuery("start", value)} setTarget={setTarget}
            date={date} setDate={setDate} time={time} setTime={setTime}
            minutes={minutes} setMinutes={value => { setMinutes(value); if (start && reachables.length) void executeReach(value); }}
            preferences={preferences} setPreferences={setPreferences}
            status={status} statusMessage={statusMessage} reachables={reachables}
            destinations={reachableByDistance} activeJourney={activeJourney} activeReach={activeReach}
            execute={() => void executeReach()} choose={value => void openReachDestination(value)} back={() => { setActiveJourney(null); setActiveReach(null); }}
          />}

          {mode === "route" && <RoutePanel
            start={start} end={end} startQuery={startQuery} endQuery={endQuery}
            setStartQuery={value => updateQuery("start", value)} setEndQuery={value => updateQuery("end", value)} setTarget={setTarget}
            swap={() => { setStart(end); setStartQuery(end?.name ?? ""); setEnd(start); setEndQuery(start?.name ?? ""); }}
            date={date} setDate={setDate} time={time} setTime={setTime} arriveBy={arriveBy} setArriveBy={setArriveBy}
            preferences={preferences} setPreferences={setPreferences} execute={() => void executeRoute()}
            status={status} statusMessage={statusMessage} itineraries={itineraries} activeJourney={activeJourney}
            labels={optionLabels} choose={setActiveJourney}
          />}

          {mode === "departures" && <DeparturesPanel
            place={start} query={startQuery} setQuery={value => updateQuery("start", value)} setTarget={setTarget}
            date={date} setDate={setDate} time={time} setTime={setTime}
            preferences={preferences} setPreferences={setPreferences}
            execute={() => void executeDepartures()} status={status} statusMessage={statusMessage}
            departures={departures} activeDeparture={activeDeparture} activeTrip={activeTrip}
            choose={value => void openDeparture(value)} back={() => { setActiveDeparture(null); setActiveTrip(null); }}
          />}

          {mode === "compare" && <ComparePanel
            start={start} end={end} startQuery={startQuery} endQuery={endQuery}
            setStartQuery={value => updateQuery("start", value)} setEndQuery={value => updateQuery("end", value)} setTarget={setTarget}
            date={date} setDate={setDate} time={time} setTime={setTime}
            minutes={minutes} setMinutes={setMinutes} preferences={preferences} setPreferences={setPreferences}
            execute={() => void executeCompare()} status={status} statusMessage={statusMessage}
            a={compareA} b={compareB} common={commonCompare}
          />}

          {(suggestions.length > 0 || searching || searchMessage) && <SearchResults
            values={suggestions} searching={searching} message={searchMessage}
            choose={value => place(target, matchToPlace(value))}
          />}

          <div className="quickActions">
            <button type="button" onClick={useCurrentLocation}>◎ Moja lokacija</button>
            {savedHome && <button type="button" onClick={() => place(target, savedHome)}>⌂ Domov</button>}
            {start && <button type="button" onClick={saveHome}>☆ Shrani A kot dom</button>}
            <button type="button" onClick={() => void share()}>↗ Deli pogled</button>
          </div>
          {shareMessage && <p className="microMessage" role="status">{shareMessage}</p>}

          <footer className="source">
            <strong>Naslovi: uradni Register naslovov GURS · Prevozi: NAP in odprti GTFS viri prek Transitous/MOTIS</strong>
            <span>Medkrajevni in mestni avtobusi, potniški vlaki ter drugi razpoložljivi JPP. Zemljevid: OpenStreetMap in CARTO.</span>
            <a href="https://transitous.org/sources/#slovenia" target="_blank" rel="noreferrer">Preglej uporabljene vire ↗</a>
            <details><summary>Točnost, zasebnost in podatki v živo</summary><p>Načrtovalnik uporablja objavljene vozne rede in tiste realnočasovne podatke, ki jih posamezni vir zagotavlja. Oznaka »v živo« je prikazana le na odseku z dejanskim realnočasovnim podatkom. Iskalni niz se pošlje GURS in Transitousu, izbrani koordinati pa načrtovalniku Transitous; aplikacija jih sama ne shranjuje, razen domače lokacije lokalno v tvojem brskalniku.</p></details>
          </footer>
        </div>
      </aside>

      <section className="mapWrap" aria-label="Zemljevid javnega prevoza Slovenije">
        <div ref={mapNode} className="map" />
        {mapError && <div className="mapFallback"><span>⌁</span><strong>Zemljevid ni na voljo</strong><p>{mapError}</p></div>}
        <div className="mapHint">{mapHint(mode, target)}</div>
        <MapLegend mode={mode} minutes={minutes} hasResults={Boolean(reachables.length || compareA.length || activeJourney || activeTrip)} />
      </section>
    </main>
  );
}

type LocationProps = {
  value: TransitPlace | null;
  query: string;
  setQuery: (value: string) => void;
  setTarget: (value: Target) => void;
  which: Target;
  label: string;
};

function LocationField({ value, query, setQuery, setTarget, which, label }: LocationProps) {
  return <><div className={`locationField ${value ? "selected" : ""}`} onClick={() => setTarget(which)}>
    <span>{which === "start" ? "A" : "B"}</span>
    <label><small>{label}</small><input aria-label={label} value={query} placeholder="Npr. Radohova vas 9" onFocus={() => setTarget(which)} onChange={event => setQuery(event.target.value)} autoComplete="off" /></label>
  </div>{query.length >= 3 && !value && <p className="addressHelp">Izberi točen naslov, kraj ali postajo s seznama rezultatov.</p>}</>;
}

type DateTimeProps = { date: string; setDate: (value: string) => void; time: string; setTime: (value: string) => void };
function DateTimeControls({ date, setDate, time, setTime }: DateTimeProps) {
  return <div className="controls"><label>Datum<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><label>Čas<input type="time" value={time} onChange={event => setTime(event.target.value)} /></label></div>;
}

function TransportPreferences({ value, setValue }: { value: PlannerPreferences; setValue: (value: PlannerPreferences) => void }) {
  const toggle = (key: keyof PlannerPreferences) => setValue({ ...value, [key]: !value[key] });
  return <details className="preferences"><summary>Vrste prevoza in dostopnost</summary>
    <div className="modeChips">
      <button type="button" className={value.bus ? "active" : ""} onClick={() => toggle("bus")}>🚌 Avtobusi</button>
      <button type="button" className={value.train ? "active" : ""} onClick={() => toggle("train")}>🚆 Vlaki</button>
      <button type="button" className={value.other ? "active" : ""} onClick={() => toggle("other")}>⛴ Drugi JPP</button>
      <button type="button" className={value.wheelchair ? "active" : ""} onClick={() => toggle("wheelchair")}>♿ Brez ovir</button>
      <button type="button" className={value.bikeOnBoard ? "active" : ""} onClick={() => toggle("bikeOnBoard")}>🚲 Kolo na vozilu</button>
    </div>
    {!selectedTransitModes(value).length && <p className="warningText">Izberi vsaj eno vrsto javnega prevoza.</p>}
  </details>;
}

function StatusBox({ status, message }: { status: Status; message: string }) {
  if (!message) return null;
  return <div className={`statusBox ${status}`} role="status">{status === "loading" && <span className="spinner" />}{message}</div>;
}

type ReachPanelProps = DateTimeProps & {
  start: TransitPlace | null; query: string; setQuery: (value: string) => void; setTarget: (value: Target) => void;
  minutes: (typeof REACH_TIMES)[number]; setMinutes: (value: (typeof REACH_TIMES)[number]) => void;
  preferences: PlannerPreferences; setPreferences: (value: PlannerPreferences) => void;
  status: Status; statusMessage: string; reachables: ReachablePlace[];
  destinations: Array<ReachablePlace & { distance: number }>;
  activeJourney: Itinerary | null; activeReach: ReachablePlace | null;
  execute: () => void; choose: (value: ReachablePlace) => void; back: () => void;
};

function ReachPanel(props: ReachPanelProps) {
  if (props.activeJourney) return <>
    <button className="backButton" onClick={props.back}>← Nazaj na vsa dosegljiva postajališča</button>
    <span className="eyebrow">Izbrani cilj</span><h1>{props.activeReach?.place.name}</h1>
    <JourneyCard journey={props.activeJourney} />
  </>;
  return <>
    <span className="eyebrow">Nacionalna dostopnost</span><h1>Kam lahko prideš po Sloveniji?</h1>
    <p className="intro">Vpiši začetek in preveri avtobuse, vlake ter prestope, ki jih ujameš v izbranem času.</p>
    <LocationField value={props.start} query={props.query} setQuery={props.setQuery} setTarget={props.setTarget} which="start" label="Začetek" />
    <DateTimeControls {...props} />
    <TransportPreferences value={props.preferences} setValue={props.setPreferences} />
    <div className="timeButtons four" aria-label="Najdaljši čas poti">{REACH_TIMES.map(value => <button type="button" key={value} className={props.minutes === value ? "active" : ""} onClick={() => props.setMinutes(value)}><strong>{value}</strong><small> min</small></button>)}</div>
    <button className="primary" disabled={props.status === "loading" || !selectedTransitModes(props.preferences).length} onClick={props.execute}>{props.status === "loading" ? "Računam …" : "Izračunaj doseg"}</button>
    <StatusBox status={props.status} message={props.statusMessage} />
    {props.reachables.length > 0 && <>
      <div className="summary focus"><span className="summaryIcon">↗</span><div><strong>{props.reachables.length.toLocaleString("sl-SI")} dosegljivih postajališč</strong><p>Izberi krog na zemljevidu ali cilj spodaj za točno pot in vozni red.</p></div></div>
      <div className="sectionHeading"><h2>Najdlje po razdalji</h2><small>znotraj {props.minutes} min</small></div>
      <div className="destinationList">{props.destinations.map((item, index) => <button type="button" key={`${item.place.stopId ?? item.place.name}-${index}`} onClick={() => props.choose(item)}><span><small>{formatModes(item.place.modes)}</small>{item.place.name}</span><strong>{item.distance.toFixed(0)} km · {Math.round(item.duration)} min</strong></button>)}</div>
    </>}
  </>;
}

type RoutePanelProps = DateTimeProps & {
  start: TransitPlace | null; end: TransitPlace | null; startQuery: string; endQuery: string;
  setStartQuery: (value: string) => void; setEndQuery: (value: string) => void; setTarget: (value: Target) => void; swap: () => void;
  arriveBy: boolean; setArriveBy: (value: boolean) => void;
  preferences: PlannerPreferences; setPreferences: (value: PlannerPreferences) => void;
  execute: () => void; status: Status; statusMessage: string; itineraries: Itinerary[]; activeJourney: Itinerary | null;
  labels: Map<Itinerary, string>; choose: (value: Itinerary) => void;
};

function RoutePanel(props: RoutePanelProps) {
  return <>
    <span className="eyebrow">Od doma do cilja</span><h1>Načrtuj pot od vrat do vrat</h1>
    <p className="intro">Vpiši hišni naslov kjer koli v Sloveniji. V načrt poti vključimo hojo do prve postaje, vse vožnje in hojo do končnega cilja.</p>
    <LocationField value={props.start} query={props.startQuery} setQuery={props.setStartQuery} setTarget={props.setTarget} which="start" label="Začetek" />
    <button type="button" className="swapButton" onClick={props.swap}>⇅ Zamenjaj A in B</button>
    <LocationField value={props.end} query={props.endQuery} setQuery={props.setEndQuery} setTarget={props.setTarget} which="end" label="Cilj" />
    <DateTimeControls {...props} />
    <div className="segmented"><button type="button" className={!props.arriveBy ? "active" : ""} onClick={() => props.setArriveBy(false)}>Odhod ob</button><button type="button" className={props.arriveBy ? "active" : ""} onClick={() => props.setArriveBy(true)}>Prihod do</button></div>
    <TransportPreferences value={props.preferences} setValue={props.setPreferences} />
    <button className="primary" disabled={props.status === "loading" || !props.start || !props.end || !selectedTransitModes(props.preferences).length} onClick={props.execute}>{props.status === "loading" ? "Iščem …" : "Poišči povezave"}</button>
    <StatusBox status={props.status} message={props.statusMessage} />
    {props.itineraries.length > 0 && <>
      <div className="sectionHeading"><h2>Predlagane povezave</h2><small>{props.itineraries.length} možnosti</small></div>
      <div className="journeyOptions">{props.itineraries.map((journey, index) => <JourneyOption key={journey.id || index} journey={journey} active={props.activeJourney === journey} label={props.labels.get(journey) ?? "Povezava"} choose={() => props.choose(journey)} />)}</div>
    </>}
    {props.activeJourney && <JourneyCard journey={props.activeJourney} />}
  </>;
}

type DeparturesPanelProps = DateTimeProps & {
  place: TransitPlace | null; query: string; setQuery: (value: string) => void; setTarget: (value: Target) => void;
  preferences: PlannerPreferences; setPreferences: (value: PlannerPreferences) => void;
  execute: () => void; status: Status; statusMessage: string; departures: StopTime[];
  activeDeparture: StopTime | null; activeTrip: Itinerary | null; choose: (value: StopTime) => void; back: () => void;
};

function DeparturesPanel(props: DeparturesPanelProps) {
  if (props.activeTrip && props.activeDeparture) return <>
    <button className="backButton" onClick={props.back}>← Nazaj na odhode v bližini</button>
    <span className="eyebrow">Celotna izbrana vožnja</span><h1>{props.activeDeparture.routeShortName || props.activeDeparture.displayName} proti {props.activeDeparture.headsign}</h1>
    <JourneyCard journey={props.activeTrip} fullTrip />
  </>;
  return <>
    <span className="eyebrow">Postajna tabla in linije</span><h1>Odhodi v tvoji bližini</h1>
    <p className="intro">Izberi postajo ali naslov. Pokažemo vse bližnje linije; klik na odhod izriše celotno vožnjo in postanke.</p>
    <LocationField value={props.place} query={props.query} setQuery={props.setQuery} setTarget={props.setTarget} which="start" label="Postaja ali lokacija" />
    <DateTimeControls {...props} />
    <TransportPreferences value={props.preferences} setValue={props.setPreferences} />
    <button className="primary" disabled={props.status === "loading" || !selectedTransitModes(props.preferences).length} onClick={props.execute}>{props.status === "loading" ? "Nalagam …" : "Pokaži odhode"}</button>
    <StatusBox status={props.status} message={props.statusMessage} />
    {props.departures.length > 0 && <><div className="sectionHeading"><h2>Naslednji odhodi</h2><small>do 500 m stran · največ 40 voženj</small></div><div className="departureBoard">{props.departures.map((departure, index) => <button key={`${departure.tripId}-${index}`} type="button" onClick={() => props.choose(departure)}>
      <time>{formatTime(departure.place.departure ?? departure.place.scheduledDeparture)}</time>
      <RouteBadge leg={{ mode: departure.mode, routeShortName: departure.routeShortName, routeColor: undefined } as TransitLeg} />
      <span><strong>{departure.headsign || departure.tripTo.name}</strong><small>{departure.place.name} · {departure.agencyName}{departure.realTime ? " · v živo" : ""}</small></span><b>›</b>
    </button>)}</div></>}
  </>;
}

type ComparePanelProps = DateTimeProps & {
  start: TransitPlace | null; end: TransitPlace | null; startQuery: string; endQuery: string;
  setStartQuery: (value: string) => void; setEndQuery: (value: string) => void; setTarget: (value: Target) => void;
  minutes: (typeof REACH_TIMES)[number]; setMinutes: (value: (typeof REACH_TIMES)[number]) => void;
  preferences: PlannerPreferences; setPreferences: (value: PlannerPreferences) => void;
  execute: () => void; status: Status; statusMessage: string; a: ReachablePlace[]; b: ReachablePlace[]; common: number;
};

function ComparePanel(props: ComparePanelProps) {
  return <>
    <span className="eyebrow">Primerjava lokacij</span><h1>Katera lokacija je bolje povezana?</h1>
    <LocationField value={props.start} query={props.startQuery} setQuery={props.setStartQuery} setTarget={props.setTarget} which="start" label="Lokacija A" />
    <LocationField value={props.end} query={props.endQuery} setQuery={props.setEndQuery} setTarget={props.setTarget} which="end" label="Lokacija B" />
    <DateTimeControls {...props} />
    <div className="timeButtons four">{REACH_TIMES.map(value => <button type="button" key={value} className={props.minutes === value ? "active" : ""} onClick={() => props.setMinutes(value)}><strong>{value}</strong><small> min</small></button>)}</div>
    <TransportPreferences value={props.preferences} setValue={props.setPreferences} />
    <button className="primary" disabled={props.status === "loading" || !selectedTransitModes(props.preferences).length} onClick={props.execute}>{props.status === "loading" ? "Primerjam …" : "Primerjaj doseg"}</button>
    <StatusBox status={props.status} message={props.statusMessage} />
    {(props.a.length > 0 || props.b.length > 0) && <div className="comparison"><div className="compareCard a"><span>A</span><strong>{props.a.length}</strong><small>dosegljivih postajališč</small></div><div className="compareCard b"><span>B</span><strong>{props.b.length}</strong><small>dosegljivih postajališč</small></div><div className="comparisonResult"><strong>{props.a.length === props.b.length ? "Lokaciji sta izenačeni" : props.a.length > props.b.length ? "Lokacija A ima širši doseg" : "Lokacija B ima širši doseg"}</strong><p>{props.common} postajališč je dosegljivih z obeh lokacij v največ {props.minutes} minutah.</p></div></div>}
  </>;
}

function SearchResults({ values, searching, message, choose }: { values: GeocodeMatch[]; searching: boolean; message: string; choose: (value: GeocodeMatch) => void }) {
  return <div className="searchResults" role="listbox">{searching && <p>Iščem po uradnih naslovih in postajah …</p>}{message && <p>{message}</p>}{values.map(value => <button type="button" key={value.id || `${value.name}-${value.lat}-${value.lon}`} onClick={() => choose(value)}><strong>{value.name}</strong><small>{placeSubtitle(value)}</small></button>)}</div>;
}

function JourneyOption({ journey, active, label, choose }: { journey: Itinerary; active: boolean; label: string; choose: () => void }) {
  const stats = itineraryStats(journey);
  return <button type="button" className={`journeyOption ${active ? "active" : ""}`} onClick={choose}>
    <span className="optionTop"><small className="optionLabel">{label}</small><strong>{Math.round(journey.duration / 60)} min</strong><small>{formatTime(journey.startTime)}–{formatTime(journey.endTime)}</small></span>
    <span className="optionRoute">{transitLegs(journey).slice(0, 4).map((leg, index) => <RouteBadge key={`${leg.tripId}-${index}`} leg={leg} />)}<span className="chevron">›</span></span>
    <span className="optionStats"><span>{transferLabel(journey.transfers)}</span><span>{Math.round(stats.walkMinutes)} min hoje</span><span>{stats.realtime ? "delno v živo" : "vozni red"}</span></span>
  </button>;
}

function JourneyCard({ journey, fullTrip = false }: { journey: Itinerary; fullTrip?: boolean }) {
  const stats = itineraryStats(journey);
  return <article className="journeyCard">
    <header className="journeyHead"><div><small>{fullTrip ? "Celotna vožnja" : "Načrt potovanja"}</small><strong>{Math.round(journey.duration / 60)} min</strong><small>{formatTime(journey.startTime)}–{formatTime(journey.endTime)}</small></div><div className="journeyMetrics"><span>{transferLabel(journey.transfers)}</span><span>{Math.round(stats.walkMinutes)} min hoje</span>{stats.realtime && <span className="livePill">● v živo</span>}</div></header>
    <div className="timeline">{journey.legs.map((leg, index) => <JourneyLeg key={`${leg.tripId ?? leg.mode}-${index}`} leg={leg} />)}</div>
  </article>;
}

function JourneyLeg({ leg }: { leg: TransitLeg }) {
  const walking = leg.mode === "WALK";
  const allStops = [leg.from, ...(leg.intermediateStops ?? []), leg.to].filter((stop, index, values) => index === 0 || stop.name !== values[index - 1].name || stop.arrival !== values[index - 1].arrival);
  return <section className={`step ${walking ? "walk" : "ride"}`}>
    {walking ? <i>↟</i> : <RouteBadge leg={leg} />}
    <div className="stepBody"><p>{walking ? `${Math.max(1, Math.round(leg.duration / 60))} min hoje` : `${leg.routeShortName || leg.displayName || modeLabel(leg.mode)} proti ${leg.headsign || leg.to.name}`}</p>
      <small>{leg.from.name} → {leg.to.name}{leg.agencyName ? ` · ${leg.agencyName}` : ""}{leg.realTime ? " · podatki v živo" : ""}</small>
      {!walking && <details className="tripSchedule" open><summary>{allStops.length} postankov · celoten vozni red</summary><div>{allStops.map((stop, index) => <div className="scheduleRow" key={`${stop.stopId ?? stop.name}-${index}`}><time>{formatTime(stop.departure ?? stop.arrival ?? (index === 0 ? leg.startTime : index === allStops.length - 1 ? leg.endTime : undefined))}</time><span>{stop.name}{stop.track ? ` · tir/peron ${stop.track}` : ""}</span></div>)}</div></details>}
    </div>
  </section>;
}

function RouteBadge({ leg }: { leg: Pick<TransitLeg, "mode" | "routeShortName" | "displayName" | "routeColor" | "routeTextColor"> }) {
  const background = safeColor(leg.routeColor, modeColor(leg.mode));
  const color = safeColor(leg.routeTextColor, contrastText(background));
  return <i className="routeBadge" style={{ background, color }} title={modeLabel(leg.mode)}>{leg.routeShortName || leg.displayName || modeSymbol(leg.mode)}</i>;
}

function MapLegend({ mode, minutes, hasResults }: { mode: AppMode; minutes: number; hasResults: boolean }) {
  if (!hasResults) return null;
  if (mode === "reach") return <div className="mapLegend"><span><i className="band1" />0–⅓</span><span><i className="band2" />⅓–⅔</span><span><i className="band3" />⅔–{minutes} min</span><span>klikni cilj za pot</span></div>;
  if (mode === "compare") return <div className="mapLegend"><span><i className="compareA" />samo A</span><span><i className="compareB" />samo B</span><span><i className="compareBoth" />oba</span></div>;
  return <div className="mapLegend"><span><i className="busLegend" />avtobus</span><span><i className="railLegend" />vlak</span><span><i className="walkLegend" />hoja</span></div>;
}

function ensureMapLayers(map: MapLibreMap) {
  if (!map.getSource("reach")) map.addSource("reach", { type: "geojson", data: EMPTY });
  if (!map.getLayer("reachable-points")) map.addLayer({ id: "reachable-points", type: "circle", source: "reach", paint: { "circle-color": ["get", "color"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3, 9, 6, 13, 9], "circle-opacity": .8, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
  if (!map.getSource("compare")) map.addSource("compare", { type: "geojson", data: EMPTY });
  if (!map.getLayer("compare-points")) map.addLayer({ id: "compare-points", type: "circle", source: "compare", paint: { "circle-color": ["get", "color"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 3, 10, 7], "circle-opacity": .76, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
  for (const source of ["plan", "trip"] as const) {
    if (!map.getSource(source)) map.addSource(source, { type: "geojson", data: EMPTY });
    if (!map.getLayer(`${source}-walk`)) map.addLayer({ id: `${source}-walk`, type: "line", source, filter: ["==", ["get", "kind"], "walk"], paint: { "line-color": "#334155", "line-width": 4, "line-dasharray": [1.5, 1.5] } });
    if (!map.getLayer(`${source}-ride-casing`)) map.addLayer({ id: `${source}-ride-casing`, type: "line", source, filter: ["==", ["get", "kind"], "ride"], paint: { "line-color": "#fff", "line-width": 9, "line-opacity": .9 } });
    if (!map.getLayer(`${source}-ride`)) map.addLayer({ id: `${source}-ride`, type: "line", source, filter: ["==", ["get", "kind"], "ride"], paint: { "line-color": ["get", "color"], "line-width": 6, "line-opacity": .92 } });
    if (!map.getLayer(`${source}-stops`)) map.addLayer({ id: `${source}-stops`, type: "circle", source, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": "#fff", "circle-radius": 5, "circle-stroke-color": ["get", "color"], "circle-stroke-width": 3 } });
  }
  if (!map.getSource("selected")) map.addSource("selected", { type: "geojson", data: EMPTY });
}

function itineraryFeatures(journey: Itinerary): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  journey.legs.forEach((leg, legIndex) => {
    const coordinates = decodePolyline(leg.legGeometry);
    const color = safeColor(leg.routeColor, modeColor(leg.mode));
    if (coordinates.length >= 2) features.push({ type: "Feature", geometry: { type: "LineString", coordinates }, properties: { kind: leg.mode === "WALK" ? "walk" : "ride", color, legIndex } });
    if (leg.mode !== "WALK") {
      [leg.from, ...(leg.intermediateStops ?? []), leg.to].forEach((stop, index) => features.push({ type: "Feature", geometry: { type: "Point", coordinates: [stop.lon, stop.lat] }, properties: { kind: "stop", color, legIndex, index, name: stop.name } }));
    }
  });
  return { type: "FeatureCollection", features };
}

function reachableFeatures(values: ReachablePlace[], maxMinutes: number): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: values.map((value, index) => ({ type: "Feature", geometry: { type: "Point", coordinates: [value.place.lon, value.place.lat] }, properties: { index, duration: value.duration, name: value.place.name, color: value.duration <= maxMinutes / 3 ? "#07392d" : value.duration <= maxMinutes * 2 / 3 ? "#00a968" : "#efad22" } })) };
}

function compareFeatures(a: ReachablePlace[], b: ReachablePlace[]): GeoJSON.FeatureCollection {
  const bKeys = new Set(b.map(compareKey));
  const aKeys = new Set(a.map(compareKey));
  const features: GeoJSON.Feature[] = [];
  a.forEach(value => features.push({ type: "Feature", geometry: { type: "Point", coordinates: [value.place.lon, value.place.lat] }, properties: { color: bKeys.has(compareKey(value)) ? "#6741a5" : "#00a968", name: value.place.name } }));
  b.filter(value => !aKeys.has(compareKey(value))).forEach(value => features.push({ type: "Feature", geometry: { type: "Point", coordinates: [value.place.lon, value.place.lat] }, properties: { color: "#d97706", name: value.place.name } }));
  return { type: "FeatureCollection", features };
}

function setSource(map: MapLibreMap, id: string, data: GeoJSON.FeatureCollection) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

function fitFeatureCollection(map: MapLibreMap, collection: GeoJSON.FeatureCollection) {
  const coordinates: Array<[number, number]> = [];
  for (const feature of collection.features) {
    if (feature.geometry.type === "Point") coordinates.push(feature.geometry.coordinates as [number, number]);
    if (feature.geometry.type === "LineString") coordinates.push(...feature.geometry.coordinates as Array<[number, number]>);
  }
  fitCoordinates(map, coordinates);
}

function fitReachables(map: MapLibreMap | null, origin: TransitPlace, values: ReachablePlace[]) {
  if (!map || !values.length) return;
  const sample = values.length > 600 ? values.filter((_, index) => index % Math.ceil(values.length / 600) === 0) : values;
  fitCoordinates(map, [[origin.lon, origin.lat], ...sample.map(value => [value.place.lon, value.place.lat] as [number, number])]);
}

function fitCoordinates(map: MapLibreMap, coordinates: Array<[number, number]>) {
  if (!coordinates.length) return;
  const bounds = coordinates.reduce((value, coordinate) => value.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
  map.fitBounds(bounds, { padding: { top: 55, right: 55, bottom: 55, left: 55 }, maxZoom: 14, duration: 750 });
}

function letterMarker(letter: string, background: string): Marker {
  const element = document.createElement("div");
  element.className = "letterMarker";
  element.style.background = background;
  const inner = document.createElement("span");
  inner.textContent = letter;
  element.appendChild(inner);
  return new maplibregl.Marker({ element, anchor: "bottom" });
}

function normalizeReachables(values: ReachablePlace[]): ReachablePlace[] {
  const unique = new Map<string, ReachablePlace>();
  for (const value of values ?? []) {
    if (!value.place || !Number.isFinite(value.duration) || !insideExtendedSlovenia(value.place)) continue;
    const key = compareKey(value);
    if (!unique.has(key) || value.duration < unique.get(key)!.duration) unique.set(key, value);
  }
  return [...unique.values()].sort((a, b) => a.duration - b.duration || a.place.name.localeCompare(b.place.name, "sl"));
}

function normalizeDepartures(values: StopTime[], origin: TransitPlace): StopTime[] {
  const unique = new Map<string, StopTime>();
  for (const value of values ?? []) {
    if (value.cancelled || value.tripCancelled || !value.place) continue;
    const key = value.tripId || `${value.routeId}|${value.headsign}|${value.place.departure ?? value.place.scheduledDeparture}`;
    const previous = unique.get(key);
    if (!previous || distanceKm(origin, value.place) < distanceKm(origin, previous.place)) unique.set(key, value);
  }
  return [...unique.values()]
    .sort((a, b) => departureTimestamp(a) - departureTimestamp(b))
    .slice(0, 40);
}

function selectTripRun(journey: Itinerary, tripId: string): Itinerary {
  const legs = journey.legs.filter(leg => leg.tripId === tripId);
  if (!legs.length) return journey;
  const startTime = legs[0].startTime;
  const endTime = legs[legs.length - 1].endTime;
  const duration = Math.max(0, (Date.parse(endTime) - Date.parse(startTime)) / 1000);
  return { ...journey, legs, startTime, endTime, duration, transfers: 0 };
}

function departureTimestamp(value: StopTime): number {
  const parsed = Date.parse(value.place.departure ?? value.place.scheduledDeparture ?? "");
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function compareKey(value: ReachablePlace): string {
  return `${value.place.name.toLocaleLowerCase("sl").replace(/\s+/g, " ").trim()}|${value.place.lat.toFixed(3)}|${value.place.lon.toFixed(3)}`;
}

function compareOverlap(a: ReachablePlace[], b: ReachablePlace[]): number {
  const keys = new Set(a.map(compareKey));
  return b.reduce((count, value) => count + (keys.has(compareKey(value)) ? 1 : 0), 0);
}

function insideExtendedSlovenia(place: TransitPlace): boolean {
  return place.lat >= 45.25 && place.lat <= 47.05 && place.lon >= 13.05 && place.lon <= 16.85;
}

function labelItineraries(values: Itinerary[]): Map<Itinerary, string> {
  const labels = new Map<Itinerary, string>();
  if (!values.length) return labels;
  const fastest = [...values].sort((a, b) => a.duration - b.duration)[0];
  const leastWalk = [...values].sort((a, b) => itineraryStats(a).walkMinutes - itineraryStats(b).walkMinutes)[0];
  const leastTransfers = [...values].sort((a, b) => a.transfers - b.transfers || a.duration - b.duration)[0];
  values.forEach((value, index) => labels.set(value, value === fastest ? "Najhitrejša" : value === leastTransfers ? "Najmanj prestopov" : value === leastWalk ? "Najmanj hoje" : `Možnost ${index + 1}`));
  return labels;
}

function itineraryStats(journey: Itinerary) {
  const walking = journey.legs.filter(leg => leg.mode === "WALK");
  return { walkMinutes: walking.reduce((sum, leg) => sum + leg.duration, 0) / 60, walkDistance: walking.reduce((sum, leg) => sum + (leg.distance ?? 0), 0), realtime: journey.legs.some(leg => leg.realTime) };
}

function transferLabel(count: number): string {
  if (count === 0) return "brez prestopa";
  if (count === 1) return "1 prestop";
  if (count === 2) return "2 prestopa";
  if (count === 3 || count === 4) return `${count} prestopi`;
  return `${count} prestopov`;
}

function transitLegs(journey: Itinerary): TransitLeg[] { return journey.legs.filter(leg => leg.mode !== "WALK"); }

function matchToPlace(value: GeocodeMatch): TransitPlace {
  return { name: value.name, stopId: value.type === "STOP" ? value.id : undefined, lat: value.lat, lon: value.lon, modes: value.modes };
}

function placeSubtitle(value: GeocodeMatch): string {
  const area = value.areas?.find(item => item.default)?.name ?? value.areas?.filter(item => item.adminLevel >= 6).at(-1)?.name;
  const kind = value.source === "GURS" ? "Uradni naslov GURS" : value.type === "STOP" ? formatModes(value.modes) || "Postajališče" : [value.street, value.houseNumber].filter(Boolean).join(" ") || "Kraj ali naslov";
  return [kind, value.zip, area].filter(Boolean).join(" · ");
}

function formatModes(modes?: TransitMode[]): string {
  if (!modes?.length) return "Javni prevoz";
  const labels = [...new Set(modes.map(modeLabel))];
  return labels.slice(0, 3).join(" + ");
}

function modeColor(mode: TransitMode): string {
  if (["RAIL", "HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_RAIL", "SUBURBAN"].includes(mode)) return "#2156a5";
  if (["BUS", "COACH"].includes(mode)) return "#00a968";
  if (mode === "WALK") return "#334155";
  if (mode === "FERRY") return "#0284c7";
  return "#8b5cf6";
}

function modeSymbol(mode: TransitMode): string { return mode === "WALK" ? "↟" : ["BUS", "COACH"].includes(mode) ? "BUS" : mode.includes("RAIL") || mode === "SUBURBAN" ? "VLAK" : "JPP"; }

function safeColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function contrastText(color: string): string {
  const value = color.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
  return r * .299 + g * .587 + b * .114 > 160 ? "#052b22" : "#ffffff";
}

function formatTime(value?: string): string {
  if (!value) return "–";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(11, 16);
  return new Intl.DateTimeFormat("sl-SI", { timeZone: "Europe/Ljubljana", hour: "2-digit", minute: "2-digit" }).format(date);
}

function todayString(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Ljubljana", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function currentTimeString(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Ljubljana", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  return `${parts.find(part => part.type === "hour")?.value ?? "08"}:${parts.find(part => part.type === "minute")?.value ?? "00"}`;
}

function distanceKm(a: TransitPlace, b: TransitPlace): number {
  const radius = 6371;
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function mapHint(mode: AppMode, target: Target): string {
  if (mode === "departures") return "Klik na zemljevid izbere bližnje odhode";
  if (mode === "reach") return "Klik izbere začetek A · krog izbere cilj";
  return `Klik na zemljevid izbere ${target === "start" ? "začetek A" : "cilj B"}`;
}

function humanError(error: unknown): string {
  if (isAbort(error)) return "Poizvedba je trajala predolgo. Poskusi znova ali izberi krajši čas dosega.";
  const message = error instanceof Error ? error.message : "Neznana napaka";
  if (/fetch|network|failed/i.test(message)) return "Storitev javnega prevoza trenutno ni dosegljiva. Preveri povezavo in poskusi znova.";
  return message;
}

function isAbort(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

function addPlaceParams(params: URLSearchParams, prefix: string, place: TransitPlace | null) {
  if (!place) return;
  params.set(`${prefix}n`, place.name);
  params.set(`${prefix}lat`, String(place.lat));
  params.set(`${prefix}lon`, String(place.lon));
  if (place.stopId) params.set(`${prefix}id`, place.stopId);
}

function placeFromParams(params: URLSearchParams, prefix: string): TransitPlace | null {
  const name = params.get(`${prefix}n`), lat = Number(params.get(`${prefix}lat`)), lon = Number(params.get(`${prefix}lon`));
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { name, lat, lon, stopId: params.get(`${prefix}id`) ?? undefined };
}
