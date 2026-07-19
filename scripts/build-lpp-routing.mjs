import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";

const zip = process.argv[2];
const output = process.argv[3] ?? "public/data/lpp-routing.json";
if (!zip) throw new Error("Uporaba: node scripts/build-lpp-routing.mjs <feed.zip> [output.json]");

async function lines(entry, onLine) {
  const child = spawn("unzip", ["-p", zip, entry]);
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let first = true;
  for await (const line of reader) { if (first) { first = false; continue; } if (line) onLine(line); }
  const code = await new Promise(resolve => child.on("close", resolve));
  if (code !== 0) throw new Error(`Napaka pri branju ${entry}`);
}

const tripRoute = new Map();
await lines("trips.txt", line => { const parts = line.split(",", 4); tripRoute.set(parts[2], parts[0]); });

const aggregates = new Map();
let previousTrip = "", previousStop = "", previousDeparture = 0;
await lines("stop_times.txt", line => {
  const [trip, arrival, departure, stop] = line.split(",", 5);
  const arrivalSeconds = toSeconds(arrival), departureSeconds = toSeconds(departure);
  if (trip === previousTrip && previousStop && arrivalSeconds >= previousDeparture) {
    const route = tripRoute.get(trip); const duration = Math.max(20, Math.min(900, arrivalSeconds - previousDeparture));
    const key = `${previousStop}|${stop}|${route}`; const value = aggregates.get(key) ?? [0, 0]; value[0] += duration; value[1]++; aggregates.set(key, value);
  }
  previousTrip = trip; previousStop = stop; previousDeparture = departureSeconds;
});

const network = JSON.parse(readFileSync("public/data/lpp-network.json", "utf8"));
const stopIndex = new Map(network.stops.map((stop, index) => [stop.id, index]));
const routeIds = [...new Set([...aggregates.keys()].map(key => key.split("|")[2]))];
const routeIndex = new Map(routeIds.map((id, index) => [id, index]));
const edges = Array.from({ length: network.stops.length }, () => []);
for (const [key, [total, count]] of aggregates) {
  const [from, to, route] = key.split("|"); const a = stopIndex.get(from), b = stopIndex.get(to);
  if (a !== undefined && b !== undefined) edges[a].push([b, Math.round(total / count), routeIndex.get(route)]);
}
writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), routeIds, edges }));
console.log(`Zapisano ${aggregates.size} povezav med ${network.stops.length} postajališči.`);

function toSeconds(value) { const [h, m, s] = value.split(":").map(Number); return h * 3600 + m * 60 + s; }
