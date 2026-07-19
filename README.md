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
- izračun načrtovanega dosega z hojo, vožnjo in prestopi brez LPP API-ključa
- izbira začetka z naslovom ali klikom na zemljevid

Zemljevid izračuna približni načrtovani doseg iz povezav in časov v GTFS. Ne vključuje trenutnih zamud, položajev avtobusov ali obvozov. Za produkcijsko natančnost bo naslednja faza uporaba polnega časovno odvisnega RAPTOR/OpenTripPlanner izračuna in podrobnega peš omrežja.

## Podatki

Vir podatkov je [uradni LPP GTFS](https://data.lpp.si/api/gtfs/feed.zip). Pred javno objavo ali komercialno uporabo je treba pri LPP potrditi pogoje ponovne uporabe podatkov. Osnovni zemljevid v MVP uporablja javni demonstracijski slog MapLibre, ki ga je treba pred produkcijo zamenjati z ustreznim ponudnikom ploščic.
