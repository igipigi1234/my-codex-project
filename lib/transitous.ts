export const TRANSITOUS_API = "https://api.transitous.org";

export type TransitMode =
  | "WALK" | "BUS" | "COACH" | "RAIL" | "HIGHSPEED_RAIL"
  | "LONG_DISTANCE" | "NIGHT_RAIL" | "REGIONAL_RAIL" | "SUBURBAN"
  | "TRAM" | "SUBWAY" | "FERRY" | "FUNICULAR" | "AERIAL_LIFT"
  | "FLEX" | "ODM" | "OTHER" | "TRANSIT";

export type TransitPlace = {
  name: string;
  stopId?: string;
  lat: number;
  lon: number;
  arrival?: string;
  departure?: string;
  scheduledArrival?: string;
  scheduledDeparture?: string;
  track?: string;
  scheduledTrack?: string;
  modes?: TransitMode[];
};

export type EncodedPolyline = { points: string; precision: number; length: number };

export type TransitLeg = {
  mode: TransitMode;
  from: TransitPlace;
  to: TransitPlace;
  duration: number;
  startTime: string;
  endTime: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  realTime: boolean;
  distance?: number;
  headsign?: string;
  routeId?: string;
  routeColor?: string;
  routeTextColor?: string;
  agencyName?: string;
  tripId?: string;
  routeShortName?: string;
  routeLongName?: string;
  displayName?: string;
  cancelled?: boolean;
  intermediateStops?: TransitPlace[];
  legGeometry: EncodedPolyline;
  wheelchairAccessible?: "NO_INFORMATION" | "POSSIBLE" | "NOT_POSSIBLE";
};

export type Itinerary = {
  duration: number;
  startTime: string;
  endTime: string;
  transfers: number;
  id: string;
  legs: TransitLeg[];
};

export type PlanResponse = {
  from: TransitPlace;
  to: TransitPlace;
  direct: Itinerary[];
  itineraries: Itinerary[];
};

export type GeocodeMatch = {
  type: "ADDRESS" | "PLACE" | "STOP";
  name: string;
  id: string;
  lat: number;
  lon: number;
  street?: string;
  houseNumber?: string;
  zip?: string;
  country?: string;
  areas?: Array<{ name: string; adminLevel: number; default?: boolean }>;
  modes?: TransitMode[];
};

export type ReachablePlace = { place: TransitPlace; duration: number; k: number };
export type ReachResponse = { one: TransitPlace; all: ReachablePlace[] };

export type StopTime = {
  place: TransitPlace;
  mode: TransitMode;
  realTime: boolean;
  headsign: string;
  tripTo: TransitPlace;
  agencyName: string;
  routeId: string;
  tripId: string;
  routeShortName: string;
  routeLongName: string;
  displayName: string;
  cancelled: boolean;
  tripCancelled: boolean;
  nextStops?: TransitPlace[];
};

export type StoptimesResponse = { stopTimes: StopTime[]; place: TransitPlace };

export type PlannerPreferences = {
  bus: boolean;
  train: boolean;
  other: boolean;
  wheelchair: boolean;
  bikeOnBoard: boolean;
};

const BUS_MODES: TransitMode[] = ["BUS", "COACH"];
const TRAIN_MODES: TransitMode[] = ["RAIL", "HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_RAIL", "SUBURBAN"];
const OTHER_MODES: TransitMode[] = ["TRAM", "SUBWAY", "FERRY", "FUNICULAR", "AERIAL_LIFT", "FLEX", "ODM", "OTHER"];

export function selectedTransitModes(preferences: PlannerPreferences): TransitMode[] {
  return [
    ...(preferences.bus ? BUS_MODES : []),
    ...(preferences.train ? TRAIN_MODES : []),
    ...(preferences.other ? OTHER_MODES : []),
  ];
}

export async function geocodeSlovenia(text: string, signal?: AbortSignal): Promise<GeocodeMatch[]> {
  const results = await apiGet<GeocodeMatch[]>("/api/v1/geocode", {
    text,
    place: "46.12,14.90",
    placeBias: 0.18,
    language: "sl",
    numResults: 12,
  }, signal);
  return results
    .filter(result => result.country === "SI" || isInsideSlovenia(result))
    .filter((result, index, all) => all.findIndex(other => placeKey(other) === placeKey(result)) === index)
    .slice(0, 8);
}

export async function planTrip(
  from: TransitPlace,
  to: TransitPlace,
  date: string,
  time: string,
  arriveBy: boolean,
  preferences: PlannerPreferences,
  signal?: AbortSignal,
): Promise<PlanResponse> {
  const transitModes = selectedTransitModes(preferences);
  if (!transitModes.length) throw new Error("Izberi vsaj eno vrsto javnega prevoza.");
  return apiGet<PlanResponse>("/api/v6/plan", {
    fromPlace: placeParameter(from),
    toPlace: placeParameter(to),
    time: sloveniaDateTime(date, time),
    arriveBy,
    transitModes,
    preTransitModes: ["WALK"],
    postTransitModes: ["WALK"],
    directModes: ["WALK"],
    pedestrianProfile: preferences.wheelchair ? "WHEELCHAIR" : "FOOT",
    requireBikeTransport: preferences.bikeOnBoard,
    useRoutedTransfers: true,
    detailedLegs: true,
    detailedTransfers: true,
    timetableView: true,
    numItineraries: 8,
    maxItineraries: 12,
    searchWindow: 7200,
    maxTravelTime: 720,
    language: ["sl"],
  }, signal);
}

export async function reachableFrom(
  from: TransitPlace,
  date: string,
  time: string,
  minutes: number,
  preferences: PlannerPreferences,
  signal?: AbortSignal,
): Promise<ReachResponse> {
  const transitModes = selectedTransitModes(preferences);
  if (!transitModes.length) throw new Error("Izberi vsaj eno vrsto javnega prevoza.");
  return apiGet<ReachResponse>("/api/v6/one-to-all", {
    one: placeParameter(from, false),
    time: sloveniaDateTime(date, time),
    arriveBy: false,
    transitModes,
    preTransitModes: ["WALK"],
    pedestrianProfile: preferences.wheelchair ? "WHEELCHAIR" : "FOOT",
    requireBikeTransport: preferences.bikeOnBoard,
    useRoutedTransfers: true,
    maxTransfers: 4,
    maxTravelTime: minutes,
  }, signal);
}

export async function stopDepartures(
  place: TransitPlace,
  date: string,
  time: string,
  preferences: PlannerPreferences,
  signal?: AbortSignal,
): Promise<StoptimesResponse> {
  return apiGet<StoptimesResponse>("/api/v6/stoptimes", {
    center: `${place.lat},${place.lon}`,
    radius: 500,
    time: sloveniaDateTime(date, time),
    arriveBy: false,
    direction: "LATER",
    n: 40,
    fetchStops: true,
    mode: selectedTransitModes(preferences),
    language: ["sl"],
  }, signal);
}

export async function fullTrip(tripId: string, signal?: AbortSignal): Promise<Itinerary> {
  return apiGet<Itinerary>("/api/v6/trip", {
    tripId,
    detailedLegs: true,
    joinInterlinedLegs: false,
    language: ["sl"],
  }, signal);
}

export function decodePolyline(polyline?: EncodedPolyline): Array<[number, number]> {
  if (!polyline?.points) return [];
  const coordinates: Array<[number, number]> = [];
  const factor = 10 ** polyline.precision;
  let index = 0, latitude = 0, longitude = 0;
  while (index < polyline.points.length) {
    const latitudeDelta = decodeValue(polyline.points, index);
    index = latitudeDelta.next;
    const longitudeDelta = decodeValue(polyline.points, index);
    index = longitudeDelta.next;
    latitude += latitudeDelta.value;
    longitude += longitudeDelta.value;
    coordinates.push([longitude / factor, latitude / factor]);
  }
  return coordinates;
}

export function sloveniaDateTime(date: string, time: string): string {
  const probe = new Date(`${date}T${time}:00Z`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Ljubljana",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(probe);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value ?? 0);
  const represented = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  const offsetMinutes = Math.round((represented - probe.getTime()) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${date}T${time}:00${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function modeLabel(mode: TransitMode): string {
  if (BUS_MODES.includes(mode)) return mode === "COACH" ? "Medkrajevni avtobus" : "Avtobus";
  if (TRAIN_MODES.includes(mode)) return mode === "NIGHT_RAIL" ? "Nočni vlak" : mode === "LONG_DISTANCE" ? "Daljinski vlak" : "Vlak";
  if (mode === "WALK") return "Hoja";
  if (mode === "FERRY") return "Ladja";
  if (mode === "FUNICULAR") return "Vzpenjača";
  if (mode === "AERIAL_LIFT") return "Žičnica";
  if (mode === "FLEX" || mode === "ODM") return "Prevoz na klic";
  return "Javni prevoz";
}

function decodeValue(value: string, start: number): { value: number; next: number } {
  let result = 0, shift = 0, index = start, byte: number;
  do {
    byte = value.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20 && index < value.length);
  return { value: result & 1 ? ~(result >> 1) : result >> 1, next: index };
}

function placeParameter(place: TransitPlace, preferStop = true): string {
  return preferStop && place.stopId ? place.stopId : `${place.lat},${place.lon}`;
}

function placeKey(place: Pick<GeocodeMatch, "name" | "lat" | "lon">): string {
  return `${place.name.toLocaleLowerCase("sl")}|${place.lat.toFixed(4)}|${place.lon.toFixed(4)}`;
}

function isInsideSlovenia(place: { lat: number; lon: number }): boolean {
  return place.lat >= 45.38 && place.lat <= 46.9 && place.lon >= 13.3 && place.lon <= 16.7;
}

async function apiGet<T>(path: string, parameters: Record<string, unknown>, externalSignal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(parameters)) {
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Array.isArray(raw) ? raw.join(",") : String(raw);
    query.set(key, value);
  }
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 45_000);
  const abort = () => timeout.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`${TRANSITOUS_API}${path}?${query}`, { signal: timeout.signal });
    const payload = await response.json().catch(() => null) as T | { error?: string; message?: string } | null;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && ("error" in payload || "message" in payload)
        ? String(payload.error ?? payload.message)
        : `Storitev je vrnila napako ${response.status}.`;
      throw new Error(message);
    }
    return payload as T;
  } catch (error) {
    if (timeout.signal.aborted) throw new DOMException("Poizvedba je bila prekinjena.", "AbortError");
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}
