import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const network = JSON.parse(readFileSync("public/data/lpp-network.json", "utf8"));
const encoded = readFileSync("public/data/lpp-schedule.json.gz.b64", "utf8");
const schedule = JSON.parse(gunzipSync(Buffer.from(encoded, "base64")));

if (network.stops.length < 500) throw new Error(`Premalo postajališč: ${network.stops.length}`);
if (network.routes.length < 20) throw new Error(`Premalo linij: ${network.routes.length}`);
if (!schedule.validFrom || !schedule.validThrough || schedule.validFrom > schedule.validThrough) throw new Error("Neveljavno obdobje voznega reda.");
if (!Object.keys(schedule.dateProfiles ?? {}).length) throw new Error("Manjka koledar datumov.");

for (const [key, profile] of Object.entries(schedule.profiles)) {
  let previous = -Infinity;
  for (const connection of profile.connections) {
    const [departure, arrival, from, to, trip, route] = connection;
    if (departure < previous) throw new Error(`${key}: povezave niso urejene po času.`);
    if (arrival < departure) throw new Error(`${key}: prihod je pred odhodom.`);
    if (!network.stops[from] || !network.stops[to]) throw new Error(`${key}: neveljaven indeks postajališča.`);
    if (!profile.trips[trip] || !network.routes[route]) throw new Error(`${key}: neveljaven indeks vožnje ali linije.`);
    previous = departure;
  }
}

console.log(`GTFS preverjen: ${network.stops.length} postajališč, ${network.routes.length} linij, ${Object.keys(schedule.dateProfiles).length} datumov, ${Object.keys(schedule.profiles).length} profili.`);
