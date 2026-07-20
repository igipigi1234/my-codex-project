# Doseg Ljubljana

Odprta spletna aplikacija za raziskovanje dosegljivosti, načrtovanje poti in pregled linij mestnega javnega prevoza v Ljubljani. Deluje brez zasebnega LPP API-ključa in uporablja uradni statični LPP GTFS.

Objavljena različica: [igipigi1234.github.io/my-codex-project](https://igipigi1234.github.io/my-codex-project/)

## Funkcije

- doseg iz naslova v 15, 30 ali 45 minutah
- dejanske trase dosegljivih delov linij in časovni pasovi na zemljevidu
- uporabni cilji in izbira posameznega cilja s podrobnim načrtom poti
- načrtovanje poti A–B za odhod ob določeni uri ali prihod do določene ure
- primerjava najhitrejše povezave, povezave z manj hoje in povezave z manj prestopi
- celoten vozni red izbrane poti po postajališčih
- pregled celotnih tras, smeri, postajališč, odhodov in bližnjih prestopov posamezne linije
- primerjava dostopnosti dveh naslovov
- konkretni koledarski datumi iz GTFS, vključno s posebnimi voznimi redi
- preverjanje začetne in končne hoje po OpenStreetMap prek BRouterja
- trenutna lokacija, shranjeni domači naslov, deljive povezave in visokokontrastni način
- dnevna avtomatska osvežitev uradnega GTFS

## Lokalni zagon

```bash
npm install
npm run dev
```

Odpri `http://localhost:3000`.

## Preverjanje

```bash
npm test
npm run check:data
npm run build
```

Preverjanje podatkov zazna manjkajoče profile, neveljavne indekse postajališč, voženj in linij ter časovno neusklajene povezave. GitHub Pages pred vsako objavo izvede teste, preverjanje GTFS in produkcijski build.

## Podatki in omejitve

- vozni red, postajališča in trase: uradni [LPP GTFS](https://data.lpp.si/api/gtfs/feed.zip)
- naslovi: Photon oziroma OpenStreetMap
- začetna in končna hoja: BRouter oziroma OpenStreetMap, z lokalno konservativno oceno ob nedosegljivosti storitve
- osnovni zemljevid: OpenStreetMap in CARTO

Aplikacija prikazuje načrtovani vozni red. Brez javnega realnočasovnega LPP vira ne prikazuje trenutnih zamud, položajev avtobusov in obvozov. Pred komercialno uporabo je treba z LPP potrditi pogoje ponovne uporabe podatkov in zagotoviti produkcijske kvote zunanjih kartografskih storitev.
