# Stryktipsguiden – instruktioner för Claude

Statisk app (`docs/`, GitHub Pages: https://kkandenas.github.io/stryktipsguiden/) och en Python-pipeline
(`pipeline/`) som körs i GitHub Actions och ger radförslag för Stryktipset. Detaljer finns i README.md,
FARDPLAN.md (planer och kontrollpunkter), DATAKALLOR.md och FIREBASE.md.

## Arbetssätt

- Skriv på svenska, i chatten och i commit-meddelanden.
- Mobilen kommer först. Kontrollera layouten i mobilbredd (375 px) och på dator, och på liggande iPad
  (1024–1180 px) när kupongen ändras.
- Bygg stegvis och stanna efter varje steg. Vid större byggen: beskriv upplägget först och låt användaren
  välja innan du bygger.
- Backtesta innan en idé införs, och redovisa resultatet ärligt även när det inte hjälper. Beslutsreglerna
  står i FARDPLAN.md: hela historiken, före och efter 2024, och riktig utdelning, inte bara träffprocent.
- Testat och inte infört (gör inte om utan ny anledning): optimering mot förväntad utdelning, Skrällchans
  med kvot över 1,5, experternas tvivel vid skrällval, egen risknivå för 64–128 rader och favoritfällan.
  Se FARDPLAN.md.

## Fasta beslut

- Risknivån är fast, λ = 0,3, utan reglage. Användaren spelar normalt 64–128 rader.
- Budgetar: 1, 16, 32, 48, 64, 96, 128, 144, 192, 256, 384, 576 (måste vara 2^a·3^b).
- Fyra förslag: Oddsen (odds-v2, bas), Med experter (tips-v1), Lagkoll (lagkoll-v1, skuggmodell) och
  Skrällchans (1 skräll upp till 64 rader, 2 däröver).
- Lagkoll väger inte in experternas tecken, bara lagfakta. Det är medvetet, så att idéerna kan mätas var för sig.
- Matcher utanför kupongen (`pipeline/sidomatcher.py`) används bara när tipsarnas vikter lärs, aldrig i
  prognoserna.

## Drift och kostnader

- **AI: bara Geminis gratisnivå.** Användaren har tagit bort betalningen och vill inte betala. Kvoten räknas
  per modell och dag, så undvik onödiga manuella körningar med AI (`tips`, `kommentarer`, `lagkoll`, `auto`).
- Kommandon utan AI och oddskrediter: `tabeller` (export), `resultat` (resultat, statistik och export) och
  `sidomatcher`. Starta med `gh workflow run pipeline.yml -f kommando=<namn>`.
- Oddskrediter (The Odds API) är begränsade. Driftstatusen på Om-sidan visar läget.
- Schemat: `pipeline/schema.py`. GitHub-cron är opålitlig (hoppar över många starter), så pipelinen startas
  med `planerad` både av GitHubs cron och var 15:e minut av cron-job.org (README, "Extern start"). Nyckeln där
  sköter användaren själv. Startar inga körningar alls: kontrollera först om nyckeln har gått ut.

## Säkerhet och källor

- Be aldrig om nycklar i chatten. Användaren lägger själv in GitHub Secrets (GEMINI_API_KEY, ODDS_API_KEY).
- Användaren publicerar själv `firestore.rules` i Firebase-konsolen. Säg till varje gång reglerna ändras.
- Respektera robots.txt och AI-spärrar. Svenska Spels egna experttips laddas via `/api/`, som är spärrat i
  robots.txt, och används därför inte.
- Appen får inte efterlikna Svenska Spel. Inga betalningar eller betaluppgifter.

## Utveckling

- Python: `python3 -m venv .venv`, sedan `.venv/bin/pip install -r requirements-dev.txt`. Tester körs med
  `.venv/bin/python -m pytest -q`.
- JS-tester: `node --test tests/js/*.test.mjs`. Det finns ett röktest av app.js och en kontroll av
  odefinierade namn. Saknas Node lokalt går modultesterna att köra med JavaScriptCore (`jsc -m`) och enkla shims.
- Förhandsvisning: `.claude/launch.json` ("app", port 8765). Demoläge för konto och spelbolag: `?demo-konto`.
- Cache-busting: varje ändring i `docs/*.js` eller `app.css` kräver ny `?v=`-version, och samma version
  överallt (ett test kontrollerar det).
- Pipelinen committar data till main flera gånger om dagen. Kör `git pull --rebase` före push.
- Git-identiteten använder GitHubs noreply-adress.
