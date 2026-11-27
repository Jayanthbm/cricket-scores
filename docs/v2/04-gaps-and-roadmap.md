# 04 - Gaps, open questions, capture plan

Status: v2 is implemented and running against live upstream data for the
states we could observe (Preview/Upcoming, Toss, Live, lunch/tea session break,
Stumps, rain delay, Complete incl. draws and DLS wins, Abandoned, No Result).
The remaining work is mostly _validation across the rare states_ and _deciding
what to add next_.

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

| #   | Gap                                                                     | Impact                                                                                                                                                                                   | Current workaround                                                             | Possible fix                                                                       |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1   | No squads / playing XI endpoint                                         | cannot show XI or bench                                                                                                                                                                  | didNotBat[] from scorecard; commentary "Squads:" INFO line                     | scrape the match page HTML (fragile), or ship without XI                           |
| 2   | Commentary capped at ~20-25 entries, latest innings only, no pagination | cannot show earlier innings or full commentary                                                                                                                                           | show "recent commentary"                                                       | scrape website commentary pages (fragile)                                          |
| 3   | POM published late after the win (151352: 8m17s after the last ball; poll or refetch once complete) | empty playerOfMatch right after result                                                                                                                                                   | refetch hub after ~60 s                                                        | poll comm matchHeader for a few minutes                                            |
| 4   | winProbability only on some matches and vanishes at completion          | no win graph for many matches                                                                                                                                                            | hide the widget when null                                                      | none                                                                               |
| 5   | FOW omits retired-out dismissals                                        | fall of wickets list can be one short                                                                                                                                                    | lastWicket.isLatest tells you                                                  | none                                                                               |
| 6   | Home feed is featured-only (~6 matches)                                 | list is not a full scoreboard                                                                                                                                                            | use it as "top matches"                                                        | add a schedule/scoreboard endpoint (needs another upstream source)                 |
| 7   | Home state lags livescore by up to ~51 s                                | card may say In Progress after the result                                                                                                                                                | detail/live endpoints use livescore                                            | none needed                                                                        |
| 8   | No player profiles, career stats, series standings                      | cannot build player/series pages                                                                                                                                                         | -                                                                              | separate upstream source                                                           |
| 9   | No weather/forecast/venue stats                                         | -                                                                                                                                                                                        | -                                                                              | separate upstream source                                                           |
| 10  | DRS block only exists for UDRS-enabled matches                          | drs is null for many leagues                                                                                                                                                             | hide widget when null                                                          | none                                                                               |
| 11  | Team icon cache is per-isolate and only filled by /home                 | icon may be null on /live or /commentary first call                                                                                                                                      | call /v2/matches once, or fall back to initials                                | persist imageId mapping in KV/D1                                                   |
| 12  | 204 is overloaded (no content vs invalid id)                            | cannot distinguish "not started" from "bad id" without another call                                                                                                                      | we probe multiple endpoints and answer 404 only when all are empty             | none                                                                               |
| 13  | T10 / Hundred / Sixes only captured finished                            | live ball limits and powerplay behaviour unverified; upstream mislabels T10 and Sixes as "T20"                                                                                           | series-name format hints + ballNbr-based ball counts                           | capture one live match of each (section 3)                                         |
| 14  | In-play Delayed / Tie not captured live                                 | normalisation is code-only for those                                                                                                                                                     | keyword fallback                                                               | capture them (section 3)                                                           |
| 15  | status/shortStatus are English only                                     | no i18n                                                                                                                                                                                  | -                                                                              | translate client-side                                                              |
| 16  | DLS is only partly structured                                           | revisedOvers is populated while a reduced innings is being played (13 in 178440) but reads 0 once the match finishes (161245/161256), so a finished DLS game still needs the status text | read result.text / status as a fallback; trust score.revisedOvers when present | find a DLS **chase** (2nd innings against a revised target) to confirm live.target |
| 17  | No "current innings" flag for upcoming/finished matches                 | FE must infer from live or inningsSummary                                                                                                                                                | inningsSummary is ordered, last = current/most recent                          | add match.currentInningsId                                                         |

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

| Target                              | Where/when to look                                 | What to set up                                                                                              |
| ----------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| INNINGS BREAK                       | any limited-overs match around the 1st innings end | watchlist a T20/ODI on match day                                                                            |
| DELAYED (rain)                      | rainy venues / monsoon season                      | watch a match with rain forecast, or let the harness run                                                    |
| ABANDONED / NO RESULT               | washouts                                           | same                                                                                                        |
| TIE                                 | close chases                                       | hard to predict; harness catches it if running                                                              |
| SUPER OVER                          | tied T20/ODI                                       | same                                                                                                        |
| DLS / revised overs                 | rain-affected matches                              | ~~captured (151352)~~: revisedOvers 17 + "DLS Target 98" status arrive before target.runs 98.ballsRemaining |
| TEST 4th innings                    | day 4-5 of a Test (166697 covers the chase at tea) | watchlist the Test, capture at Stumps                                                                       |
| THE_HUNDRED / T10                   | competitions using them                            | watchlist one match                                                                                         |
| 2nd innings target at Innings Break | limited overs                                      | check whether target is already set before the chase starts                                                 |

### 3.3 What to send

When you spot one of these on the site, send the match id plus what it is.
The harness then records it with `npm run capture -- --matches <id>` (works
even when the match is not in /api/home), and it becomes a fixture + test:

- ~~rain stopping play mid-innings, or a DLS-revised chase~~ (151352 captured
  both on 27 Nov: two breaks, and a chase cut to 17 overs with DLS target 98)
- an abandoned match or a no-result
- a tied match, and a super over
- any live T10 / The Hundred / Sixes match (finished ones are covered by
  176250, 144673 and 175110)

### 3.4 Questions the captures must answer

Tick these off as evidence arrives; each one either confirms the current
behaviour or becomes a code change.

1. ~~Does the raw state ever read "Innings Break", and does inningsId flip?~~
   Answered by 166697: the raw state is exactly "Innings Break", and inningsId
   does **not** flip - it stays on the innings that just ended until the new one
   starts.
2. ~~At Innings Break, is miniscore.target already the new target?~~ No: target
   is null/0 through the break (166697 leads by 147, the 148 chase target is
   arithmetic only), so live.target stays null.
3. ~~Does comm switch to the new innings immediately, or lag?~~ It lags: every
   entry still carries the ended inningsId for the whole break.
4. ~~Do livescore batsmen/bowlers become empty/null during a break or delay?~~
   Not at an innings break: the closing pair, the last partnership and the last
   wicket stay populated; only isBatting is forced to false.
5. For a rain delay mid-innings, do overs/score freeze, and does the status
   keep the previous state or switch to "Delay"?
6. For an abandoned match, is matchHeader.complete true or false, and what is
   result.resultType?
7. For a tie, what are result.resultType, winningTeam, winningMargin?
8. For a no-result, is resultType "NO_RESULT" and is there a margin?
9. For a super over, what are the extra inningsId values, does inningsSummary
   include them, and does target reset?
10. ~~Is revisedOvers always populated?~~ Only while a reduced innings is live
    (13 in 178440, matching the 13-over status); it is 0 once the match is
    finished (161245/161256). ballsRemaining now uses it as the limit.
11. For a live T10/Hundred/Sixes innings, does livescore expose the same ball
    count as scoreDetails.ballNbr (the Hundred is only verified finished)?
12. ~~Is followOn true on the right innings?~~ Yes: 147931 has Australia's
    second innings as match innings 3 with followOn true, and lead/trail still
    came from the status text on the live days.
13. ~~Does winProbability appear outside a few leagues?~~ It is on the
    scorecard (with odds) for some T20s, ODIs and Tests - 151352 had it at the
    toss (AUS 46 / ENG 54, odds 2.1 / 1.8), 175843 has none. Tests are
    three-way: 161296 at stumps is NZ 48 / IND 43 / draw 9 with odds draw 10.6.
14. How late does playersOfTheMatch appear after completion (minutes)?
15. ~~Does the commentary ever exceed ~25 entries, or change innings mid-list?~~
    No to both: 161285 (finished Test) returned 24 entries, all innings 3, and
    166697 returned 23, all innings 4. The window is latest-innings only.

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
