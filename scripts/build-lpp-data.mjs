import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const zip = process.argv[2];
const output = resolve(process.argv[3] ?? "public/data/lpp-network.json");
if (!zip) throw new Error("Uporaba: node scripts/build-lpp-data.mjs <feed.zip> [output.json]");

function readEntry(name) {
  return execFileSync("unzip", ["-p", zip, name], { encoding: "utf8", maxBuffer: 15 * 1024 * 1024 }).replace(/^\uFEFF/, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [headers, ...values] = rows;
  return values.map(valuesRow => Object.fromEntries(headers.map((header, i) => [header, valuesRow[i] ?? ""])));
}

const stops = parseCsv(readEntry("stops.txt")).map(s => ({ id: s.stop_id, name: s.stop_name, lat: Number(s.stop_lat), lon: Number(s.stop_lon) })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon));
const routes = parseCsv(readEntry("routes.txt")).map(r => ({ id: r.route_id, shortName: r.route_short_name, longName: r.route_long_name, color: r.route_color || "00A968", textColor: r.route_text_color || "FFFFFF" }));
const payload = { generatedAt: new Date().toISOString(), sourceUpdatedAt: "2026-07-18", sourceUrl: "https://data.lpp.si/api/gtfs/feed.zip", stops, routes };

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(payload));
console.log(`Zapisano: ${stops.length} postajališč, ${routes.length} linij -> ${output}`);
