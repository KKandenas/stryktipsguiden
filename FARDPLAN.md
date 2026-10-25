# Färdplan för Stryktipsguiden

*Skriven i oktober 2026.*

Grunden är byggd. Nästa halvår handlar mest om att samla avgjorda omgångar, följa driften och fatta beslut om
Lagkoll och Skrällchans när det finns tillräckligt med underlag. Inga nya modeller byggs innan det finns data
som talar för dem.

## Ny layout (14 oktober 2026)

- Flikrad längst ner (Kupong · Nyheter · Mina spel · Statistik · Mer). Headern har bara ordmärket och
  kontobilden.
- Kupongen: kompakta förslag (Odds · Experter · Lagkoll · Skräll), antal rader i en svepbar rad och en fast
  list längst ner med kostnad, fördelning, Lämna in och Spara. Matchraderna har etiketter i stället för en
  avklippt textrad.
- Matchdetaljen har flikarna Översikt, Lagen, Experter och Odds, och visar chans mot streck som staplar.
- Statistik har undersidorna Träffsäkerhet, Varje vecka och Förra omgången. Slutsatserna kommer först, och
  fackmåtten ligger under "Visa detaljer". Datum skrivs på svenska.

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

### Matcher utanför kupongen (från 19 oktober 2026)
- Sports Moles och FootballPredictions tips på alla matcher i ligorna samlas in, med odds och resultat från
  football-data.co.uk. De används bara när tipsarnas vikter lärs, inte i prognoserna.
- [ ] Efter 4–6 veckor: jämför träffsäkerheten på och utanför kupongen (Statistik → Visa detaljer → tipsarnas
  vikt). Skiljer de sig mycket bör matcherna utanför kupongen vägas ner eller tas bort.

### Vad experterna skriver om skrällar (från 25 oktober 2026)
- [x] Steg 1: Tipsmedoss arkiv hämtat, 3 912 matcher från 303 omgångar (december 2020–oktober 2026).
- [ ] Steg 2: AI-märkning med fast temalista, nattetid inom gratiskvoten (cirka två veckor).
- [ ] Steg 3: analysen. Frågorna är bestämda i förväg: förlorar favoriten oftare än oddsen säger när ett tema
  nämns, och överstreckar folket favoriten mer då? Testas före 2024 och kontrolleras 2024–2026. Bara mönster
  som håller i båda perioderna och ger bättre utdelning blir förslag till Skrällchans.
- [ ] I samband med steg 3: jämför ordlistorna med AI-märkningen. Stämmer de bra kan ordlistorna märka nya
  kommentarer varje vecka utan AI-anrop.

### December–januari (efter 8–12 omgångar): första avstämningen
- [ ] Lagkoll mot Oddsen på cirka 100–150 matcher. Det ger en fingervisning, inte ett beslut.
- [ ] Skrällchans i verkligheten: gick skrällarna in ungefär som i backtestet, cirka 29 %?
- [ ] Med experter: har vikterna för de nya tipssajterna flyttat sig från startvikten?

### Mars–april 2027 (ungefär en halv säsong): beslut om Lagkoll
- [ ] Med cirka 300 jämförbara matcher: behåll Lagkoll som eget förslag, väg in den i Oddsen eller ta bort den.
- [ ] Testa Lagkollens skrällrisk (låg/medel/hög) som filter när Skrällchans väljer skrällar.
- [ ] Vilka nyheter är värda något? Med `lagfakta_historik`, `lagkoll_historik` (från 25 oktober 2026, med
  uppdelning per faktor) och oddsens historik: vilka typer av faktorer går emot oddsen, om sena nyheter är
  mer värda än tidiga, och vilka av Lagkolls justeringar som hjälper. Kan förklara om Lagkoll ligger under Oddsen.
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

### Inloggning och Mina spel (i drift sedan 13 oktober 2026)
- Inloggning med Google eller e-postlänk. Knappen "Jag lämnade in de här raderna" sparar raderna som visas,
  med förslaget utan egna ändringar som jämförelse. Mina spel visar insats, tillbaka och netto, rättning per
  spel, vad egna ändringar gav, ändring av rader före avgörandet, delning via e-postadress och radering av
  kontot.
- [x] Skapa Firebase-projektet och fyll i `docs/firebase-config.js` enligt [FIREBASE.md](FIREBASE.md).
- [x] Prova inloggningen på riktigt: inloggning, spara och Mina spel fungerar.

### Spelbolag (byggt 13 oktober 2026)
- Två spelformer: kassa, där en kassör spelar för allas pengar, och turordning, där en medlem spelar per
  vecka. Inbjudan sker via en länk med kod som går att byta. Allt delas lika. En kassabok för inbetalningar,
  utbetalningar och spel eller vinster utanför appen. Saldo per medlem. Kupongen visar vems tur det är, och
  man väljer om man spelade själv eller för bolaget.
- [x] Publicera nya `firestore.rules` i Firebase.
- [ ] Prova på riktigt med en vän: skapa bolag, bjud in, spara för bolaget och lägg in en inbetalning.
- Utbyggt 17 oktober 2026: medlemmar utan konto (läggs in av skaparen och kan kopplas till ett konto senare),
  "Spelades av" på varje spel, topplista sorterad på vinst och efterregistrering av missade veckor (rader för
  en tidigare omgång, eller belopp i kassaboken med vem som spelade).
- [x] Publicera de nya `firestore.rules` (17 oktober 2026).

### Nyheter om lagen
- **Steg A:** sidan "Lagnyheter" samlar det Lagkoll redan hittar, alltså skador, avstängningar,
  sammanhang och tränarbyten per match, med källa. Ingen extra AI behövs. Klar 13 oktober 2026.
- **Steg B:** RSS-flöden, till exempel BBC per liga, med AI-sammanfattning. Väntar tills Geminis
  gratiskvot har visat sig räcka.

## Idéer i reserven

| Idé | Varför den väntar |
|---|---|
| Val mellan fler och större vinster | λ 0,15 träffar oftare, λ 0,3 ger större vinster. Fast risknivå är valt. |
| Formmodell (Elo) för svenska serier | Oddsen täcker det mesta. Blir intressant om lägre serier blir vanligare. |
| Nivåer av tipsviktning | Uppskjutet. Med experter behöver mer data först. |
| xG och skador från Fantasy Premier League | Ingen fri källa som tillåter insamling. |
