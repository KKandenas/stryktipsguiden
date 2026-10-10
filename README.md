# Stryktipshjälpen

Föreslår rader till Stryktipset utifrån hur många rader du vill spela, med en kommentar till varje
match. Bakom appen samlar en automatisk pipeline på GitHub historik, så att förslagen blir bättre över tid.

```
GitHub Actions (schema)                          GitHub Pages
┌──────────────────────────────┐   committar    ┌──────────────────────────┐
│ python -m pipeline auto      │ ─────────────▶ │ docs/  (statisk webbapp) │
│  Svenska Spel, The Odds API  │  data/*.db     │  läser bara kupong.json  │
│  tipssajter, Gemini (fas 4)  │  kupong.json   └──────────────────────────┘
└──────────────────────────────┘
```

- **Pipeline** (`pipeline/`): Python. Hämtar data, sparar i SQLite (`data/stryktips.db`, committas
  till repot), räknar sannolikheter och exporterar `docs/kupong.json`.
- **App** (`docs/`): HTML, CSS och JS utan byggsteg. Ingen backend och inga nycklar i webbläsaren.
- **AI** (fas 4): Gemini (eller Claude) anropas bara från pipelinen.

## Status

| Fas | Innehåll | Klar |
|---|---|---|
| 1 | Datainsamling: kupong, streck, odds, resultat, utdelning | ✅ |
| 2 | Sannolikhetsmodell och export av `kupong.json` | ✅ |
| 3 | Webbappen och radoptimering | ✅ |
| 4 | Tipssajter och AI-kommentarer | ✅ |
| 5 | Lärande från historik och backtest | |

## Kom igång lokalt

Kräver Python 3.9 eller senare.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest              # testerna kräver inget nätverk
.venv/bin/python -m pipeline auto       # hämtar det som är aktuellt just nu
```

Kommandon:

| Kommando | Gör |
|---|---|
| `python -m pipeline auto` | Det schemat kör: Svenska Spel, odds och resultat, det som är aktuellt |
| `python -m pipeline svenskaspel` | Öppna omgångar: kupong, streck, Svenska Spels odds, Tio tidningars tips |
| `python -m pipeline odds` | The Odds API för öppna omgångar (kräver `ODDS_API_KEY`) |
| `python -m pipeline resultat` | Resultat och utdelning för omgångar efter spelstopp |
| `python -m pipeline backfill 4700 4973` | Hämta historiska omgångar (1 s paus mellan anrop) |
| `python -m pipeline tips` | Hämta tipsartiklar och låt AI-modellen tolka dem (kräver `GEMINI_API_KEY`) |
| `python -m pipeline kommentarer` | Skriv AI-kommentarer för öppna omgångar (kräver `GEMINI_API_KEY`) |
| `python -m pipeline prognos [--alla]` | Räkna sannolikheter med aktiv modellversion (`--alla` räknar om hela historiken) |
| `python -m pipeline export` | Skriv `docs/kupong.json` (närmaste öppna omgång, annars den senaste) |
| `python -m pipeline export --omgang 4974 --till docs/exempel-kupong.json --dolj-resultat` | Skapa exempelfilen |
| `python -m pipeline migrera` | Kör bara databasmigreringarna |

Lägg till `-v` för mer loggning. Miljövariabeln `STRYKTIPS_DB` styr vilken databasfil som används
(bra för att testa utan att röra `data/stryktips.db`).

## GitHub: Secrets och inställningar

| Secret | Krävs | Används till |
|---|---|---|
| `ODDS_API_KEY` | Nej | Bookmakerodds från [The Odds API](https://the-odds-api.com). Utan nyckel används bara Svenska Spels egna odds. |
| `GEMINI_API_KEY` | Nej, men behövs för fas 4 | Gemini: tolkning av tipsartiklar och matchkommentarer. Gratis nyckel på aistudio.google.com. |
| `ANTHROPIC_API_KEY` | Nej | Alternativ till Gemini (Claude). Används bara om `GEMINI_API_KEY` saknas eller `AI_LEVERANTOR=claude`. |

Lägg till dem under **Settings → Secrets and variables → Actions → New repository secret**.

Gör också så här:
1. **Settings → Pages**: välj Deploy from branch, `main` och `/docs`.
2. Om workflowet får "permission denied" vid push: **Settings → Actions → General → Workflow
   permissions → Read and write**.
3. Repot måste vara publikt för att Pages ska fungera på ett gratiskonto. Databasen blir då också publik.

## Schema

`.github/workflows/pipeline.yml` kör `python -m pipeline auto` (svensk tid, sommar/vinter):

| När | Varför |
|---|---|
| Tor 19:00 / 18:00 | Ny kupong, streck, odds |
| Lör 14:00, 15:00, 15:25 (vintertid även 15:20) | Sista streck och odds före spelstopp 15:59 |
| Sön 10:00 och 20:00 | Resultat och utdelning (fas 5: källstatistik) |

GitHub-cron kan vara försenad 5–30 minuter. Därför finns det flera lördagskörningar, och en stängd
omgång hämtas om i upp till 48 timmar så att slutstrecken alltid kommer med. Alla steg är idempotenta,
så det är ofarligt att köra något två gånger. Du kan också köra manuellt under **Actions → Pipeline →
Run workflow**, inklusive backfill.

## Databasen

`data/stryktips.db` (SQLite). Alla tider är i UTC.

| Tabell | Innehåll |
|---|---|
| `omgangar` | Omgång (Svenska Spels nummer), datum, spelstopp, omsättning, utdelning och antal vinnare för 13–10 rätt |
| `matcher` | 13 per omgång: lag, liga, land, avspark, resultat, mål, inställd |
| `streck` | Svenska folkets streck (%), en rad per ögonblicksbild där något ändrats |
| `odds` | Odds per bolag och ögonblicksbild. `svenskaspel` = aktuella, `svenskaspel_start` = vid öppning, övriga = The Odds API |
| `kallor` | Tipskällor (t.ex. Tio tidningars tips, och tipssajter från fas 4) |
| `tips` | Senaste tipset per match och källa |
| `prognoser` | Modellens sannolikheter per modellversion (fas 2) |
| `kallstatistik` | Brier score per källa och liga (fas 5) |

**Migreringar** ligger i `pipeline/migrations/NNN_namn.sql` och körs automatiskt i nummerordning.
Ändra aldrig en fil som redan körts. Lägg i stället till en ny med nästa nummer.

**Felhantering:** varje källa valideras innan något sparas (13 matcher, streck som summerar till
cirka 100, odds över 1,0 och så vidare). En trasig källa loggas som fel, och pipelinen fortsätter
med resten. Körningen markeras som misslyckad i Actions bara om Svenska Spel eller resultaten fallerar.

## Sannolikhetsmodellen

`pipeline/model/`:
- **Odds till sannolikhet** (`sannolikhet.py`): 1/odds delas med summan, så att bookmakerns marginal
  försvinner. Har vi odds från flera bolag används snittet. Svenska Spels startodds används bara om
  inga senare odds finns.
- **Värde per tecken** = vår sannolikhet − streckandelen. Positivt värde betyder understreckat, och
  ett sådant tecken ger högre utdelning om det går in.
- **Versioner** (`modeller.py`): varje modell har en version (nu `odds-v1`). Prognoserna sparas per
  version i `prognoser`, så att versionerna kan jämföras i backtest. Ändra aldrig en befintlig version,
  skapa en ny.

Utvärdering på 3 245 matcher (2021–2026, Svenska Spels startodds). Lägre är bättre:

| | Brier | Log loss |
|---|---|---|
| Odds, proportionell metod | 0,6081 | 1,0146 |
| Odds, potensmetod | 0,6083 | 1,0147 |
| Svenska folkets streck | 0,6188 | 1,0315 |

Oddsen träffar tydligt bättre än strecken, och den skillnaden är vad värdet bygger på.

## Appen

**https://kkandenas.github.io/stryktipshjalpen/**. Lägg till `?exempel` i adressen för att alltid se exempelkupongen.

Appen ligger i `docs/` och består av `index.html`, `app.css`, `app.js` och `optimizer.js`. Den läser
`kupong.json` och faller tillbaka på `exempel-kupong.json` om filen saknas. Vald budget och låsta
tecken sparas i webbläsarens localStorage, per omgång.

Lokalt (ES-moduler kräver en server, så det går inte att dubbelklicka på filen):
```bash
python3 -m http.server 8765 -d docs
```
Öppna sedan http://localhost:8765.

### Radoptimering (`docs/optimizer.js`)

Antalet rader bestämmer garderingarna exakt (2^halv · 3^hel = rader):

| Rader | 1 | 32 | 64 | 96 | 128 | 192 | 432 |
|---|---|---|---|---|---|---|---|
| Fördelning | 13 spik | 5 halv | 6 halv | 5 halv + 1 hel | 7 halv | 6 halv + 1 hel | 4 halv + 3 hel |

För varje match och teckenval S räknas en poäng ut:
`(1 − λ)·log(Σ chans) + λ·log(Σ chans/streck)`. Första delen är träffchansen, och den andra är
förväntad utdelning, där understreckade tecken betalar mer. Dynamisk programmering över
(match, antal halv, antal hel) hittar den kombination som ger högst total poäng. Låsta tecken blir tvingade val.

**Risknivån λ = 0,3** valdes efter backtest på 252 avgjorda omgångar med riktiga utdelningar för 10–13 rätt:

| λ | Andel omgångar med ≥11 rätt (192 rader) | Återbetalning 192 rader | Återbetalning 432 rader |
|---|---|---|---|
| 0,0 | 20 % | 45 % | 37 % |
| 0,3 | 20 % | 44 % | 96 % |
| 0,5 | 11 % | 24 % | 25 % |
| 0,7 | 4 % | 27 % | 52 % |

Upp till λ ≈ 0,3 kostar värdetänkandet nästan ingen träffsäkerhet. Högre λ sänker träffsäkerheten
tydligt. Återbetalningen är brusig, eftersom ett fåtal 13-rättare avgör mycket, och historiken
bygger på Svenska Spels startodds. Den ska därför läsas som en riktning, inte en garanti.
Orange prick visas när chansen är minst 3 procentenheter över strecken (`VARDE_GRANS`).

### Export av rader

"Ladda ner rader" ger en textfil i formatet för egna rader: `Stryktipset` på första raden och
sedan en enkelrad per spelrad, `E,1,X,2,…` med 13 tecken, radslut CRLF. Formatet bygger på flera
oberoende beskrivningar. Svenska Spels egen specifikation kräver inloggning och har inte kunnat
verifieras. **Kontrollera första gången** genom att ladda upp filen under Stryktipset → Externa
systemspel när du är inloggad. Om Svenska Spel inte vill ha rubrikraden: ändra `raderTillFil` i
`docs/optimizer.js`.

### Tester

```bash
node --test tests/js/*.test.mjs
```
Körs automatiskt i GitHub Actions. Lokalt krävs Node 18 eller senare.

## Tipssajter och AI (fas 4)

AI anropas bara från pipelinen (`pipeline/ai/`), aldrig från appen. **Gemini** är förvalt
(`gemini-3.8-flash`, gratisnivå via Google AI Studio). Claude finns kvar som alternativ.
Leverantören väljs efter vilken nyckel som finns: `GEMINI_API_KEY` i första hand och
`ANTHROPIC_API_KEY` i andra. `AI_LEVERANTOR=claude` tvingar Claude. Utan nyckel, eller på
Python < 3.10 där SDK:erna inte finns, hoppas AI-stegen över med en loggrad.

| Källa | Typ | Hur artiklar hittas |
|---|---|---|
| Tio tidningars tips | svensk, från Svenska Spel | ingår i kupongdatan (fas 1) |
| speltips.se | svensk, en artikel per omgång | RSS-flödet: nyaste "Stryktipset d/m" veckan före spelstopp |
| sportsgambler.com | internationell, en artikel per match | ligasidornas länkar `<hemma>-vs-<borta>-prediction-…-<datum>` paras med kupongen |

Undersökta men inte använda: forebet.com, predictz.com och windrawwin.com blockerar automatiska anrop
(Cloudflare), och gamblingcabin.se har inte publicerat tips sedan 2023.

**Hämtning** (`pipeline/webb.py`): robots.txt respekteras, sajter med bot-skydd hoppas över,
2 sekunders paus mellan anrop till samma sajt och cache i `data/cache/` (sparas mellan körningar
med `actions/cache`, committas inte). Själva artikeltexten sparas aldrig i databasen, bara en hash.

**Tolkning** (`pipeline/ai/extraktion.py`): modellen får matchlistan och artikeltexten och svarar
med strikt JSON enligt ett schema: tecken (1/X/2 eller gardering), sannolikheter bara om artikeln
anger dem, och en kort sammanfattning på svenska. Svaret valideras innan det sparas i `tips`.
En artikel tolkas om bara om texten ändrats och den förra tolkningen är äldre än 12 timmar.

**Kommentarer** (`pipeline/ai/kommentarer.py`): 1–2 meningar per match utifrån chans, streck, värde
och tipsen. En kommentar skrivs om bara när underlaget ändrats märkbart (avrundade värden hashas).

**Inställningar** i `pipeline/ai/klient.py`: modell (`GEMINI_MODELL`, standard `gemini-3.8-flash`).
Den kan bytas utan kodändring via repo-variabeln `GEMINI_MODELL` under Settings → Secrets and
variables → Actions → fliken Variables, t.ex. `gemini-2.5-flash`. Dessutom: tänkande (`GEMINI_TANKANDE = "low"`) och omförsök vid 429 (gratisnivån har låga
gränser per minut). En körning gör cirka 15 anrop: 13 matchartiklar, 1 kupongartikel och 1 för kommentarerna.

**Kostnad:** Geminis gratisnivå räcker för det här. Observera att Google får använda innehåll som
skickas på gratisnivån för att förbättra sina produkter. Här är det bara publika artiklar och
kupongdata. Med Claude (`claude-opus-5-5`) blir det cirka 5–10 USD i månaden.

**Lägg till en sajt:** se `pipeline/sources/tipssajter/__init__.py`. Det är en klass med
`hitta_artiklar()`, och resten (hämtning, AI, lagring, kommentarer) sköts automatiskt.

## kupong.json

Det enda appen läser. Formatet finns beskrivet i början av `pipeline/export.py`. Kort sammanfattat:
omgång (id, datum, spelstopp, status), och för varje match lag, liga, avspark, `chans`, `streck`,
`varde` och `odds` (för 1/X/2), tips, kommentar (från fas 4) och resultat.
`docs/exempel-kupong.json` är omgång 4974 visad som öppen, så att appen kan testas även när ingen
omgång är öppen.

## Datakällor

Se [DATAKALLOR.md](DATAKALLOR.md) för exakta endpoints och fält.
