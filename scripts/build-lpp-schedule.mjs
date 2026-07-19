import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const zip = process.argv[2];
const output = process.argv[3] ?? "public/data/lpp-schedule.json.gz.b64";
if (!zip) throw new Error("Uporaba: node scripts/build-lpp-schedule.mjs <feed.zip> [output.json]");

async function eachLine(entry, callback) {
  const child = spawn("unzip", ["-p", zip, entry]);
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let headers;
  for await (const line of reader) { if (!headers) { headers = parseCsv(line); continue; } if (line) callback(Object.fromEntries(headers.map((key, i) => [key, parseCsv(line)[i] ?? ""]))); }
  const code = await new Promise(resolve => child.on("close", resolve));
  if (code !== 0) throw new Error(`Napaka pri branju ${entry}`);
}

function parseCsv(line) {
  const fields = []; let field = "", quoted = false;
  for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (quoted && line[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; } else if (c === "," && !quoted) { fields.push(field); field = ""; } else field += c; }
  fields.push(field); return fields;
}

const services = [];
await eachLine("calendar_dates.txt", row => { if (row.exception_type === "1") services.push(row); });
services.sort((a, b) => a.date.localeCompare(b.date));
const day = value => new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)))).getUTCDay();
const chosen = {
  weekday: services.find(row => day(row.date) >= 1 && day(row.date) <= 5),
  saturday: services.find(row => day(row.date) === 6),
  sunday: services.find(row => day(row.date) === 0),
};
if (Object.values(chosen).some(value => !value)) throw new Error("GTFS ne vsebuje vseh treh profilov dni.");
const serviceProfile = new Map(Object.entries(chosen).map(([profile, row]) => [row.service_id, profile]));

const network = JSON.parse(readFileSync("public/data/lpp-network.json", "utf8"));
const stopIndex = new Map(network.stops.map((stop, index) => [stop.id, index]));
const routeIndex = new Map(network.routes.map((route, index) => [route.id, index]));
const trips = new Map();
await eachLine("trips.txt", row => { const profile = serviceProfile.get(row.service_id); if (profile) trips.set(row.trip_id, { profile, route: routeIndex.get(row.route_id), headsign: row.trip_headsign, shape: row.shape_id, stops: [], times: [] }); });

await eachLine("stop_times.txt", row => { const trip = trips.get(row.trip_id); const stop = stopIndex.get(row.stop_id); if (trip && stop !== undefined) { trip.stops.push(stop); trip.times.push([seconds(row.arrival_time), seconds(row.departure_time)]); } });

const profiles = {};
for (const [name, row] of Object.entries(chosen)) profiles[name] = { date: row.date, connections: [], trips: [], patterns: [] };
const patternKeys = new Set(); const usedShapes = new Set();
for (const trip of trips.values()) {
  const profile = profiles[trip.profile], tripNumber = profile.trips.length;
  profile.trips.push([trip.route, trip.headsign, trip.shape]); if (trip.shape) usedShapes.add(trip.shape);
  for (let i = 1; i < trip.stops.length; i++) profile.connections.push([trip.times[i - 1][1], trip.times[i][0], trip.stops[i - 1], trip.stops[i], tripNumber, trip.route]);
  const patternKey = `${trip.profile}|${trip.route}|${trip.headsign}|${trip.shape}`;
  if (!patternKeys.has(patternKey)) { patternKeys.add(patternKey); profile.patterns.push([trip.route, trip.headsign, trip.shape, trip.stops]); }
}
for (const profile of Object.values(profiles)) profile.connections.sort((a, b) => a[0] - b[0]);

const rawShapes = new Map();
await eachLine("shapes.txt", row => { if (!usedShapes.has(row.shape_id)) return; const points = rawShapes.get(row.shape_id) ?? []; points.push([Number(row.shape_pt_lon), Number(row.shape_pt_lat), Number(row.shape_pt_sequence)]); rawShapes.set(row.shape_id, points); });
const shapes = {};
for (const [id, points] of rawShapes) { points.sort((a, b) => a[2] - b[2]); const sampled = points.filter((_, i) => i % 4 === 0).map(([lon, lat]) => [lon, lat]); const last = points.at(-1); if (last && sampled.at(-1)?.[0] !== last[0]) sampled.push([last[0], last[1]]); shapes[id] = sampled; }

const json = JSON.stringify({ generatedAt: new Date().toISOString(), profiles, shapes });
writeFileSync(output, gzipSync(Buffer.from(json), { level: 9 }).toString("base64"));
for (const [name, profile] of Object.entries(profiles)) console.log(`${name}: ${profile.trips.length} voženj, ${profile.connections.length} povezav, ${profile.patterns.length} vzorcev`);
console.log(`Trase: ${Object.keys(shapes).length}; izhod: ${output}`);

function seconds(value) { const [h, m, s] = value.split(":").map(Number); return h * 3600 + m * 60 + s; }
