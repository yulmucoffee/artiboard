# Sign in with an email link
No passwords: a person types their email, gets a link and taps it on their phone.

## Flow
1. `LoginScreen` calls `requestLink()` in `app/auth/magicLink.ts`, which posts the address to the API.
2. `sendLink()` in `api/routes/auth.ts` stores a one-time token with `saveLoginToken()` and emails a link that opens
   the app. It answers the same for every address.
3. The app calls `finishSignIn()`; `verifyLink()` trades the token for a session with `useLoginToken()`.

## Rules
- A link works once, for 15 minutes. A session lasts a year or until `signOut()`.
- Every other request sends the session as a bearer token, read by `sessionFor()` in `api/db/users.ts`.
