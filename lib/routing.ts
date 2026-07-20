import type { DayProfile, NetworkData, ScheduleData, Stop } from "./types";

export type Location = { name: string; lat: number; lon: number };
export type Access = { stop: number; seconds: number; distance: number; geometry?: Array<[number, number]> };
export type WalkEdge = [to: number, seconds: number, distance: number];
export type WalkGraph = WalkEdge[][];
type Pred = { kind: "access" | "walk" | "ride"; from: number; trip?: number; route?: number; dep?: number; arr?: number; seconds?: number } | null;
export type JourneyStep = { kind: "walk" | "ride"; from?: number; to: number; trip?: number; route?: number; dep?: number; arr?: number; minutes: number; geometry?: Array<[number, number]> };
export type Journey = {
  departure: number;
  arrival: number;
  duration: number;
  steps: JourneyStep[];
  destinationStop: number;
  walkingMinutes: number;
  waitingMinutes: number;
  transfers: number;
  label?: string;
};

const WALK_SPEED = 1.25;
const WALK_DETOUR = 1.22;
const TRANSFER_BUFFER = 90;

export function meters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  return Math.hypot((b.lon - a.lon) * 111320 * Math.cos(lat), (b.lat - a.lat) * 110540);
}

export function estimatedWalkSeconds(distance: number) {
  return Math.max(30, distance * WALK_DETOUR / WALK_SPEED);
}

export function buildWalkGraph(stops: Stop[], maxAirDistance = 320): WalkGraph {
  const graph: WalkGraph = stops.map(() => []);
  for (let a = 0; a < stops.length; a++) {
    for (let b = a + 1; b < stops.length; b++) {
      const distance = meters(stops[a], stops[b]);
      if (distance <= maxAirDistance) {
        const seconds = estimatedWalkSeconds(distance) + 25;
        graph[a].push([b, seconds, distance]);
        graph[b].push([a, seconds, distance]);
      }
    }
  }
  return graph;
}

export function estimatedAccess(location: Location, stops: Stop[], maxAirDistance = 1500, count = 10): Access[] {
  return stops
    .map((stop, index) => ({ stop: index, distance: meters(location, stop) }))
    .filter(value => value.distance <= maxAirDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map(value => ({ ...value, seconds: estimatedWalkSeconds(value.distance) }));
}

export function profileForDate(schedule: ScheduleData, date: string): { profile: DayProfile | null; exact: boolean } {
  const key = schedule.dateProfiles?.[date];
  if (key && schedule.profiles[key]) return { profile: schedule.profiles[key], exact: true };
  const day = new Date(`${date}T12:00:00`).getDay();
  const kind = day === 0 ? "sunday" : day === 6 ? "saturday" : "weekday";
  const fallbackKey = schedule.fallbackProfiles?.[kind];
  return { profile: (fallbackKey ? schedule.profiles[fallbackKey] : schedule.profiles[kind]) ?? null, exact: false };
}

export function runCsa(profile: DayProfile, departure: number, walkGraph: WalkGraph, access: Access[], limit = 3 * 3600) {
  const stopCount = walkGraph.length;
  const earliest = new Float64Array(stopCount);
  earliest.fill(Infinity);
  const pred: Pred[] = Array(stopCount).fill(null);
  const tripReached = new Uint8Array(profile.trips.length);

  for (const candidate of access) {
    const arrival = departure + candidate.seconds;
    if (arrival < earliest[candidate.stop]) {
      earliest[candidate.stop] = arrival;
      pred[candidate.stop] = { kind: "access", from: -1, seconds: candidate.seconds };
    }
  }

  const relaxWalk = (from: number) => {
    for (const [to, seconds] of walkGraph[from]) {
      const arrival = earliest[from] + seconds;
      if (arrival < earliest[to]) {
        earliest[to] = arrival;
        pred[to] = { kind: "walk", from, seconds };
      }
    }
  };
  access.forEach(value => relaxWalk(value.stop));

  for (const [dep, arr, from, to, trip, route] of profile.connections) {
    if (dep < departure || dep > departure + limit) continue;
    if (!tripReached[trip] && earliest[from] + TRANSFER_BUFFER > dep) continue;
    tripReached[trip] = 1;
    if (arr < earliest[to]) {
      earliest[to] = arr;
      pred[to] = { kind: "ride", from, trip, route, dep, arr };
      relaxWalk(to);
    }
  }
  return { earliest, pred };
}

export function planJourney(profile: DayProfile, departure: number, walkGraph: WalkGraph, startAccess: Access[], endAccess: Access[]): Journey | null {
  const { earliest, pred } = runCsa(profile, departure, walkGraph, startAccess, 5 * 3600);
  let best = Infinity;
  let destinationStop = -1;
  let egress: Access | undefined;
  for (const candidate of endAccess) {
    const arrival = earliest[candidate.stop] + candidate.seconds;
    if (arrival < best) {
      best = arrival;
      destinationStop = candidate.stop;
      egress = candidate;
    }
  }
  if (destinationStop < 0 || !Number.isFinite(best) || !egress) return null;

  const reversed: JourneyStep[] = [{
    kind: "walk",
    from: destinationStop,
    to: destinationStop,
    minutes: Math.max(1, Math.round(egress.seconds / 60)),
    geometry: egress.geometry,
  }];
  let node = destinationStop;
  let guard = 0;
  while (pred[node] && guard++ < 250) {
    const previous = pred[node]!;
    if (previous.kind === "access") {
      const candidate = startAccess.find(value => value.stop === node);
      reversed.push({ kind: "walk", to: node, minutes: Math.max(1, Math.round((previous.seconds ?? 0) / 60)), geometry: candidate?.geometry });
      break;
    }
    reversed.push({
      kind: previous.kind,
      from: previous.from,
      to: node,
      trip: previous.trip,
      route: previous.route,
      dep: previous.dep,
      arr: previous.arr,
      minutes: Math.max(1, Math.round((previous.kind === "walk" ? previous.seconds ?? 0 : (previous.arr ?? 0) - (previous.dep ?? 0)) / 60)),
    });
    node = previous.from;
  }

  const steps: JourneyStep[] = [];
  for (const step of reversed.reverse()) {
    const last = steps.at(-1);
    if (step.kind === "ride" && last?.kind === "ride" && last.trip === step.trip) {
      last.to = step.to;
      last.arr = step.arr;
      last.minutes = Math.max(1, Math.round(((last.arr ?? 0) - (last.dep ?? 0)) / 60));
    } else if (step.kind === "walk" && last?.kind === "walk" && !step.geometry && !last.geometry) {
      last.to = step.to;
      last.minutes += step.minutes;
    } else {
      steps.push({ ...step });
    }
  }
  const rides = steps.filter(step => step.kind === "ride");
  const walkingMinutes = steps.filter(step => step.kind === "walk").reduce((sum, step) => sum + step.minutes, 0);
  const ridingMinutes = rides.reduce((sum, step) => sum + step.minutes, 0);
  const durationMinutes = Math.max(1, Math.round((best - departure) / 60));
  return {
    departure,
    arrival: best,
    duration: best - departure,
    steps,
    destinationStop,
    walkingMinutes,
    waitingMinutes: Math.max(0, durationMinutes - walkingMinutes - ridingMinutes),
    transfers: Math.max(0, rides.length - 1),
  };
}

export function findJourneyOptions(profile: DayProfile, requested: number, walkGraph: WalkGraph, startAccess: Access[], endAccess: Access[], arriveBy = false): Journey[] {
  const departures = arriveBy
    ? Array.from({ length: 31 }, (_, index) => requested - (150 - index * 5) * 60)
    : Array.from({ length: 10 }, (_, index) => requested + index * 5 * 60);
  const unique = new Map<string, Journey>();
  for (const departure of departures) {
    const journey = planJourney(profile, departure, walkGraph, startAccess, endAccess);
    if (!journey || (arriveBy && journey.arrival > requested)) continue;
    const signature = `${Math.round(journey.arrival / 60)}:${journey.steps.filter(step => step.kind === "ride").map(step => step.route).join("-")}`;
    const current = unique.get(signature);
    if (!current || journey.departure > current.departure) unique.set(signature, journey);
  }
  const all = [...unique.values()];
  if (!all.length) return [];
  const chosen: Journey[] = [];
  const add = (journey: Journey | undefined, label: string) => {
    if (!journey || chosen.includes(journey)) return;
    journey.label = label;
    chosen.push(journey);
  };
  add([...all].sort((a, b) => arriveBy ? b.departure - a.departure : a.arrival - b.arrival)[0], arriveBy ? "Najpoznejši odhod" : "Najhitrejša");
  add([...all].sort((a, b) => a.walkingMinutes - b.walkingMinutes || a.arrival - b.arrival)[0], "Manj hoje");
  add([...all].sort((a, b) => a.transfers - b.transfers || a.arrival - b.arrival)[0], "Manj prestopov");
  for (const journey of all.sort((a, b) => a.arrival - b.arrival)) add(journey, "Alternativa");
  return chosen.slice(0, 3);
}

export function tripStopTimes(step: JourneyStep, profile: DayProfile): Array<[number, number]> {
  if (step.trip === undefined || step.from === undefined) return [];
  const rows: Array<[number, number]> = [];
  let active = false;
  for (const [dep, arr, from, to, trip] of profile.connections) {
    if (trip !== step.trip) continue;
    if (!active && from === step.from) {
      active = true;
      rows.push([from, dep]);
    }
    if (active) {
      rows.push([to, arr]);
      if (to === step.to) break;
    }
  }
  return rows;
}

export function nextDepartures(profile: DayProfile, stop: number, after: number, limit = 6, route?: number) {
  const seen = new Set<number>();
  const values: Array<{ time: number; trip: number; route: number; headsign: string }> = [];
  for (const [dep, , from, , trip, routeIndex] of profile.connections) {
    if (from !== stop || dep < after || (route !== undefined && routeIndex !== route) || seen.has(trip)) continue;
    seen.add(trip);
    values.push({ time: dep, trip, route: routeIndex, headsign: profile.trips[trip]?.[1] ?? "" });
    if (values.length === limit) break;
  }
  return values;
}

export function lineShape(schedule: ScheduleData, profile: DayProfile, trip: number, from: Stop, to: Stop) {
  const shape = schedule.shapes[profile.trips[trip]?.[2]];
  return shape ? sliceShape(shape, [from.lon, from.lat], [to.lon, to.lat]) : [[from.lon, from.lat], [to.lon, to.lat]] as Array<[number, number]>;
}

export function sliceShape(shape: Array<[number, number]>, from: [number, number], to: [number, number]) {
  const nearest = (point: [number, number]) => {
    let best = 0;
    let value = Infinity;
    shape.forEach((candidate, index) => {
      const distance = (candidate[0] - point[0]) ** 2 + (candidate[1] - point[1]) ** 2;
      if (distance < value) { value = distance; best = index; }
    });
    return best;
  };
  const a = nearest(from);
  const b = nearest(to);
  const part = a <= b ? shape.slice(a, b + 1) : shape.slice(b, a + 1).reverse();
  return part.length >= 2 ? part : [from, to];
}

export function routeBadges(journey: Journey, network: NetworkData) {
  return journey.steps
    .filter(step => step.kind === "ride" && step.route !== undefined)
    .map(step => network.routes[step.route!]);
}
