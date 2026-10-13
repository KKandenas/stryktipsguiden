# Färdplan för Stryktipsguiden

*Skriven i oktober 2026.*

Grunden är byggd. Nästa halvår handlar mest om att samla avgjorda omgångar, följa driften och fatta beslut om
Lagkoll och Skrällchans när det finns tillräckligt med underlag. Inga nya modeller byggs innan det finns data
som talar för dem.

## Senast tillagt (13 oktober 2026)

- Länk till Svenska Spel under radförslaget.
- Oddsen i matchdetaljen visar snittet direkt. Bolagen, upp till 12, fälls ut på begäran.
- Backtest per systemstorlek: alla storlekar sida vid sida för valt förslag och period.
- "Sedan premiären" (12 oktober 2026) i backtestets periodval: förslagen som faktiskt visades, utan simulering.

## Läget i dag

| Del | Status |
|---|---|
| Förslag | Oddsen, Med experter, Lagkoll och Skrällchans, 1–576 rader |
| Lagkoll (`lagkoll-v1`) | Lagnyheter ur förhandsartiklar och AI-justering från fredag kväll. Under test. |
| Skrällchans | Kvot chans/streck 1,25–1,5, högst tre per omgång. 1 skräll upp till 64 rader, 2 däröver. |
| Tabell och form | BBC Sport med Wikipedia som reserv, uppdateras vid varje körning |
| Driftstatus | Om-sidan (`#om`): körning, oddskrediter, AI, tips och Lagkoll |
| AI | Gemini 3.8 → 3.7 → 3.6 → 3.5 Flash. Gratiskvoten räknas per modell och dag. |

## Tidslinje

### Vecka 42 (12–18 oktober): första riktiga helgen
- [ ] Onsdag kväll: kontrollera i driftstatusen att AI-raden visar lyckade anrop med reservkedjan.
- [ ] Fredag 19 och lördag förmiddag: Lagkoll gör sina första analyser, och skrällchanserna dyker upp när
  strecken skiljer sig från oddsen. Det sker automatiskt.
- [ ] Söndag eller måndag: gå igenom Lagkollens första analyser. Tolkades lagnyheterna rätt, och är
  justeringarna rimliga mot hur matcherna slutade?

### Vecka 43–48 (oktober–november): inkörning
- [ ] Titta på driftstatusen efter varje helg. Upprepade AI-avbrott eller låga oddskrediter är signalen att
  agera.
- [ ] Rätta Lagkollens instruktioner (`pipeline/lagkoll.py`, `ai/extraktion.py`) om den misstolkar artiklar.
- [ ] Vintertid från 25 oktober: kontrollera lördag 31 oktober att sista körningen före spelstopp hamnar nära
  15:59. Cron i `.github/workflows/pipeline.yml` går i UTC.
- [ ] Håll nere antalet manuella körningar, så att Geminis gratiskvot räcker till de schemalagda. Kommandot
  `tabeller` uppdaterar appen utan AI och utan oddskrediter.

### December–januari (efter 8–12 omgångar): första avstämningen
- [ ] Lagkoll mot Oddsen på cirka 100–150 matcher. Det ger en fingervisning, inte ett beslut.
- [ ] Skrällchans i verkligheten: gick skrällarna in ungefär som i backtestet, cirka 29 %?
- [ ] Med experter: har vikterna för de nya tipssajterna flyttat sig från startvikten?

### Mars–april 2027 (ungefär en halv säsong): beslut om Lagkoll
- [ ] Med cirka 300 jämförbara matcher: behåll Lagkoll som eget förslag, väg in den i Oddsen eller ta bort den.
- [ ] Testa Lagkollens skrällrisk (låg/medel/hög) som filter när Skrällchans väljer skrällar.
- [ ] Allsvenskan startar i april: kontrollera svenska tabeller, tipssajter och lagnamn (`lagnamn.py`).

### Hösten 2027 (en hel säsong): längre analyser
- [ ] Odds- och streckrörelser under veckan. Ögonblicksbilderna sparas sedan oktober 2026.
- [ ] Ompröva risknivån λ med ett år mer av riktiga utdelningar, särskilt för 64–128 rader.

## Beslutsregler

- **När en modell får ta över:** minst 300 matcher där både modellen och Oddsen har prognos. Modellen ska
  vara bättre än Oddsen med mer än två standardfel ("Bättre än Oddsen" på statistiksidan, `export.parvis`).
  Backtestet får inte bli sämre för 64–128 rader.
- **När en idé testas:** backtesta på hela historiken, uppdelat i före och efter 2024. Idén införs bara om
  förbättringen syns i båda perioderna och i riktig utdelning, inte bara i träffprocent.
- **Drift:** varje körning ska alltid hinna spara sin data. AI får ta högst 15 minuter, och oddshämtningen
  pausas under 30 krediter. Inga källor som spärrar insamling i robots.txt.

## Testat och inte infört

Detaljerna finns i README.

| Idé | Resultat |
|---|---|
| Optimera mot förväntad utdelning | Modellen lovade för mycket, och det verkliga utfallet blev sämre. |
| Skrällchans med kvot över 1,5 | Gick in 20 % mot 26 % enligt oddsen. Folket visste ofta något, därav taket 1,5. |
| Experternas tvivel vid val av skrällar | Något högre träff, men samma eller något sämre utdelning (576 rader: 116 % mot 120 %). |
| Egen risknivå för 64–128 rader | Resultaten vände mellan perioderna, alltså brus. λ 0,45 och högre var klart sämre. |
| Favoritfällan och jämna matcher | Oddsen var rätt kalibrerade i alla grupper. |

## Större idéer att besluta om

### Inloggning och Mina spel
Man loggar in och sparar de spel man lämnat in, alltså förslag, antal rader och egna ändringar. Sidan
Mina spel visar rättning, utfall över tid och jämförelser med förslaget. Man ska också kunna bjuda in andra.
- Kräver en extern tjänst, eftersom appen ligger på GitHub Pages utan egen server. Förslaget är Firebase
  med Google-inloggning och Firestore, som är gratis i vår skala.
- Att besluta först: vilka data som sparas (e-postadress, spel), säkerhetsregler, hur inbjudningar fungerar
  och att Firebase-projektet skapas och nycklarna läggs in av ägaren.
- Uppskattning: några kvällar.

### Spelbolag
En fortsättning på Mina spel. Man skapar en grupp och väljer per spel om man spelade själv eller med
spelbolaget. Spelbolaget får gemensam statistik och bokföring av inbetalt per spelare, med manuella
justeringar för vinster utanför appen. Appen bokför bara och hanterar aldrig riktiga pengar. Ska byggas
med samma datamodell som Mina spel.

### Nyheter om lagen
- **Steg A:** en sida "Lagnyheter" som samlar det Lagkoll redan hittar, alltså skador, avstängningar och
  tränarbyten per match. Ingen extra AI behövs. Görs när Lagkoll har fungerat några helger.
- **Steg B:** RSS-flöden, till exempel BBC per liga, med AI-sammanfattning. Väntar tills Geminis
  gratiskvot har visat sig räcka.

## Idéer i reserven

| Idé | Varför den väntar |
|---|---|
| Val mellan fler och större vinster | λ 0,15 träffar oftare, λ 0,3 ger större vinster. Fast risknivå är valt. |
| Formmodell (Elo) för svenska serier | Oddsen täcker det mesta. Blir intressant om lägre serier blir vanligare. |
| Nivåer av tipsviktning | Uppskjutet. Med experter behöver mer data först. |
| xG och skador från Fantasy Premier League | Ingen fri källa som tillåter insamling. |
