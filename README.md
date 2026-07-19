# Doseg Ljubljana

Odprta osnova za raziskovalnik dosegljivosti z mestnim javnim prevozom v Ljubljani. MVP prikazuje dejanska postajališča in linije iz uradnega vira LPP ter pripravlja uporabniški vmesnik za izračun izohron 15, 30 in 45 minut.

## Lokalni zagon

```bash
npm install
npm run dev
```

Odpri `http://localhost:3000`.

Objavljena različica: [igipigi1234.github.io/my-codex-project](https://igipigi1234.github.io/my-codex-project/)

## Trenutno stanje

- interaktivni zemljevid Ljubljane
- gručenje in iskanje postajališč LPP
- podatkovni povzetek linij in postajališč iz GTFS
- izbira časovnega praga 15, 30 ali 45 minut

Izbira časa še ne riše izohrone. Naslednja faza je pravi izračun z voznimi redi GTFS, peš omrežjem OpenStreetMap in usmerjevalnikom OpenTripPlanner oziroma namenskim RAPTOR/Dijkstra servisom.

## Podatki

Vir podatkov je [uradni LPP GTFS](https://data.lpp.si/api/gtfs/feed.zip). Pred javno objavo ali komercialno uporabo je treba pri LPP potrditi pogoje ponovne uporabe podatkov. Osnovni zemljevid v MVP uporablja javni demonstracijski slog MapLibre, ki ga je treba pred produkcijo zamenjati z ustreznim ponudnikom ploščic.
