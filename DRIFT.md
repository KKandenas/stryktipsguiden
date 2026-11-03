# Drifthandbok

Vad du gör när något behöver skötas, utan Claude. Allt görs på github.com/KKandenas/stryktipsguiden.

## Det här sköter sig självt

- **Pipelinen** startas var 15:e minut (cron-job.org) och varje timme (GitHub). Den gör något bara när
  en tid i schemat har passerats: måndag 10:00 (ny kupong), onsdag–fredag 19:00, lördag förmiddag fram
  till spelstopp, lördag kväll och söndag (resultat). Saknas veckans kupong tittar den hos Svenska Spel
  varje timme tills den finns.
- **Hälsokontrollen** körs varannan timme. Hittar den ett problem skapas ett ärende under **Issues** med
  etiketten `driftlarm`, och du får ett mejl. Ärendet stängs av sig självt när problemet är borta.
- **Appen** uppdateras automatiskt efter varje körning (GitHub Pages).

## Köra ett kommando för hand

**Actions → Pipeline → Run workflow →** välj kommando **→ Run workflow**. Det tar 1–5 minuter.

| Kommando | Vad det gör | Kostar |
|---|---|---|
| `tabeller` | Uppdaterar appen med det som redan finns | Inget |
| `svenskaspel` | Hämtar kupong och streck från Svenska Spel | Inget |
| `resultat` | Hämtar resultat och utdelning, räknar om statistiken | Inget |
| `sidomatcher` | Matcher utanför kupongen, och räknar om tipsarnas vikter | Inget |
| `odds` | Odds från spelbolagen | 2–6 oddskrediter |
| `auto` | Allt ovan plus experttips och AI-kommentarer | Oddskrediter och Gemini-kvot |
| `lagkoll` | Lagkollens analyser (bara de sista 36 timmarna före spelstopp) | Gemini-kvot |

Kör hellre `tabeller`, `svenskaspel` eller `resultat` först; de kostar inget. `auto` behövs sällan, eftersom
schemat kör den.

## Larm

Ärendet säger vilket larm det gäller. Testa larmet: **Actions → Hälsokontroll → Run workflow**, kryssa i
*testlarm*. Ett ärende och ett mejl ska komma inom några minuter. Det stängs vid nästa kontroll.

### Veckans kupong saknas
Ingen öppen omgång från tisdag 12:00. Kör `svenskaspel`. Kommer den inte heller då: titta på
svenskaspel.se om veckans Stryktips är öppet (ibland är det uppehåll, till exempel vid landskamper eller
jul). Är kupongen öppen där men inte här har Svenska Spel ändrat något, och då behövs en kodändring.

### Pipelinen har inte startats på flera timmar
Oftast har nyckeln hos cron-job.org gått ut.
1. GitHub → din profilbild → **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
   Skapa en ny (eller förnya den gamla): bara repot `stryktipsguiden`, behörighet **Actions: Read and write**.
2. cron-job.org → jobbet → **Headers** → byt `Authorization: Bearer <nyckel>` mot den nya.
3. Kör jobbet en gång i cron-job.org. Svar 204 betyder att det fungerar.

Mer om uppsättningen står i README under *Extern start*.

### Odds saknas för kupongmatcher
Står det *liganamnet saknas i config.py* kallar Svenska Spel ligan något nytt (till exempel "FA Cup").
1. Öppna `pipeline/config.py` på GitHub och tryck på pennan (Edit).
2. Under `LIGA_TILL_ODDSAPI`: kopiera en rad och ändra landet och ligan till exakt det som står i larmet.
   Oddstjänstens namn (`soccer_...`) finns på the-odds-api.com under *Sports*; till exempel
   `soccer_fa_cup`, `soccer_efl_cup` (Ligacupen) och `soccer_england_league1`.
3. **Commit changes**, och kör sedan `odds` och `tabeller`.

Står det inget om liganamnet har oddstjänsten inga odds för matchen än (vanligt för lägre ligor tidigt i
veckan). Vänta till nästa körning. Matchen visas med Svenska Spels startodds och märks "osäker".

### AI-anropen misslyckas
- **Gemini-nyckeln saknas eller har slutat gälla:** skapa en ny på aistudio.google.com (API keys) och lägg
  in den under **Settings → Secrets and variables → Actions → GEMINI_API_KEY**.
- **En modell har lagts ner** (felet nämner modellnamnet): ändra repo-variabeln `GEMINI_MODELL` eller
  `GEMINI_RESERVMODELLER` under **Settings → Secrets and variables → Actions → Variables** till en modell
  som finns på aistudio.google.com. Se README under *AI*.
- **Kvoten är slut för dagen:** gör inget. Den nollställs kl 09.

Utan AI fungerar Oddsen och Skrällchans som vanligt; Med experter och Lagkoll får mindre underlag.

### Oddskrediterna håller på att ta slut
The Odds API ger 500 gratis krediter i månaden. Kör inte `odds` eller `auto` för hand resten av månaden.
Tar de slut används Svenska Spels startodds tills nästa månad.

### En tipssajt har slutat ge tips
Fredag kväll och lördag: en sajt som hade tips de tre senaste omgångarna har inga den här veckan. Ibland
hoppar sajten bara över en vecka (speltips.se gjorde det 31 oktober 2026); då försvinner larmet nästa vecka.
Kommer det igen veckan efter har sajten troligen bytt utseende, och då behövs en kodändring i
`pipeline/sources/tipssajter/`. Under tiden: lita mer på Oddsen än på Med experter.

### Lagkoll har analyserat få matcher, eller saknar tabeller
Lördag förmiddag: Lagkoll har bara analyserat några få matcher, eller analyserna saknar ligatabell. Det
första beror oftast på att AI-kvoten tog slut (se AI-larmet), det andra på att BBC Sport eller Wikipedia
bytt utseende (kodändring i `pipeline/sources/bbc.py` eller `wikipedia.py`). Lagkoll är en skuggmodell;
Oddsen och Skrällchans påverkas inte.

### Resultat och utdelning saknas
Kör `resultat`. Kommer inget: Svenska Spel kan ha skjutit upp eller ställt in en match. Omgången rättas när
facit finns.

## Övrigt

- **Firestore-reglerna** (inloggning och Mina spel) publicerar du själv i Firebase-konsolen när
  `firestore.rules` ändras. Se FIREBASE.md.
- **Data som verkar fel i appen:** kör `tabeller`. Hjälper det inte, kör `auto` en gång.
- **Planer och avstämningar** står i FARDPLAN.md, och instruktioner för Claude i CLAUDE.md.
