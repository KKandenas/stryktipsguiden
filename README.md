# Stryktipsguiden

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
| 5 | Lärande från historik och backtest | ✅ |

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
| `python -m pipeline statistik` | Källstatistik, träning av ensemble-v1, backtest och modellval (körs annars automatiskt när nya resultat finns) |
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
| Mån 10:00 / 09:00 | Ny kupong (öppnar 07:00), streck, odds, tips och AI-kommentarer |
| Ons, tor, fre 19:00 / 18:00 | Uppdaterade streck, odds och tips |
| Lör 10:30, 11:30, 12:30 / 09:30, 10:30, 11:30 | Förmiddagsuppdateringar före lunch |
| Lör 14:00, 15:00, 15:25 (vintertid även 15:20) | Sista streck och odds före spelstopp 15:59 |
| Sön 10:00 och 20:00 | Resultat och utdelning (fas 5: källstatistik) |

GitHub-cron kan vara försenad 5–30 minuter. Därför finns det flera lördagskörningar, och en stängd
omgång hämtas om i upp till 48 timmar så att slutstrecken alltid kommer med. Alla steg är idempotenta,
så det är ofarligt att köra något två gånger. Du kan också köra manuellt under **Actions → Pipeline →
Run workflow**, inklusive backfill.

**Frysning:** vid varje körning medan omgången är öppen sparas en ögonblicksbild av kupongen
(`frysta_kuponger`, migrering 009). Efter spelstopp visar appen den senaste bilden, alltså läget vid
sista körningen före spelstopp, så att förslaget och rättningen inte ändras när slutstrecken kommer in.

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
- **odds-v2** (basmodell sedan oktober 2026) väger bolagen efter hur skarpa de är: Pinnacle 3,
  börser (Betfair, Matchbook, Smarkets) 2, Svenska Spels aktuella odds ½ och övriga 1. Med bara
  ett bolag blir den identisk med `odds-v1`, som också räknas vidare för jämförelse.
- **Versioner** (`modeller.py`): varje modell har en version (nu `odds-v2`). Prognoserna sparas per
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

**https://kkandenas.github.io/stryktipsguiden/**. Lägg till `?exempel` i adressen för att alltid se exempelkupongen.

Appen ligger i `docs/` och består av `index.html`, `app.css`, `app.js`, `optimizer.js` och `backtest.js`. Den läser
`kupong.json` och faller tillbaka på `exempel-kupong.json` om filen saknas. Vald budget och låsta
tecken sparas i webbläsarens localStorage, per omgång.

**Vyer** (menyn högst upp, adresser med `#` så att bakåtknappen fungerar):

| Vy | Innehåll |
|---|---|
| `#kupong` | Veckans kupong med radförslag. Mellan spelstopp och måndag visas den stängda eller rättade omgången. |
| `#rattning` | **Förra omgången**: senast stängda omgången (`senaste.json`) med resultat, vilka tecken som gick in och hur många rätt och kronor systemet gav. Använder den budget och de låsningar du hade den veckan, om de finns sparade. |
| `#statistik` | Så har modellen träffat |
| `#backtest` | Om du spelat varje vecka |
| `#hjalp` | Så läser du kupongen |
| `#om` | Så funkar Stryktipsguiden: syfte, källor, hur chans, värde och rader räknas fram, uppdateringar |

**Cache:** filerna laddas med versionsnummer (`app.js?v=…`) så att mobilen aldrig blandar gammal
och ny kod efter en uppdatering. **Byt versionen överallt när appen ändras** (`index.html`,
`app.js`, `backtest.js`). Testet `tests/test_appfiler.py` kontrollerar att de är lika.

Lokalt (ES-moduler kräver en server, så det går inte att dubbelklicka på filen):
```bash
python3 -m http.server 8765 -d docs
```
Öppna sedan http://localhost:8765.

### Radoptimering (`docs/optimizer.js`)

Antalet rader bestämmer garderingarna exakt (2^halv · 3^hel = rader):

| Rader | 1 | 16 | 32 | 48 | 64 | 96 | 128 | 144 | 192 | 256 | 384 | 576 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Fördelning | 13 spik | 4 halv | 5 halv | 4 halv + 1 hel | 6 halv | 5 halv + 1 hel | 7 halv | 4 halv + 2 hel | 6 halv + 1 hel | 8 halv | 7 halv + 1 hel | 6 halv + 2 hel |

För varje match och teckenval S räknas en poäng ut:
`(1 − λ)·log(Σ chans) + λ·log(Σ chans/streck)`. Första delen är träffchansen, och den andra är
förväntad utdelning, där understreckade tecken betalar mer. Dynamisk programmering över
(match, antal halv, antal hel) hittar den kombination som ger högst total poäng. Låsta tecken blir tvingade val.

(Fram till oktober 2026 fanns 432 rader = 4 halv + 3 hel i stället för 256; tabellen nedan är från då.)

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
Orange prick visas när chansen är minst 3 procentenheter över strecken (`VARDE_GRANS`). Matcher där
bara Svenska Spels odds finns (oftast Superettan och nedåt, eftersom The Odds API inte täcker dem)
märks *osäkrare* och kräver 5 procentenheter (`VARDE_GRANS_OSAKER`). I historiken är oddsens försprång
mot folket mindre där: Brier 0,609 mot 0,615 för Ettan och division 2, jämfört med 0,614 mot 0,627 för
engelska matcher.

**Experterna i matchvyn** rankas efter träffsäkerhet på matcher från samma land (England/Sverige/
Övrigt), senaste 8 veckorna, med minst 10 matcher. Annars används hela historiken, och om det inte
räcker heller, alla ligor. Poäng: rätt spik 1, halvgardering ½, helgardering ⅓.


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
| hurbra.se | svensk, en artikel per omgång ("Tipset: X2") | adressen följer spelstoppets datum: `/stryktipset-10-oktober-2026/` |
| bettingstugan.se | svensk, analys med tecken per match | länk med omgångens datum på `/stryktipset`, huvudanalysen i första hand |
| tippat.se | svensk, expertens kupong ("Sparka & Spring") | fast sida; valda tecken (färgmarkerade i HTML) märks upp som `[VALT 1]`, och kupongens datum kontrolleras |
| gamblingcabin.se | svensk, panelens spikar och drag (bara några matcher) | senaste panelen från `/speltips/`, publiceringsdatumet ska vara veckan före spelstopp |
| sportsgambler.com | internationell, en artikel per match | ligasidornas länkar `<hemma>-vs-<borta>-prediction-…-<datum>` paras med kupongen |
| footballpredictions.com | internationell, en artikel per match ("Our prediction: 2 - 1") | ligasidornas länkar med datum (PL, Championship, Bundesliga, Serie A, Ligue 1) |
| sportsmole.co.uk | internationell, en artikel per match ("We say: 2-1") | ligasidornas länkar paras på lagnamn; artikelns avsparksdatum kontrolleras efter hämtning |

Undersökta men inte använda: forebet.com, predictz.com, windrawwin.com, sportytrader.com,
oddspedia.com, squawka.com, betensured.com, oddschecker.com och whoscored.com blockerar automatiska
anrop. Sportskeeda och FootyStats spärrar AI-tjänster, och vitibet.com spärrar en rad AI-robotar
och skriver att de inte vill att data tas för AI. Därför används inte heller den, trots att den
har sannolikheter per match. bettingexpert.com och mightytips.com går inte att läsa utan JavaScript. Aftonbladet och Expressen spärrar AI-tjänster i robots.txt. livescore.com spärrar sina
nyhetssidor för AI-tjänster. dagensbastaspel.se saknar en Stryktipssida.

**Inga resultatläckor:** tips tolkas bara för matcher som inte har startat. Tipssidor visar
livestatus och resultat efter avspark, och det får inte påverka tipset (gäller tidiga matcher före
spelstopp).

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
variables → Actions → fliken Variables, t.ex. `gemini-2.5-flash`. Dessutom: tänkande (`GEMINI_TANKANDE = "low"`) och omförsök vid 429 och 5xx (gratisnivån har låga
gränser per minut och är ibland överbelastad). Spärrar så att en körning alltid hinner spara sin data:
högst 2 min per anrop, 3 misslyckade anrop i rad stänger av AI resten av körningen, och högst 15 min AI
per körning. Det som inte hanns med tas vid nästa körning. En körning gör cirka 15 anrop: 13 matchartiklar, 1 kupongartikel och 1 för kommentarerna.

**Kostnad:** Geminis gratisnivå räcker för det här. Observera att Google får använda innehåll som
skickas på gratisnivån för att förbättra sina produkter. Här är det bara publika artiklar och
kupongdata. Med Claude (`claude-opus-5-5`) blir det cirka 5–10 USD i månaden.

**Lägg till en sajt:** se `pipeline/sources/tipssajter/__init__.py`. Det är en klass med
`hitta_artiklar()`, och resten (hämtning, AI, lagring, kommentarer) sköts automatiskt.

## Lärande från historik (fas 5)

`pipeline/model/statistik.py` körs automatiskt när en ny omgång blivit avgjord (oftast söndag):

1. **Källstatistik** (`kallstatistik`): Brier score och träffprocent per källa och liga mot faktiska
   resultat. Källorna är Svenska folket (streck), Tio tidningars tips, speltips.se och sportsgambler.com.
   Tips som bara anger tecken räknas om till sannolikheter: valda tecken delar på 80 %.
2. **ensemble-v1** (`pipeline/model/ensemble.py`): logistisk regression som väger ihop odds, streck och
   tips som ett viktat geometriskt snitt, `log p ∝ Σ vikt_källa · log p_källa` plus en justering per
   tecken. En källa som saknas för en match påverkar inte den matchen, och en källa vägs in först när
   den finns för minst 200 träningsmatcher. Vikterna skattas med Newtons metod, i ren Python.
3. **Walk-forward-backtest:** varje historisk omgång förutsägs med vikter som bara tränats på tidigare
   omgångar (omträning var fjärde omgång, start efter 500 matcher). Prognoserna sparas i `prognoser`
   och vikterna i `modellvikter`.
4. **Modellstatistik** (`modellstatistik`): Brier, log loss och träffprocent per modellversion och liga,
   på samma matcher för alla versioner.
5. **Modellval:** ensemble-v1 tas i bruk bara om den har lägre log loss än odds-v1 på de senaste
   520 matcherna (cirka 40 omgångar). Beslutet sparas i `installningar.aktiv_modell`.

**Läget i oktober 2026** (2 782 matcher, 2022–2026):

| | Brier | Log loss | Träff |
|---|---|---|---|
| odds-v1 (används) | 0,6079 | 1,0141 | 49 % |
| ensemble-v1 | 0,6091 | 1,0161 | 49 % |
| Svenska folket | 0,6146 | – | 50 % |
| Tio tidningars tips | 0,8207 | – | 50 % |

Sammanvägningen slår ännu inte oddsen. Bookmakers odds innehåller redan det strecken och tidningarna
vet, så **appen använder bara odds**, precis som det är tänkt tills något bevisligen är bättre.
Valet görs om varje vecka: när tipssajterna och bookmakeroddsen från The Odds API har samlat
historik kan ensemble-v1 ta över av sig själv.

Under **"Så har modellen träffat"** kan man välja startår (Alla eller från 2023, 2024 osv.). Exporten
räknar då om modellernas, källornas och ligornas träffsäkerhet från det året
(`export.statistik_per_ar`). Modellerna jämförs alltid på samma matcher. I appen visar avsnittet tabellen ovan, träffsäkerhet per liga och hur
många rätt modellens och folkets favorittecken fick de senaste tio omgångarna.

### Förslaget "Med experter" (tips-v1)

I appen heter förslagen **Oddsen** (basmodellen `odds-v2`) och **Med experter** (`tips-v1`).
Med experter är ett parallellt förslag som väljs med växeln **Oddsen / Med experter** högst upp på kupongen.
Det väljs aldrig automatiskt. `tips-v1` väger ihop bookmakerodds (odds-v2) och tipsarna (Tio
tidningars tips, speltips.se, sportsgambler.com) med samma logistiska regression som ensemble-v1,
men utan strecken:

- **Startvikt 0,1** för en ny tipsare. Från 30 avgjorda matcher skattas en egen vikt, med straff mot
  startvikten (`l2 = 5`), så att lite data bara flyttar vikten lite.
- Vikterna tränas om varje söndag. Historiken backtestas walk-forward precis som ensemble-v1, och
  `tips-v1` mäts i modellstatistiken bredvid odds-v2.
- Tips som bara anger tecken räknas om till sannolikheter (80 % på valda tecken).
- **Experternas system:** AI-tolkningen plockar också ut tecknen i skribentens system eller kupong per
  match (`tips.system`) och systemets storlek (`tips.system_rader`, migrering 008). Varje sajts system
  är en egen källa, "namn (system)", med egen startvikt och inlärd vikt, och räknas om med samma
  spik/halv/hel-regel. Olika stora system hanteras bara genom den inlärda vikten. Finns flera system i
  en artikel används det minsta.
- Appen visar varje tipsares träffprocent, antal matcher och vikt under *Så har modellen träffat*.

Läget i oktober 2026: Tio tidningars tips har vikt 0,016 (3 692 matcher, tillför nästan inget utöver
oddsen). speltips.se, hurbra.se, bettingstugan.se, tippat.se, gamblingcabin.se, sportsgambler.com,
sportsmole.co.uk och footballpredictions.com samlas in från och med nu
och står på startvikten tills de har 30 avgjorda matcher, vilket tar ungefär 3–4 veckor.

### Försök: optimera mot förväntad utdelning (inte infört)

Utdelningen kan förutsägas mycket väl från strecken på de rätta tecknen
(`log utdelning ≈ a + b·Σ log streck`, R² 0,90 för 13 rätt och 0,97 för 12–10 rätt, med 15 kr som
lägsta utbetalning). En optimerare som maximerade förväntad utdelning enligt den modellen testades
i oktober 2026 och **gav sämre verkligt utfall** i backtestet än dagens metod. Den valde tecken där
oddsen och strecken skiljer sig mest, och just där har sannolikheterna mest brus, som förstärks
över 13 matcher. Att dra sannolikheterna mot strecken hjälpte inte heller. Backtestet
(253 omgångar) är dessutom för brusigt för att finjustera λ: ett byte från 0,30 till 0,25 ändrar
utfallet kraftigt beroende på enstaka 12-rättare. Därför behålls λ = 0,3. Försöket kan göras om
när historiken har skarpare odds (odds-v2 med Pinnacle).

Historiska stängningsodds från football-data.co.uk används inte, eftersom sajtens robots.txt
uttryckligen spärrar AI-tjänster.

### Backtest: "Om du hade spelat varje vecka"

Pipelinen skriver `docs/historik.json` (cirka 160 kB), med chans, streck, resultat och utdelning för
13–10 rätt för varje avgjord omgång där modellen har prognoser (från december 2021). Appen laddar
filen först när avsnittet öppnas och kör varje omgång genom **samma `optimizer.js`** som tar fram
dina rader, så backtestet räknar exakt som appen. Logiken finns i `docs/backtest.js`.

- Du väljer startår och förslag (Modellen eller Tipsviktat; `historik.json` har den tipsviktade chansen
  som åttonde fält per match), antal rader per vecka (1–576), och ser insats, tillbaka, netto, antal 13/12/11/10 rätt,
  saldot vecka för vecka, utfallet per år och de största vinsterna.
- Som jämförelse visas "Folket": samma antal rader, men valda efter strecken i stället för modellens chans.
- Utdelningen räknas som om dina rader inte hade påverkat potten. Vissa veckor ger 10 eller 11 rätt
  ingen utdelning alls, när väldigt många har det. Det kommer med eftersom vi använder de riktiga beloppen.

Exempel med 64 rader i veckan och 253 omgångar: modellen fick tillbaka 46 % (−8 807 kr) och folket
13 % (−14 125 kr). Svenska Spel behåller ungefär en tredjedel av insatserna, så att gå plus är svårt.
Modellen förlorar betydligt mindre än att följa folket.

## kupong.json

Det enda appen läser. Formatet finns beskrivet i början av `pipeline/export.py`. Kort sammanfattat:
omgång (id, datum, spelstopp, status), och för varje match lag, liga, avspark, `chans`, `streck`,
`varde` och `odds` (för 1/X/2), tips, kommentar och resultat. `statistik` innehåller det som visas
under "Så har modellen träffat".
`docs/exempel-kupong.json` är omgång 4974 visad som öppen, så att appen kan testas även när ingen
omgång är öppen. `docs/senaste.json` har samma format och innehåller den senast stängda omgången
(för rättningen), och `docs/historik.json` är underlaget för backtestet.

## Datakällor

Se [DATAKALLOR.md](DATAKALLOR.md) för exakta endpoints och fält.
