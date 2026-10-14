# Sätta upp inloggning och Mina spel (Firebase)

Inloggningen och de sparade spelen ligger i Firebase, Googles tjänst för inloggning och databas. Gratisnivån
(Spark) räcker gott för det här. Appen ligger kvar på GitHub Pages, och Firebase laddas först när någon loggar
in. Det tar ungefär 10 minuter.

## 1. Skapa projektet

1. Gå till <https://console.firebase.google.com> och logga in med ditt Google-konto.
2. Välj **Skapa ett projekt** och döp det till `stryktipsguiden`.
3. Google Analytics behövs inte, så det kan vara avstängt.

## 2. Slå på inloggningen

1. Välj **Build → Authentication → Kom igång** i menyn.
2. Under fliken **Sign-in method**:
   - **Google:** aktivera och välj din e-postadress som supportadress. Spara.
   - **E-post/lösenord:** aktivera, och slå även på **E-postlänk (inloggning utan lösenord)**. Spara.
     Appen erbjuder bara länken, inte lösenord.
3. Under **Settings → Authorized domains**: lägg till `kkandenas.github.io`.
4. Valfritt: under **Templates**, välj svenska som språk för e-postmeddelandet med inloggningslänken.

## 3. Skapa databasen

1. Välj **Build → Firestore Database → Skapa databas**.
2. **Database ID:** skriv `(default)`, med parenteserna. Godtar konsolen inte det, skriv `stryktipsguiden` och
   lägg till `databaseId: "stryktipsguiden"` i konfigurationen i steg 4.
3. Edition: **Standard**. Plats: `eur3 (europe-west)`, så att datan ligger i EU. Den går inte att ändra senare.
4. Starta i **produktionsläge**. Reglerna går inte att ändra medan databasen skapas.
5. När databasen är skapad: gå till fliken **Regler**, ersätt allt med innehållet i
   [`firestore.rules`](firestore.rules) och tryck **Publicera**.

## 4. Koppla appen till projektet

1. Klicka på kugghjulet, välj **Projektinställningar** och gå till **Dina appar**. Välj webbikonen `</>`.
2. Döp appen till `Stryktipsguiden`. Firebase Hosting behövs inte. Tryck **Registrera app**.
3. Du får ett kodblock med `const firebaseConfig = { apiKey: …, authDomain: …, projectId: … }`.
4. Klistra in objektet i [`docs/firebase-config.js`](docs/firebase-config.js) i stället för `null`:

   ```js
   export const FIREBASE_CONFIG = {
     apiKey: "…",
     authDomain: "stryktipsguiden.firebaseapp.com",
     projectId: "stryktipsguiden",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "…",
     // databaseId: "stryktipsguiden",   // bara om databasen fick ett eget namn i steg 3
   };
   ```

   Värdena är inte hemliga. De identifierar bara projektet och syns ändå för alla som öppnar appen. Skyddet
   ligger i inloggningen och reglerna, så det går också bra att skicka dem till Claude i chatten.
5. Committa och pusha. När GitHub Pages har uppdaterats syns knappen **Jag lämnade in de här raderna** på
   kupongen, och **Mina spel** finns i menyn.

## När reglerna ändras

`firestore.rules` uppdateras när appen får nya funktioner, till exempel spelbolag. Gå då till
**Firestore Database → Regler**, ersätt allt med den nya filen och tryck **Publicera**. Det behövs inga andra
ändringar i Firebase.

## Vad som sparas

| Var | Innehåll |
|---|---|
| Firebase Authentication | Namn och e-postadress från inloggningen |
| `anvandare/{uid}` | Namn, e-post, listan med e-postadresser du delar med och din profilbild om du lagt till en (en liten JPEG på några kB) |
| `spel/{uid}_{omgång}` | Raderna du lämnade in, förslaget utan dina ändringar, antal rader och insats |
| `grupper/{id}` | Spelbolaget: namn, spelform, medlemmar (namn och profilbild), kassör, turordning och inbjudningskod |
| `grupper/{id}/spel/{omgång}` | Bolagets spel, med vem som lämnade in och vilka medlemmar som delar på det |
| `grupper/{id}/kassabok/{id}` | Inbetalningar, utbetalningar och spel eller vinster utanför appen |
| `inbjudningar/{kod}` | Bolagets id och namn, som inbjudningslänken pekar på |

Resultat och utdelning sparas inte. De räknas fram i appen från `historik.json`. Under Mina spel finns knappen
**Radera mitt konto**, som tar bort spelen, profilen och själva kontot.

## Prova utan Firebase

Lägg till `?demo-konto` i adressen, till exempel `http://localhost:8765/?demo-konto#minaspel`. Då används en
låtsasdatabas i minnet, så att alla sidor går att prova. Inget sparas.
