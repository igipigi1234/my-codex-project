import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
  for await (const line of reader) {
    if (!headers) { headers = parseCsv(line); continue; }
    if (!line) continue;
    const values = parseCsv(line);
    callback(Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""])));
  }
  const code = await new Promise(resolve => child.on("close", resolve));
  if (code !== 0) throw new Error(`Napaka pri branju ${entry}`);
}

function parseCsv(line) {
  const fields = [];
  let field = "", quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted;
    } else if (character === "," && !quoted) { fields.push(field); field = ""; }
    else field += character;
  }
  fields.push(field);
  return fields;
}

const servicesByDate = new Map();
const datesByService = new Map();
await eachLine("calendar_dates.txt", row => {
  if (row.exception_type !== "1") return;
  const services = servicesByDate.get(row.date) ?? new Set();
  services.add(row.service_id);
  servicesByDate.set(row.date, services);
  const dates = datesByService.get(row.service_id) ?? [];
  dates.push(row.date);
  datesByService.set(row.service_id, dates);
});
const dates = [...servicesByDate.keys()].sort();
if (!dates.length) throw new Error("GTFS ne vsebuje koledarskih datumov.");

const network = JSON.parse(readFileSync("public/data/lpp-network.json", "utf8"));
const stopIndex = new Map(network.stops.map((stop, index) => [stop.id, index]));
const routeIndex = new Map(network.routes.map((route, index) => [route.id, index]));
const trips = new Map();
await eachLine("trips.txt", row => {
  const tripDates = datesByService.get(row.service_id);
  const route = routeIndex.get(row.route_id);
  if (tripDates?.length && route !== undefined) trips.set(row.trip_id, { dates: tripDates, route, headsign: row.trip_headsign, shape: row.shape_id, stops: [], times: [] });
});

await eachLine("stop_times.txt", row => {
  const trip = trips.get(row.trip_id);
  const stop = stopIndex.get(row.stop_id);
  if (trip && stop !== undefined) {
    trip.stops.push(stop);
    trip.times.push([seconds(row.arrival_time), seconds(row.departure_time)]);
  }
});

const rawProfiles = new Map(dates.map(date => [date, { date: isoDate(date), connections: [], trips: [], patterns: [], patternKeys: new Set() }]));
const usedShapes = new Set();
for (const trip of trips.values()) {
  if (trip.stops.length < 2) continue;
  for (const date of trip.dates) {
    const profile = rawProfiles.get(date);
    if (!profile) continue;
    const tripNumber = profile.trips.length;
    profile.trips.push([trip.route, trip.headsign, trip.shape]);
    if (trip.shape) usedShapes.add(trip.shape);
    for (let index = 1; index < trip.stops.length; index++) {
      profile.connections.push([trip.times[index - 1][1], trip.times[index][0], trip.stops[index - 1], trip.stops[index], tripNumber, trip.route]);
    }
    const patternKey = `${trip.route}|${trip.headsign}|${trip.shape}|${trip.stops.join(".")}`;
    if (!profile.patternKeys.has(patternKey)) {
      profile.patternKeys.add(patternKey);
      profile.patterns.push([trip.route, trip.headsign, trip.shape, trip.stops]);
    }
  }
}

const profiles = {};
const dateProfiles = {};
const profileHashToKey = new Map();
for (const [date, raw] of rawProfiles) {
  const profile = canonicalProfile(raw);
  const content = JSON.stringify({ connections: profile.connections, trips: profile.trips, patterns: profile.patterns });
  const hash = createHash("sha1").update(content).digest("hex");
  let key = profileHashToKey.get(hash);
  if (!key) {
    key = `p${profileHashToKey.size}`;
    profileHashToKey.set(hash, key);
    profiles[key] = profile;
  }
  dateProfiles[isoDate(date)] = key;
}

const fallbackProfiles = {};
for (const kind of ["weekday", "saturday", "sunday"]) {
  const counts = new Map();
  for (const [date, key] of Object.entries(dateProfiles)) {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    const matches = kind === "sunday" ? day === 0 : kind === "saturday" ? day === 6 : day >= 1 && day <= 5;
    if (matches) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  fallbackProfiles[kind] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

const rawShapes = new Map();
await eachLine("shapes.txt", row => {
  if (!usedShapes.has(row.shape_id)) return;
  const points = rawShapes.get(row.shape_id) ?? [];
  points.push([Number(row.shape_pt_lon), Number(row.shape_pt_lat), Number(row.shape_pt_sequence)]);
  rawShapes.set(row.shape_id, points);
});
const shapes = {};
for (const [id, points] of rawShapes) {
  points.sort((a, b) => a[2] - b[2]);
  const sampled = points.filter((_, index) => index % 3 === 0).map(([lon, lat]) => [lon, lat]);
  const last = points.at(-1);
  if (last && sampled.at(-1)?.[0] !== last[0]) sampled.push([last[0], last[1]]);
  shapes[id] = sampled;
}

const payload = {
  generatedAt: new Date().toISOString(),
  validFrom: isoDate(dates[0]),
  validThrough: isoDate(dates.at(-1)),
  profiles,
  dateProfiles,
  fallbackProfiles,
  shapes,
};
const json = JSON.stringify(payload);
writeFileSync(output, gzipSync(Buffer.from(json), { level: 9 }).toString("base64"));
console.log(`Datumi: ${dates.length}; enolični vozni redi: ${Object.keys(profiles).length}; trase: ${Object.keys(shapes).length}; izhod: ${output}`);
for (const [key, profile] of Object.entries(profiles)) console.log(`${key}: ${profile.date}, ${profile.trips.length} voženj, ${profile.connections.length} povezav`);

function isoDate(value) { return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`; }
function seconds(value) { const [hours, minutes, secondsValue] = value.split(":").map(Number); return hours * 3600 + minutes * 60 + secondsValue; }
function canonicalProfile(raw) {
  const byTrip = raw.trips.map(() => []);
  for (const connection of raw.connections) byTrip[connection[4]].push(connection);
  const records = raw.trips.map((trip, oldIndex) => ({
    trip,
    connections: byTrip[oldIndex].map(connection => [connection[0], connection[1], connection[2], connection[3], connection[5]]),
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const trips = [];
  const connections = [];
  records.forEach((record, tripIndex) => {
    trips.push(record.trip);
    for (const connection of record.connections) connections.push([connection[0], connection[1], connection[2], connection[3], tripIndex, connection[4]]);
  });
  connections.sort((a, b) => a[0] - b[0] || a[4] - b[4]);
  const patterns = [...raw.patterns].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { date: raw.date, connections, trips, patterns };
}
