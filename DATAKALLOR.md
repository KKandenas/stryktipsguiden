# Datakällor

Undersökt 2026-10-10. Svenska Spels endpoints är **inofficiella**: det är samma JSON-API som
spela.svenskaspel.se själv anropar. De kan ändras utan förvarning. Testerna i `tests/` mot sparade
svar i `tests/fixtures/` visar exakt vilka fält vi är beroende av.

## Svenska Spel

Bas-URL: `https://api.spela.svenskaspel.se/draw/1/stryktipset`
Ingen nyckel krävs. Pipelinen skickar en egen User-Agent och pausar 1 s mellan anrop vid backfill.

> Det officiella API:t (`api.www.svenskaspel.se/external/1/...`) kräver en accesskey (svarar 401
> utan). Det behövs inte.
> `spela.svenskaspel.se/robots.txt` förbjuder `/api/` på *den* domänen. API-domänen
> `api.spela.svenskaspel.se` har ingen robots.txt. Vi gör ett fåtal anrop per vecka.

| Endpoint | Innehåll |
|---|---|
| `GET /draws` | Öppna omgångar. Tom lista mellan spelstopp (lör 15:59) och måndag 07:00. |
| `GET /draws/{nr}` | En omgång, även gamla. Fungerar tillbaka till ca 2015 (omgång ~4400). |
| `GET /draws/{nr}/result` | Resultat och utdelning. **404** tills omgången är avgjord. |
| `GET /draws/result` | Senast avgjorda omgången. |

### `draw`-objektet (från `/draws` och `/draws/{nr}`)

| Fält | Exempel | Används till |
|---|---|---|
| `drawNumber` | `4974` | `omgangar.id` |
| `regCloseTime` | `"2026-10-10T15:59:00+02:00"` | spelstopp |
| `regOpenTime` | `"2026-10-05T07:00:00+02:00"` | tidpunkt för startodds |
| `drawState` | `Open` / `Closed` / `Finalized` | |
| `currentNetSale` | `"26061816,00"` (decimalkomma) | omsättning |
| `rowPrice` | `"1,00"` | 1 kr/rad |
| `drawEvents[]` | 13 st | matcherna |

Per `drawEvents[i]`:

| Fält | Exempel | Not |
|---|---|---|
| `eventNumber` | `1` | matchnummer 1–13 |
| `cancelled` | `false` | |
| `match.matchStart` | `"2026-10-10T18:30:00+02:00"` | avspark |
| `match.participants[type=home/away].name` | `"Manchester United"` | fullständigt namn (`mediumName` är förkortat) |
| `match.league.name`, `match.league.country.name` | `"Premier League"`, `"England"` | landsnamn på svenska |
| `svenskaFolket.one/x/two` | `"65"`, `"20"`, `"15"` | streck i hela procent |
| `svenskaFolket.date` | `"2026-10-10T16:00:01.284+02:00"` | ögonblicksbildens tid; används som `streck.tidpunkt` |
| `odds.one/x/two` | `"1,70"` | Svenska Spels (Oddset) aktuella odds. Saknas på äldre omgångar och efter avspark. |
| `startOdds.one/x/two` | `"1,75"` | odds när kupongen öppnade, finns från ca 2021 |
| `tioTidningarsTips.one/x/two` | `5`, `1`, `4` | hur många av tio tidningar som tippar respektive tecken, finns ca 2020–2026 (inte alltid) |

Efter spelstopp ligger slutstrecken kvar i `svenskaFolket`, så de går att hämta i efterhand.

### `result`-objektet (`/draws/{nr}/result`)

| Fält | Exempel |
|---|---|
| `events[].eventNumber`, `.outcome` | `1`, `"2"` (1/X/2) |
| `events[].outcomeScore.home/away` | `0`, `7` |
| `events[].cancelled` | `false` (inställd match: utfallet lottas, `outcome` är ändå satt) |
| `distribution[].name` | `"13 rätt"` … `"10 rätt"` |
| `distribution[].amount` | `"59266,00"` (kr per rad, `"0,00"` om ingen vann) |
| `distribution[].winners` | `77` |

## The Odds API (valfri)

`GET https://api.the-odds-api.com/v4/sports/{sport}/odds?apiKey=…&regions=eu,uk&markets=h2h&oddsFormat=decimal`

- Kräver `ODDS_API_KEY`. Varje anrop kostar 1 kredit per region (alltså 2 med `eu,uk`). Gratisnivån ger 500 krediter i månaden.
  Med vårt schema blir det ungefär 10–11 körningar × 2–4 ligor × 2 = 40–88 krediter i veckan (175–380 i månaden).
  Pipelinen sparar hur många krediter som är kvar (`installningar.oddsapi_krediter_kvar`) och hoppar över
  The Odds API resten av månaden om färre än 30 återstår.
- Svaret är en lista med events (`home_team`, `away_team`, `commence_time`). Per bolag finns
  `bookmakers[].markets[key=h2h].outcomes[]`, där utfallen heter som lagen plus `"Draw"`.
- Matchar mot kupongen på liga (via `config.LIGA_TILL_ODDSAPI`), avspark (±3 h) och lagnamn
  (`pipeline/lagnamn.py`). Om en match inte hittas loggas en varning. Lägg då till ett alias.
- Events försvinner vid avspark, så odds hämtas bara för matcher som inte startat.
- Fixturen `tests/fixtures/oddsapi_soccer_epl.json` är handskriven efter API-dokumentationen
  (vi hade ingen nyckel när koden skrevs). Ersätt den med ett riktigt svar när du har en nyckel.

## football-data.co.uk (matcher utanför kupongen)

`https://www.football-data.co.uk/mmz4281/{säsong}/{liga}.csv`, till exempel `2627/E1.csv` för Championship
2026/27. Ingen nyckel krävs, och robots.txt tillåter hämtning. Filen uppdateras ett par gånger i veckan och
innehåller spelade matcher med resultat (`FTR`) och snittodds före avspark (`AvgH`/`AvgD`/`AvgA`). Ligorna är
E0–E3, SC0, D1, SP1, I1 och F1 (`pipeline/sources/footballdata.py`).

Används bara för matcher utanför kupongen: tillsammans med Sports Moles och FootballPredictions tips (lästa ur
texten utan AI, `pipeline/sidomatcher.py`) lär de tipsarnas vikter i Med experter snabbare. Inga
oddskrediter används.

## Tipsmedoss arkiv (experternas kommentarer)

`https://tipsmedoss.com/category/stryktipsforslag/` (med `page/N/`) listar en analys per Stryktipsomgång sedan
2018. robots.txt tillåter allt. `pipeline/expertarkiv.py` läser artiklarna sedan december 2020, delar upp dem
per match utan AI ("1. Lag – Lag, 1X" följt av kommentaren) och sparar kommentar och tecken i
`expertkommentarer`. Kommandot `expertarkiv` läser hela arkivet (cirka 10 minuter); vanliga körningar läser bara
första sidan. Underlaget för analysen av vad experterna skriver om matcher som skräller.

Kommentarerna märks av AI med en fast temalista (`pipeline/expertteman.py`, till exempel svag form, frånvaro,
motivation, tät matchning, derby) och vilket lag temat gäller. Ett anrop per omgång, bara nattetid lördag–torsdag
21:00–07:30 och högst 120 anrop per natt, så att märkningen bara använder det som är kvar av Geminis dagskvot
innan den nollställs klockan 09. Temalistan ändras inte medan märkningen pågår.

Övriga sajter saknar arkiv. Deras kommentarer är AI:ns sammanfattning per match från tipsinsamlingen
(`tips.sammanfattning`), som kopieras till `expertkommentarer` med `typ = 'sammanfattning'` när omgången har
stängt, och märks på samma sätt. De finns från oktober 2026 och redovisas för sig i analysen.

## Exportformat för egna rader

> Används inte i appen just nu (nedladdningen togs bort 2026-10-10). Sparat som referens.

Svenska Spels sida för uppladdning (`spela.svenskaspel.se/externa-systemspel`) och dess
specifikation kräver inloggning. Formatet nedan bygger därför på oberoende beskrivningar
(t.ex. liverattning.se och Svenska Spels dokument "Beskrivning av tjänsten Egna rader", 2012):

```
Stryktipset
E,1,1,1,1,2,1,2,1,1,X,1,2,1
E,X,X,1,1,2,X,1,1,1,X,1,2,1
```

- En enkelrad per rad: `E` följt av 13 tecken (`1`, `X`, `2`), kommaseparerade.
- Filen kan också innehålla matematiska system (`M…`-rader), men det använder vi inte. Vi exporterar alltid alla enkelrader.
- Rubrikraden `Stryktipset` och radslutet CRLF har inte kunnat bekräftas. Verifiera vid första uppladdningen.
