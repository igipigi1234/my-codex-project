import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

const zip = process.argv[2];
const output = process.argv[3] ?? "public/data/lpp-network.json";
if (!zip) throw new Error("Uporaba: node scripts/build-lpp-graph.mjs <feed.zip> [network.json]");

function unzipLines(entry) {
  const child = spawn("unzip", ["-p", zip, entry]);
  child.stderr.pipe(process.stderr);
  return createInterface({ input: child.stdout, crlfDelay: Infinity });
}
function columns(header) { return Object.fromEntries(header.split(",").map((name, i) => [name.replace(/^\uFEFF|\r$/g, ""), i])); }
function seconds(value) { const [h, m, s] = value.split(":").map(Number); return h * 3600 + m * 60 + s; }

const tripRoutes = new Map();
let header;
for await (const line of unzipLines("trips.txt")) {
  if (!header) { header = columns(line); continue; }
  const row = line.split(","); tripRoutes.set(row[header.trip_id], row[header.route_id]);
}

const network = JSON.parse(readFileSync(output, "utf8"));
const stopIndex = new Map(network.stops.map((stop, i) => [stop.id, i]));
const routeIndex = new Map(network.routes.map((route, i) => [route.id, i]));
const previous = new Map();
const aggregate = new Map();
header = undefined;
for await (const line of unzipLines("stop_times.txt")) {
  if (!header) { header = columns(line); continue; }
  const row = line.split(","); const trip = row[header.trip_id]; const stop = stopIndex.get(row[header.stop_id]);
  if (stop === undefined) continue;
  const arrival = seconds(row[header.arrival_time]); const departure = seconds(row[header.departure_time]); const prev = previous.get(trip);
  if (prev) {
    const travel = arrival - prev.departure; const route = routeIndex.get(tripRoutes.get(trip));
    if (route !== undefined && travel > 0 && travel < 7200) {
      const key = `${prev.stop}|${stop}|${route}`; const old = aggregate.get(key) ?? [0, 0]; aggregate.set(key, [old[0] + travel, old[1] + 1]);
    }
  }
  previous.set(trip, { stop, departure });
}

const graph = Array.from({ length: network.stops.length }, () => []);
for (const [key, [sum, count]] of aggregate) { const [from, to, route] = key.split("|").map(Number); graph[from].push([to, Math.max(30, Math.round(sum / count)), route]); }
network.graph = graph;
network.routing = { method: "GTFS average segment times", transferSeconds: 300, walkingMetersPerSecond: 1.3 };
writeFileSync(output, JSON.stringify(network));
console.log(`Omrežje: ${graph.length} vozlišč, ${aggregate.size} povezav`);
