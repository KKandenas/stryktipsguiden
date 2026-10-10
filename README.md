# Stryktipshjälpen

Föreslår rader till Stryktipset utifrån hur många rader du vill spela, med en kommentar till varje
match. Bakom appen samlar en automatisk pipeline på GitHub historik, så att förslagen blir bättre över tid.

```
GitHub Actions (schema)                          GitHub Pages
┌──────────────────────────────┐   committar    ┌──────────────────────────┐
│ python -m pipeline auto      │ ─────────────▶ │ docs/  (statisk webbapp) │
│  Svenska Spel, The Odds API  │  data/*.db     │  läser bara kupong.json  │
│  (fas 4: tipssajter, Claude) │  kupong.json   └──────────────────────────┘
└──────────────────────────────┘
```

- **Pipeline** (`pipeline/`): Python. Hämtar data, sparar i SQLite (`data/stryktips.db`, committas
  till repot), räknar sannolikheter och exporterar `docs/kupong.json`.
- **App** (`docs/`): HTML, CSS och JS utan byggsteg. Ingen backend och inga nycklar i webbläsaren.
- **AI** (fas 4): Claude anropas bara från pipelinen.

## Status

| Fas | Innehåll | Klar |
|---|---|---|
| 1 | Datainsamling: kupong, streck, odds, resultat, utdelning | ✅ |
| 2 | Sannolikhetsmodell och export av `kupong.json` | ✅ |
| 3 | Webbappen och radoptimering | |
| 4 | Tipssajter och AI-kommentarer | |
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
| `ANTHROPIC_API_KEY` | Från fas 4 | Claude: extraktion av tips och matchkommentarer |

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

## kupong.json

Det enda appen läser. Formatet finns beskrivet i början av `pipeline/export.py`. Kort sammanfattat:
omgång (id, datum, spelstopp, status), och för varje match lag, liga, avspark, `chans`, `streck`,
`varde` och `odds` (för 1/X/2), tips, kommentar (från fas 4) och resultat.
`docs/exempel-kupong.json` är omgång 4974 visad som öppen, så att appen kan testas även när ingen
omgång är öppen.

## Datakällor

Se [DATAKALLOR.md](DATAKALLOR.md) för exakta endpoints och fält.
