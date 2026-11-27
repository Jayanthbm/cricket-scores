# 04 - Gaps, open questions, capture plan

Status: v2 is implemented and running against live upstream data for the
states we could observe (Preview/Upcoming, Toss, Live, lunch/tea session break,
Stumps, rain delay, Complete incl. draws and DLS wins, Abandoned). The remaining
work is mostly _validation across the rare states_ and _deciding what to add
next_.

---

## 1. What is implemented

| Area           | v2                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match identity | self-contained by id (home feed no longer required to open a match)                                                                                                                     |
| Match info     | series, venue, format, day/night, start/end time, day number, short status                                                                                                              |
| State          | normalised enum (10 states) + raw string + boolean flags                                                                                                                                |
| Toss           | winner + decision (BAT/BOWL) + display text                                                                                                                                             |
| Result         | type (WIN/DRAW/TIE/NO_RESULT/ABANDONED), text, winner, margin with unit                                                                                                                 |
| Awards         | player of the match / series with face images, batting/bowling summaries when available                                                                                                 |
| Teams          | id/name/short/icon, per-innings scores, current batting flag, combined score text                                                                                                       |
| Innings        | per-innings score objects incl. declared/follow-on                                                                                                                                      |
| Live           | current score, RR, target/required RR/balls left, partnership, last wicket, striker/non-striker, bowlers, recent balls, recent performance, events, DRS, win probability, Test day/lead |
| Scorecard      | batting rows with dismissal classification, bowling rows, extras, powerplays, fall of wickets, partnerships, did-not-bat                                                                |
| Commentary     | recent ball-by-ball + over summaries + info entries, parsed outcome/runs/wicket/boundary/extra                                                                                          |
| Images         | team icon proxy (existing) + player face proxy (new)                                                                                                                                    |
| Ops            | timeouts, 204 handling, error codes, cache-control per endpoint, CORS                                                                                                                   |

## 2. Known gaps

These are upstream limitations or deliberate v2 scope choices. Each has a
workaround today.

| #   | Gap                                                                 | Impact                                                                                                                  | Current workaround                                                             | Possible fix                                                                        |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 1   | No squads / playing XI endpoint                                     | cannot show XI or bench                                                                                                 | didNotBat[] from scorecard; commentary "Squads:" INFO line                     | scrape the match page HTML (fragile), or ship without XI                            |
| 2   | Commentary capped at ~20-25 entries, no pagination                  | cannot show full innings commentary                                                                                     | show "recent commentary"                                                       | scrape website commentary pages (fragile)                                           |
| 3   | POM published late after the win                                    | empty playerOfMatch right after result                                                                                  | refetch hub after ~60 s                                                        | poll comm matchHeader for a few minutes                                             |
| 4   | winProbability only on some matches and vanishes at completion      | no win graph for many matches                                                                                           | hide the widget when null                                                      | none                                                                                |
| 5   | FOW omits retired-out dismissals                                    | fall of wickets list can be one short                                                                                   | lastWicket.isLatest tells you                                                  | none                                                                                |
| 6   | Home feed is featured-only (~6 matches)                             | list is not a full scoreboard                                                                                           | use it as "top matches"                                                        | add a schedule/scoreboard endpoint (needs another upstream source)                  |
| 7   | Home state lags livescore by up to ~51 s                            | card may say In Progress after the result                                                                               | detail/live endpoints use livescore                                            | none needed                                                                         |
| 8   | No player profiles, career stats, series standings                  | cannot build player/series pages                                                                                        | -                                                                              | separate upstream source                                                            |
| 9   | No weather/forecast/venue stats                                     | -                                                                                                                       | -                                                                              | separate upstream source                                                            |
| 10  | DRS block only exists for UDRS-enabled matches                      | drs is null for many leagues                                                                                            | hide widget when null                                                          | none                                                                                |
| 11  | Team icon cache is per-isolate and only filled by /home             | icon may be null on /live or /commentary first call                                                                     | call /v2/matches once, or fall back to initials                                | persist imageId mapping in KV/D1                                                    |
| 12  | 204 is overloaded (no content vs invalid id)                        | cannot distinguish "not started" from "bad id" without another call                                                     | we probe multiple endpoints and answer 404 only when all are empty             | none                                                                                |
| 13  | THE_HUNDRED / T10 / super over payloads not validated               | ball limits and innings semantics are educated guesses                                                                  | format enum + limits defined                                                   | capture them (section 3)                                                            |
| 14  | Innings Break / in-play Delayed / Tie / No Result not captured live | normalisation is code-only for those                                                                                    | keyword fallback                                                               | capture them (section 3)                                                            |
| 15  | status/shortStatus are English only                                 | no i18n                                                                                                                 | -                                                                              | translate client-side                                                               |
| 16  | DLS lives in the status text only                                   | revisedOvers is 0 even for a finished rain-shortened innings, so a live DLS chase can fall back to the 50/20-over limit | read result.text / status; treat ballsRemaining as approximate for a DLS chase | needs a live rain-shortened chase to see whether revisedOvers appears while batting |
| 16  | No "current innings" flag for upcoming/finished matches             | FE must infer from live or inningsSummary                                                                               | inningsSummary is ordered, last = current/most recent                          | add match.currentInningsId                                                          |

## 3. The 3-4 week capture exercise

The point: stop guessing about rare states, and decide the final shape from
real payloads. The harness in scripts/capture.mjs does the watching.

### 3.1 Run it

```bash
# in the repo, in a terminal that can stay open (or use nohup/screen/tmux)
npm run capture                      # forever, 120 s between polls
npm run capture -- --minutes 240     # 4 hours
npm run capture -- --matches 178523,166697   # explicit watchlist (works even
                                             # if the match is not in /home)

# background
nohup npm run capture > .analysis/capture.log 2>&1 &
```

Output (gitignored):

```
captures/
  2026-11-27/
    178523.in-progress.i2.2026-11-27T14-32-10-123Z.livescore.json
    178523.in-progress.i2.2026-11-27T14-32-10-123Z.scorecard.json
    178523.in-progress.i2.2026-11-27T14-32-10-123Z.comm.json
    home.2026-11-27T14-00-00-000Z.home.json
  states.jsonl        one line per stored state transition
```

One snapshot triple is written **per state transition** (state + inningsId +
status text), plus a home snapshot every 30 minutes. That is enough to diff
what changes between Preview -> Toss -> Live -> Innings Break -> ... without
storing gigabytes.

Run it for days rather than hours: the states we need appear at specific times
(Tests reach Stumps at the end of a day's play, rain delays are unpredictable,
super overs are rare).

### 3.2 What to hunt, and when

| Target                              | Where/when to look                                 | What to set up                                                 |
| ----------------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| INNINGS BREAK                       | any limited-overs match around the 1st innings end | watchlist a T20/ODI on match day                               |
| DELAYED (rain)                      | rainy venues / monsoon season                      | watch a match with rain forecast, or let the harness run       |
| ABANDONED / NO RESULT               | washouts                                           | same                                                           |
| TIE                                 | close chases                                       | hard to predict; harness catches it if running                 |
| SUPER OVER                          | tied T20/ODI                                       | same                                                           |
| DLS / revised overs                 | rain-affected matches                              | check scoreDetails.revisedOvers and live.target.ballsRemaining |
| TEST 4th innings / follow-on        | day 4-5 of a Test                                  | watchlist the Test, capture at Stumps                          |
| THE_HUNDRED / T10                   | competitions using them                            | watchlist one match                                            |
| 2nd innings target at Innings Break | limited overs                                      | check whether target is already set before the chase starts    |

### 3.3 What to send

When you spot one of these on the site, send the match id plus what it is.
The harness then records it with `npm run capture -- --matches <id>` (works
even when the match is not in /api/home), and it becomes a fixture + test:

- an innings break (the score is between innings)
- rain stopping play (Delay / Interrupted), or a DLS-revised chase mid-innings
- an abandoned match or a no-result
- a tied match, and a super over
- a Test with a follow-on innings
- any T10 or The Hundred match (live if possible, plus the scorecard)
- an ODI that is live (we only captured a completed one)

### 3.4 Questions the captures must answer

Tick these off as evidence arrives; each one either confirms the current
behaviour or becomes a code change.

1. Does the raw state ever read "Innings Break", and does inningsId flip at the
   same moment?
2. At Innings Break, is miniscore.target already the new target, or 0?
3. Does comm switch to the new innings immediately, or lag?
4. Do livescore batsmen/bowlers become empty/null during a break or delay?
5. For a rain delay mid-innings, do overs/score freeze, and does the status
   keep the previous state or switch to "Delay"?
6. For an abandoned match, is matchHeader.complete true or false, and what is
   result.resultType?
7. For a tie, what are result.resultType, winningTeam, winningMargin?
8. For a no-result, is resultType "NO_RESULT" and is there a margin?
9. For a super over, what are the extra inningsId values, does inningsSummary
   include them, and does target reset?
10. For a DLS match, is revisedOvers always populated, and does
    live.target.ballsRemaining match the scoreboard's "in N balls"?
11. For THE_HUNDRED, what are the ball limits (100?) and how are overs written
    (e.g. "100" or "16.4")?
12. For a follow-on innings, is followOn true on the right innings, and does
    the Test live.test.leadRuns/trailRuns sign flip correctly?
13. Does winProbability ever appear for Tests or ODIs, or only some leagues?
14. How late does playersOfTheMatch appear after completion (minutes)?
15. Does the commentary ever exceed ~25 entries, or change innings mid-list?

### 3.5 Turning a capture into a test fixture

When a capture answers a question:

1. Trim the JSON to the smallest payload that still has the relevant block
   (drop videos, unrelated innings, unused header fields).
2. Add it under test/fixtures/ (name: 178523.in-progress.livescore.json).
3. Add a case to test/v2.spec.js asserting the v2 output for that state.
4. If the behaviour differs from what doc 02/03 says, update the doc in the
   same commit.

## 4. Versioning / change policy

- The envelope carries v: 2. Breaking changes (renames, removals, type changes)
  bump it to 3 and live under /v3; v2 stays.
- Additive changes (new fields, new enum values that clients can ignore) are
  allowed inside v2. New state enum values are additive; unknown states are
  already represented by UNKNOWN, so a client that switches on the current 9
  values never crashes.
- Keep null semantics stable: a field is null only when unknown.
- Docs in this folder are part of the contract - update them with the code.

## 5. Suggested next steps (ordered)

1. Run the capture harness through the next 3-4 weeks; collect the rare states.
2. Validate/adjust: Innings Break target + inningsId flip, DLS ballsRemaining,
   super over innings, abandoned/no-result result types.
3. Add match.currentInningsId (cheap, removes FE guessing).
4. Decide on squads/playing XI: ship without, or add a scraper service.
5. Add a tiny in-memory (or KV) cache for the home feed (51 s upstream TTL) to
   cut upstream calls when many clients poll the list.
6. Persist the team imageId map (KV/D1) so icons work on cold isolates for
   /live and /commentary.
7. Optional: a /v2/matches/:id/innings/:inningsId endpoint if the FE prefers
   lazy-loading one innings at a time instead of the whole scorecard.
8. Optional: ETag/If-None-Match support so polls can 304.

## 6. Open questions for the product side

1. Is "recent commentary" (last ~20-25 balls) enough, or is full innings
   commentary a hard requirement? (The latter needs HTML scraping.)
2. Do you need a full scoreboard/schedule (all matches), or is the featured
   list enough? (The latter is all the JSON API offers.)
3. Polling budget: how many concurrent clients, and what interval is
   acceptable? This decides whether we need a shared cache in front of
   Cricbuzz.
4. Do you want squads/XI even if it means scraping?
5. Should v2 expose a "combined" match endpoint per format (e.g. always
   returning scorecard innings for Tests) or keep the current split?
6. Any i18n requirement for status/state labels?

## 7. v1 -> v2 quick mapping (for existing clients)

| v1                                    | v2                                                   |
| ------------------------------------- | ---------------------------------------------------- |
| data.matches[i].matchId               | data.matches[i].id                                   |
| data.matches[i].team1/team2           | data.matches[i].teams[] (ordered like the home feed) |
| team1.icon                            | teams[].icon                                         |
| data.matches[i].score.team1/team2     | teams[].innings[] + teams[].score/overs              |
| displayScore                          | teams[].score + state/status (render yourself)       |
| statusType                            | state + flags (isLive/isUpcoming/isComplete)         |
| state / stateTitle                    | state enum / stateLabel, rawState preserved          |
| venueText                             | venue.short                                          |
| startDate / startDateText             | startTime / startTimeText                            |
| matchDesc / matchFormat / matchType   | same names                                           |
| /matches/:id data.live/toss/scorecard | /v2/matches/:id .live/.toss, /scorecard .innings[]   |
