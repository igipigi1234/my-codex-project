# Doseg Slovenija

Odprta spletna aplikacija za raziskovanje dosegljivosti, načrtovanje poti in pregled javnega potniškega prometa po vsej Sloveniji. Združuje medkrajevne in mestne avtobuse, potniške vlake ter druge objavljene oblike JPP brez zasebnega API-ključa.

Objavljena različica: [igipigi1234.github.io/my-codex-project](https://igipigi1234.github.io/my-codex-project/)

## Funkcije

- nacionalni doseg iz poljubnega naslova v 30, 60, 90 ali 180 minutah
- prikaz vseh dosegljivih postajališč in najbolj oddaljenih ciljev
- klik na dosegljivi cilj prikaže samo izbrano pot, trase in celoten vozni red
- načrtovanje poti A–B za odhod ob določeni uri ali prihod do določene ure
- več alternativ z oznakami najhitrejša, najmanj hoje in najmanj prestopov
- povezovanje mestnih avtobusov, medkrajevnih avtobusov, vlakov in peš prestopov
- naslednji odhodi na vseh postajališčih v bližini izbrane lokacije
- klik na odhod prikaže celotno linijo, vse postanke in predvidene čase
- filtri za avtobus, vlak, druge oblike JPP, dostopnost brez ovir in prevoz kolesa
- primerjava dosegljivosti dveh naslovov
- uradni hišni naslovi iz Registra naslovov GURS, kraji in postaje, izbira na zemljevidu in trenutna lokacija
- deljive povezave, shranjena domača lokacija in visokokontrastni način

## Lokalni zagon

```bash
npm install
npm run dev
```

Odpri `http://localhost:3000`.

## Preverjanje

```bash
npm test
npm run build
```

GitHub Pages pred vsako objavo izvede teste in produkcijski build.

## Podatki in omejitve

- uradni hišni naslovi in centroidi stavb: [Register naslovov GURS](https://www.e-prostor.gov.si/podrocja/prostorske-enote-in-naslovi/register-naslovov/) prek javnega OGC API-ja
- poti, vozni redi, odhodi, kraji in postaje: [Transitous/MOTIS](https://transitous.org/) z odprtimi slovenskimi viri, med njimi NAP, LPP, Marprom, Nomago, mestni in lokalni GTFS viri
- pregled vseh virov in pogojev uporabe: [Transitous – Slovenia](https://transitous.org/sources/#slovenia)
- osnovni zemljevid: OpenStreetMap in CARTO

Transitous deluje kot skupnostna storitev po načelu best effort. Aplikacija prikaže oznako »v živo« samo na odsekih, kjer vir zagotavlja realnočasovne podatke; drugod uporablja objavljeni vozni red. Za produkcijo z večjim prometom je treba s ponudnikom uskladiti obseg uporabe ali postaviti lasten MOTIS strežnik.
