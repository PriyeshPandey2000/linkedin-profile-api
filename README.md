# LinkedIn Profile API

Reverse-engineered LinkedIn profile scraper. Given a profile URL, returns
name, headline, location, about, experience, education, certifications,
skills, languages, and profile photo as structured JSON.

No browser at request-time. Every profile fetch is a handful of plain
HTTP requests against LinkedIn's internal SDUI endpoints, replaying a
request shape captured once via a one-time recon pass. See **Approach**
below.

## Approach

LinkedIn's profile page is a React Server Components (RSC) application.
The data doesn't come from a documented public API — it comes from
internal endpoints (`flagship-web/rsc-action/actions/component`,
`.../details/<section>/`, `.../actions/pagination`) that return a React
Flight-protocol stream: newline-delimited chunks, some referencing others
by index (`"$L7"` = "the real value is in chunk 7").

The pipeline:

1. **Authenticate once.** A LinkedIn session cookie (`li_at` +
   `JSESSIONID`) is obtained by logging in — either by hand (copy the
   cookie out of a real browser) or by scripting LinkedIn's native
   email/password form. Google OAuth login cannot be automated (Google
   detects and blocks automated browsers at the login step); the native
   form has no such block.
2. **Capture the request shape once.** A short-lived browser session
   (development-time only, not part of this repo) watches the network
   while a real profile page loads, and records the exact headers/body
   LinkedIn's own frontend sends for each type of call: fetching a
   profile section, fetching a full section via its "Show all" details
   page, and paginating a long list (skills, certifications, education)
   via `start`/`count` cursor parameters. The result is `lib/templates.json`
   (included, committed, secrets redacted — see Setup).
3. **Replay that shape via plain HTTP, forever.** The captured
   request is a reusable template — swap the target profile's slug in the
   URL/body, and the exact same headers/cookies work for any profile,
   indefinitely, with zero browser involvement. This is what
   `lib/fetch-profile.js` does at runtime.
4. **Parse the Flight-protocol response.** `lib/flight-resolver.js`
   parses the chunk stream and resolves every cross-reference into a
   normal nested object. `lib/flight-extract.js` strips structural noise
   (hashed CSS classnames, tracking IDs, CDN URLs, self-view UI chrome)
   down to real text. `lib/parsers.js` groups that text into typed
   objects per entry (one job, one degree, one certification), using
   LinkedIn's own `"hr"` divider line as the per-entry boundary.

### On "no browser"

No browser dependency anywhere in this repo — `package.json` has no
Playwright/Puppeteer/Selenium entry, and nothing under `lib/` or `src/`
launches one. A browser was used during development to obtain the
initial session cookie and observe the request shapes now baked into
`lib/templates.json`, but that was a one-time, external setup step, not
part of what's shipped or what runs per-request. This is an explicit
reading of the requirement: the *scraping mechanism* uses no browser;
how the session cookie was originally obtained is outside the running
service. Stated here as an assumption, not confirmed with the client.

## Project layout

```
server.js         local entry point (npm start -- calls app.listen())
api/index.js      Vercel serverless entry point (exports the app, no .listen())
vercel.json       routes every path to api/index.js, sets function maxDuration
src/              Express app: routes, middleware, config, logging
lib/               the scraping engine (no Express/HTTP-server code)
  fetch-profile.js   orchestrator: profile URL in, structured JSON out
  flight-resolver.js  Flight-protocol chunk resolver
  flight-extract.js   noise filtering + section discovery
  parsers.js           raw text -> typed objects per entry
  templates.json      captured request templates -- committed, but with
                       the session cookie/csrf-token fields REDACTED (see
                       Setup). The request shape isn't secret; the cookie
                       value is supplied separately at runtime.
```

## Setup

Requires Node.js 18+ and a LinkedIn account.

```
npm install
```

`lib/templates.json` (the captured request shapes) is already included
in this repo, with the session cookie/csrf-token fields redacted. The
only thing needed to run this yourself is a live session cookie:

### 1. Get a session cookie

Log into LinkedIn in a normal browser (your own account — see README's
**Known limitations** for the ToS/risk considerations of this). Open
DevTools → Network tab → click any request to `linkedin.com` → under
Request Headers, copy the full `Cookie` value (one long string, not just
`li_at`).

### 2. Set it as an environment variable

```
export LINKEDIN_COOKIE="<the full Cookie header value from step 1>"
```

Locally: put it in `.env` (gitignored). On Vercel: set it as a project
environment variable. `csrf-token` is derived automatically from the
`JSESSIONID` inside this cookie string — only one secret to manage.

The server checks for this at startup and refuses to start with a clear
error if it's missing while `lib/templates.json` is in its redacted
(committed) state.

### 3. Run

```
npm start
```

Listens on `PORT` (default `3000`).

### Deploying to Vercel

```
vercel
```

Set `LINKEDIN_COOKIE` in the project's environment variables first
(Vercel dashboard → Settings → Environment Variables). `vercel.json`
routes every request through `api/index.js` (the serverless entry point
— same Express app as `server.js`, minus the `.listen()` call Vercel
doesn't want) and sets a 120s function timeout. Verified against Vercel's
own docs (with Fluid Compute, default since 2025): Hobby allows up to
300s, Pro up to 800s — 120s leaves comfortable headroom over the ~30-40s
a heavy profile (full Skills/Certifications/Education pagination) takes
in practice, well within even the free tier's limit.

## API

### `POST /profile`

```
curl -X POST http://localhost:3000/profile \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.linkedin.com/in/some-person/"}'
```

Response:

```json
{
  "success": true,
  "data": {
    "name": "...",
    "headline": "...",
    "location": "...",
    "profileImage": "https://media.licdn.com/...",
    "about": "...",
    "experience": [
      {
        "title": "...",
        "company": "...",
        "employmentType": "Full-time",
        "dates": "Jan 2024 - Present · 8 mos",
        "location": "...",
        "description": ["..."],
        "skills": "Skill A, Skill B and +3 skills"
      }
    ],
    "education": [
      { "school": "...", "degree": "...", "field": "...", "dates": "...", "grade": null }
    ],
    "certifications": [
      { "name": "...", "issuer": "...", "issuedDate": "...", "credentialId": "..." }
    ],
    "skills": [ { "name": "...", "context": ["..."] } ],
    "languages": [ { "name": "English", "proficiency": "Native or bilingual proficiency" } ],
    "projects": ["..."]
  },
  "meta": { "scrapedAt": "2026-08-29T...", "sourceUrl": "..." }
}
```

Errors follow one shape:

```json
{ "success": false, "error": { "code": "INVALID_URL", "message": "..." }, "requestId": "..." }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `MISSING_URL` / `INVALID_URL` | request body missing or not a LinkedIn profile URL |
| 404 | `PROFILE_NOT_FOUND` | best-effort signal, not exhaustively tested against every not-found variant |
| 503 | `SESSION_EXPIRED` | session cookie is dead — redo Setup step 1 |
| 504 | `TIMEOUT` | scrape exceeded `REQUEST_TIMEOUT_MS` (default 180000) |
| 500 | `INTERNAL` | unexpected error, detail in server logs only |

### `GET /health`

Liveness check. Does not touch LinkedIn.

## Known limitations

- **Experience entries with multiple roles at the same company** (a
  promotion history) are not split into individual role objects — an
  earlier attempt at this produced confidently-wrong results (mistook an
  employment-type label for a separate job), so the entry is kept whole
  instead, flagged `"multipleRoles": true`, with all real text preserved
  in `description` rather than guessed at.
- **Self-view** (scraping the account's own profile while logged in as
  that account) hits LinkedIn's edit-mode UI, which structures some
  fields less cleanly than the public view does. Not the primary use
  case — this service is for looking up other people's profiles.
- **A timed-out request does not cancel the in-flight scrape.**
  `REQUEST_TIMEOUT_MS` stops the HTTP response from hanging, but the
  underlying LinkedIn calls keep running in the background — no
  `AbortController` wired through `lib/`'s `fetch()` calls yet.
- **Session cookies expire.** No automatic renewal; re-run Setup step 1
  when a request starts returning `SESSION_EXPIRED`.
- **PROFILE_NOT_FOUND detection is best-effort**, based on the absence of
  extractable name/title content — not verified against every way
  LinkedIn can render a missing/private profile.
- **Request template shapes in `lib/templates.json` can go stale** if
  LinkedIn changes its frontend build — this shows up as requests failing
  outright (not `SESSION_EXPIRED`; usually a non-200 status or an
  unparseable response). Regenerating them requires re-observing
  LinkedIn's network requests (browser DevTools, or an automated capture
  — see Approach); that tooling isn't included in this repo.
- No rate limiting or API-key auth on this service's own endpoint by
  default (`src/middleware/apiKey.js` is wired but off — set `API_KEY`
  to enable). Deliberate: expected usage is low-volume manual testing.
