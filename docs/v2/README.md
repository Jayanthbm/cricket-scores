# v2 Cricket API (integration-first)

A small, opinionated JSON API on top of the public Cricbuzz JSON endpoints
(https://www.cricbuzz.com/api/...). It exists so a front-end can render a
cricket match with **one shape**, without caring which upstream endpoint a
field came from, which format the match is, or whether the match has started.

**v1 is untouched.** /matches, /matches/:id and /team-icon/... behave exactly
as before. Everything below is additive and lives under /v2.

| Doc                     | Read it for                                                                   |
| ----------------------- | ----------------------------------------------------------------------------- |
| 01-upstream-analysis.md | what Cricbuzz actually returns, every quirk we found, and what does not exist |
| 02-states-matrix.md     | every match state + format, what is populated in each, real examples          |
| 03-api-contract.md      | **the contract**: every endpoint, every field, examples, FE recipes           |
| 04-gaps-and-roadmap.md  | known gaps, open questions, and the multi-week capture plan                   |

---

## Why a v2 at all

The v1 wrapper proxies three upstream endpoints and stitches them with the
home feed. That works for a card list, but it has real limits:

- GET /matches/:id only works if the match is still in /api/home. A match that
  scrolled out of the featured feed returns "Match <id> not found".
- The response shape mirrors raw Cricbuzz fields (team1Score, displayScore,
  ...), so the FE has to know upstream field names and quirks.
- Missing entirely: toss, result, player of the match, partnership, last
  wicket, target/required rate, DRS, win probability, day/lead for Tests,
  per-innings scorecard rows, fall of wickets, commentary, player images.
- Several upstream fields are traps (overs 49.6 means 50 overs, timestamps are
  sometimes seconds, lastWicket is empty for finished games, ...).

v2 normalises all of that once, server-side, and returns one match object that
is safe to render in every state.

## Quick start

```bash
npm install
npm run dev                     # http://127.0.0.1:8787
curl -s localhost:8787/v2 | jq
curl -s "localhost:8787/v2/matches?state=live" | jq
curl -s localhost:8787/v2/matches/178523/live | jq
```

Deploy is the same as v1 (npm run deploy); v2 is part of the same Worker.

## Endpoints

| Endpoint                           | Returns                       | Upstream calls                                                  | Cache-Control      |
| ---------------------------------- | ----------------------------- | --------------------------------------------------------------- | ------------------ |
| GET /v2                            | list of endpoints (discovery) | none                                                            | max-age=300        |
| GET /v2/matches                    | match list cards              | /home; +livescore for live matches; +scorecard when enrich=full | max-age=20, swr=40 |
| GET /v2/matches/:id                | match hub (match incl. live)  | /home + livescore + scorecard (+ comm when finished)            | max-age=10, swr=20 |
| GET /v2/matches/:id/live           | poll-friendly live snapshot   | livescore + scorecard                                           | max-age=5, swr=10  |
| GET /v2/matches/:id/scorecard      | match + full innings[]        | /home + scorecard                                               | max-age=20, swr=40 |
| GET /v2/matches/:id/commentary     | match + recent ball-by-ball   | comm + livescore (+ scorecard fallback)                         | max-age=5, swr=10  |
| GET /v2/player-icon/:imageId/:name | player headshot proxy         | Cricbuzz CDN                                                    | max-age=86400      |

GET /v2/matches query parameters:

| Param    | Values                                                            | Default | Notes                                                                                                                                 |
| -------- | ----------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| format   | T20, ODI, TEST, T10, THE_HUNDRED, SIXES, OTHER                    | all     | normalised, case-insensitive; T10/Sixes are also detected from the series name                                                        |
| state    | live, upcoming, completed, delayed, or any enum (LIVE, TOSS, ...) | all     | comma-separated list allowed                                                                                                          |
| seriesId | number                                                            | all     |                                                                                                                                       |
| enrich   | none, live, full                                                  | live    | none = home feed only; live = + livescore for in-progress matches; full = + scorecard for every match (adds toss, result, POM, icons) |

The upstream home feed only carries a handful of featured matches (~6 in our
captures), so the list is **not** a complete scoreboard. Use it as "top
matches", not "all matches".

## Response envelope

Success:

```json
{
	"success": true,
	"v": 2,
	"meta": {
		"generatedAt": "2026-11-26T18:31:37.380Z",
		"source": "cricbuzz",
		"matchId": 178523,
		"lastUpdated": "2026-11-26T18:31:22.000Z",
		"count": 1,
		"total": 6,
		"filters": { "state": "live", "format": null, "seriesId": null, "enrich": "live" }
	},
	"data": {}
}
```

Error:

```json
{
	"success": false,
	"v": 2,
	"meta": { "generatedAt": "2026-11-26T18:29:08.689Z" },
	"error": { "code": "MATCH_NOT_FOUND", "message": "Match 999999999 was not found" }
}
```

| Code               | HTTP | When                                                                                 | Suggested FE behaviour               |
| ------------------ | ---- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| MATCH_NOT_FOUND    | 404  | match id does not exist, or upstream has no content for it on any endpoint we probed | show "match not found", stop polling |
| NOT_FOUND          | 404  | unknown route                                                                        | programmer error                     |
| METHOD_NOT_ALLOWED | 405  | anything but GET                                                                     | programmer error                     |
| UPSTREAM_ERROR     | 502  | Cricbuzz returned non-2xx                                                            | retry with backoff                   |
| UPSTREAM_TIMEOUT   | 504  | Cricbuzz took more than 6 s                                                          | retry with backoff                   |
| INTERNAL_ERROR     | 500  | bug in the worker                                                                    | report                               |

meta.lastUpdated is the upstream responseLastUpdated for the endpoint that
drove the response, normalised to ISO. It is null when upstream does not
provide it. meta.generatedAt is always present.

CORS is *, so the API is safe to call straight from a browser.

## Conventions

- **Ids are numbers** (12, 178523). Player/team ids are Cricbuzz ids.
- **Timestamps are ISO 8601 UTC strings** ("2026-11-26T18:31:22.000Z"),
  except helper fields such as startTimeText which are human-readable IST.
- **Overs are scorer-style strings**: "9", "41.3", "97.1". The dot is _not_ a
  decimal point: 41.3 = 41 overs 3 balls. Each score object also carries
  balls (integer count of balls bowled) and a display like "318/2 (41.3)", so
  prefer those to string maths.
- x.6 is normalised: 49.6 (50 overs) becomes "50", 13.6 becomes "14". Never
  expect a trailing .6 in an overs string.
- **null means unknown**, not zero. Example: live.target is null once a match
  finishes; live.bowlers.striker.wides is null because livescore does not
  carry wides (the scorecard does).
- Every score object has the same shape:
  { runs, wickets, overs: "41.3", balls: 249, runRate: 7.66, declared,
  followOn, display: "318/2 (41.3)", displayShort: "318/2" }.
  For a Test innings that is 287/10, display is "287/10 (97.1)".
- state is the normalised enum; rawState is the untouched upstream string
  (useful for debugging, do not branch on it in the FE). stateLabel is a
  display string.
- Booleans are consolidated on match: isLive, isUpcoming, isComplete,
  isDelayed, isSuperOver, hasScorecard.

## Caching / polling recommendation

| Endpoint                   | Poll every                     | Why                                                    |
| -------------------------- | ------------------------------ | ------------------------------------------------------ |
| /v2/matches                | 20-30 s                        | home feed itself is cached ~51 s upstream              |
| /v2/matches/:id/live       | 5-10 s while isLive            | livescore updates continuously                         |
| /v2/matches/:id/commentary | 5-10 s while isLive            | commentary is capped at ~20-25 recent entries upstream |
| /v2/matches/:id (hub)      | only on open / state change    | heavier (3-4 upstream calls)                           |
| /v2/matches/:id/scorecard  | only on open or innings change | static between innings                                 |
| /v2/player-icon/...        | browser cache                  | proxied CDN image, 1 day                               |

Respect the returned Cache-Control; the values above assume you are polling
without an intervening CDN.

## Local development

```bash
npm run dev                          # wrangler dev on :8787
npm test                             # vitest watch mode
npx vitest run                       # one-shot run (CI)
npm run capture -- --minutes 30      # upstream capture harness, see 04-gaps-and-roadmap.md
```

vitest.config.mts wires Vitest into the Workers runtime with the current
cloudflareTest plugin; the previous vitest.config.js imported a helper that the
installed @cloudflare/vitest-pool-workers version no longer ships. Tests cover
the pure normalisation helpers plus the v1/v2 routers with a stubbed upstream.

Useful smoke checks:

```bash
curl -s localhost:8787/matches                       # v1 still works
curl -s localhost:8787/v2/matches | jq '.data.matches[0]'
curl -s localhost:8787/v2/matches/175283 | jq '.data.match | {state, teams}'
curl -s localhost:8787/v2/matches/178523/live | jq '.data.match.live'
```

## Layout

```
src/
  index.js              v1 router + one additive handleV2(request) hook
  routes/               v1 handlers (unchanged)
  services/             v1 services (unchanged)
  v2/
    index.js            /v2 router
    routes.js           endpoint handlers
    client.js           upstream fetch + timeout + 204 handling
    constants.js        state/format enums + normalisation
    utils.js            overs/timestamp/score helpers
    teams.js            team cards + icon cache (from /home)
    match.js            the canonical match object
    live.js             the live block
    scorecard.js        innings/batting/bowling/FOW/partnerships
    commentary.js       ball-by-ball parsing
    response.js         envelope + cache headers + error mapping
scripts/capture.mjs     long-running upstream capture harness
docs/v2/                this documentation
```
