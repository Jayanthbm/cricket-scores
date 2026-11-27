# 02 - Match states & formats matrix

The goal: one enum the FE can switch on, whatever the format and whatever the
scorer's raw wording is.

---

## 1. The enum

| state         | stateLabel    | Meaning                                           | Flags on match                                         |
| ------------- | ------------- | ------------------------------------------------- | ------------------------------------------------------ |
| SCHEDULED     | Upcoming      | not started, no toss                              | isUpcoming true                                        |
| TOSS          | Toss          | toss done, no ball bowled                         | isUpcoming true                                        |
| LIVE          | Live          | play in progress                                  | isLive true                                            |
| SESSION_BREAK | Break         | lunch / tea / drinks interval, play resumes today | isLive true, rawState keeps "Tea" / "Lunch" / "Drinks" |
| INNINGS_BREAK | Innings Break | between innings                                   | isLive true                                            |
| STUMPS        | Stumps        | end of a day's play (Tests)                       | isLive true                                            |
| DELAYED       | Delayed       | rain / bad light / interruption                   | isLive true, isDelayed true                            |
| COMPLETE      | Completed     | result known                                      | isComplete true                                        |
| ABANDONED     | Abandoned     | called off                                        | isComplete true                                        |
| UNKNOWN       | Unknown       | raw state we could not classify                   | none                                                   |

Derived booleans (all always present):

- isLive = state in {LIVE, SESSION_BREAK, INNINGS_BREAK, STUMPS, DELAYED}
- isUpcoming = state in {SCHEDULED, TOSS}
- isComplete = state in {COMPLETE, ABANDONED}
- isDelayed = state = DELAYED
- isSuperOver = status text contains "super over" (separate from state)

Poll on isLive; stop polling when isComplete; show the scorecard tab when
hasScorecard is true.

## 2. Raw upstream strings -> enum

State is taken from **livescore first**, then the scorecard header, then the
home feed (that order matters because home lags).

Exact matches (case-insensitive, trimmed):

| Raw                                                       | Enum          |
| --------------------------------------------------------- | ------------- |
| Preview, Upcoming, Scheduled                              | SCHEDULED     |
| Toss                                                      | TOSS          |
| In Progress, InProgress, Live                             | LIVE          |
| Tea, Tea Break, Lunch, Lunch Break, Drinks, Session Break | SESSION_BREAK |
| Innings Break, InningsBreak                               | INNINGS_BREAK |
| Stumps                                                    | STUMPS        |
| Delay, Delayed, Rain Delay, Rain, Interrupted             | DELAYED       |
| Abandoned, Cancelled, Canceled                            | ABANDONED     |
| Complete, Completed                                       | COMPLETE      |

If there is no exact match, the raw state + status text are tested in this
order (first hit wins):

1. abandon | called off | cancelled -> ABANDONED
2. rain | delay | interrupt | wet outfield | bad light | drizzle -> DELAYED
3. stumps | end of day | close of play -> STUMPS
4. innings break | end of innings | "break, ... need" -> INNINGS_BREAK
5. tea | lunch | drinks | session break -> SESSION_BREAK
6. toss -> TOSS
7. in progress | live | "need N runs in N balls" -> LIVE
8. complete | won by | drawn | no result -> COMPLETE
9. preview | upcoming | match starts | start delayed | yet to start -> SCHEDULED
10. otherwise -> UNKNOWN

The untouched upstream string is always preserved as rawState. If you find a
raw state in the wild that lands on UNKNOWN, add it to this table and to
src/v2/constants.js - that is the whole change.

"Start delayed" intentionally maps to SCHEDULED (it is a pre-toss delay, the
FE shows the start time), while "Delay"/"Interrupted" during play maps to
DELAYED - including a toss delayed by rain, and the same delay once the toss is
done but before the first ball (178440).

"Tea" / "Lunch" / "Drinks" map to SESSION_BREAK: the match is still on today
(isLive true, keep polling) but nothing is happening. They are checked after
"Innings Break" so an innings interval never lands on SESSION_BREAK, and before
"toss" because upstream sometimes keeps the toss text in status all day.

## 3. Formats

| upstream matchFormat               | v2 format   | Innings balls | Powerplay (as seen)                                   |
| ---------------------------------- | ----------- | ------------- | ----------------------------------------------------- |
| T20, T20I                          | T20         | 120           | Mandatory 0.1-6 (a rain-reduced innings can be 0.1-4) |
| ODI, ODM                           | ODI         | 300           | Mandatory 0.1-10                                      |
| TEST                               | TEST        | none (no cap) | none (ppData {})                                      |
| T10                                | T10         | 60            | usually none                                          |
| THE_HUNDRED, HUNDRED, HUN, THE_100 | THE_HUNDRED | 100           | none                                                  |
| SIXES, HONG_KONG_SIXES             | SIXES       | 36            | none                                                  |
| anything else                      | OTHER       | none          | -                                                     |

Two upstream quirks sit behind this table (144673, 176250, 175110):

- **matchFormat is not reliable.** The Abu Dhabi T10 is labelled "T20" and the
  Hong Kong Sixes is labelled "T20" too. detectFormat() therefore looks for
  \bt10\b or \bsixes\b in seriesName/matchDesc and overrides T20/OTHER with the
  real format. TEST/ODI/Hundred are never overridden, so formatLabel can still
  say "T20" while format says "T10" - that is upstream's label, kept verbatim.
- **The Hundred counts in sets of 10 balls.** scoreDetails.overs is "9.8" (9
  sets + 8 balls) next to ballNbr 98, so score.overs keeps that label and
  score.balls is the raw ball count. Livescore sends overs as a plain ball
  count (98) instead - buildLive passes it as balls, so a Hundred chase still
  gets ballsRemaining = 100 - 98 = 2.

Only FORMAT_INNINGS_BALLS entries have a fixed limit; that limit is used to
derive live.target.ballsRemaining, and it is overridden by
scoreDetails.revisedOvers whenever that is > 0 (DLS / reduced overs). That value
is now also exposed as score.revisedOvers (null when not revised): 178440 sent 13
while an innings reduced to 13 overs was still being played, while the finished
DLS games 161245/161256 still send 0.
scoreDetails.ballNbr is the authoritative ball count everywhere (it survives
the Hundred's 10-ball sets and any odd decimal overs value).

Test-specific behaviour:

- score.overs is "97.1", "135.3", ... with no cap; runRate still applies.
- declared / followOn flags are on every score object (from isDeclared /
  isFollowOn), so "494/7d" is data, not string parsing. 147931 is the verified
  follow-on: Australia were bowled out for 99, batted again at 295/10 (inningsId
  3, `followOn: true`) and lost by an innings and 31.
- live.test = { day, inningsNumber, teamInningsNumber, leadRuns, trailRuns, target }:
  - day = "Day N" from the status text, else header.dayNumber
  - inningsNumber = which innings of the match is being played (1-4, equals
    live.inningsId), so a side batting its 2nd innings in the 3rd innings of
    the match gives inningsNumber 3
  - teamInningsNumber = how many innings this batting side has had (1, 2, ...)
  - leadRuns / trailRuns parsed from the status text ("lead by 6 runs"), null
    while the status says something else ("Day 1: 3rd Session")
  - target = chase target if this innings is a chase, else null
- The scorecard has 2-4 innings in scoreCard[]; the FE should render the
  innings tabs from inningsSummary (always present, ordered).

Super overs: upstream exposes them as extra innings (inningsId 3+ in a T20)
and status text like "Super Over". isSuperOver flags the match; the innings is
a normal innings object. (Not yet captured live - see doc 04.)

### 3.1 What is actually verified (Nov 2026 capture set)

Legend: **yes** = real payload captured and asserted; **toss** = toss data
verified but the TOSS _state_ was only captured on a Test; **-** = not
applicable to the format; **no** = implemented, waiting for a payload.

| format      | SCHEDULED | TOSS | LIVE    | SESSION_BREAK | INNINGS_BREAK | STUMPS  | DELAYED | COMPLETE | ABANDONED | evidence                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | --------- | ---- | ------- | ------------- | ------------- | ------- | ------- | -------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T20         | yes (3)   | toss | yes     | no            | no            | -       | yes (1) | yes (4)  | yes (2)   | 151352 Preview + 151374/175283 Upcoming, 178440 delayed before and after the toss then live in a 13-over rain-reduced innings (women's T20I final), 175273 live chase, 162941 rain-reduced powerplay, 150931 eliminator, 165321 SMAT, 161476 + 162088 abandoned without a toss, 161487 no result (state COMPLETE, result NO_RESULT)                                                                                        |
| ODI         | toss      | toss | no      | no            | no            | -       | no      | yes (3)  | yes (1)   | 177210 chase won by 8 wkts, 161245 DLS-reduced chase won by 5 wkts, 161256 won by 4 runs (DLS), 161260 abandoned after the toss with no innings                                                                                                                                                                                                                                                                            |
| TEST        | yes (2)   | yes  | yes (4) | yes (1)       | yes (2)       | yes (4) | no      | yes (6)  | no        | 161296 preview, 171807 toss then stumps (1 innings), 171830 + 171817 stumps while trailing (2 innings), 171331 tea break, 166697 live day 4, innings break (lead 147) then a 4th-innings chase at tea (target 148, need 131), 171340 live day 1 then innings break after the 1st innings, 147964 innings win + declaration, 147931 follow-on + innings and 31, 161285 + 166687 draws, 166643 draw with a 4th-innings chase |
| T10         | no        | no   | no      | no            | no            | -       | no      | yes (1)  | no        | 176250 Abu Dhabi T10, labelled "T20" upstream, 60-ball limit                                                                                                                                                                                                                                                                                                                                                               |
| THE_HUNDRED | no        | no   | no      | no            | no            | -       | no      | yes (1)  | no        | 144673 (format "HUN"), 100-ball limit, overs "9.8" = 9 sets + 8 balls                                                                                                                                                                                                                                                                                                                                                      |
| SIXES       | no        | no   | no      | no            | no            | -       | no      | yes (1)  | no        | 175110 Hong Kong Sixes, labelled "T20" upstream, 36-ball (6 over) innings                                                                                                                                                                                                                                                                                                                                                  |
| OTHER       | no        | no   | no      | no            | no            | -       | no      | no       | no        | falls through to no ball limit                                                                                                                                                                                                                                                                                                                                                                                             |

Format specific things that are verified by those captures:

- **T20**: chase target / required rate / balls remaining, partnership, last
  wicket from both sources, striker + non-striker, bowler figures, recent ball
  tokens, DRS (150931, 162941, 175273), win probability (175273), powerplay
  Mandatory 0.1-6 and a rain-reduced 0.1-4 plus a 15.1-17 "Batting" powerplay
  (162941), extras and fall of wickets. Both pre-match raw strings are covered:
  "Preview" (151352) and "Upcoming" (151374, 175283, no commentary at all).
  Abandonment comes in two flavours: **with** a toss (161260, ODI) and
  **without** one, where upstream still sends `{ tossWinnerId: 0, tossWinnerName:
"", decision: "" }` (161476, 162088) - v2 nulls that toss. A rain washout
  mid-innings is **not** ABANDONED: 161487 keeps state COMPLETE and result
  NO_RESULT with a partial innings (15/1 in 2.3).
- **ODI**: 50-over / 300-ball limit, Mandatory powerplay 0.1-10, result margin
  in wickets (177210, 161245) and runs (161256), toss, player of the match,
  extras, partnerships. Both Indian tour ODIs were rain-shortened and decided by
  DLS: 161245's chase was reduced to 32 overs (won by 5 wkts, status carries the
  DLS target 143) and 161256 lost by 4 runs under DLS with the innings cut to 41
  and 26 overs. In both finished games scoreDetails.revisedOvers stayed 0, so
  the only DLS signal is the status/result text; the live rain-reduced T20I final
  (178440) did send revisedOvers 13 while batting, and v2 now exposes it. A
  revised **chase** (2nd innings) is still missing.
- **TEST**: day number, lead/trail (both directions: lead 106 in 166697, trail 158
  and 88 in 171830/171817), innings number, declaration (147964 innings 2,
  147931 innings 1) and follow-on (147931 innings 3), no ball limit, no
  powerplay, 2-4 innings in inningsSummary, no live target.
  Live coverage is three shapes: mid-session on day 1 with no lead yet (171340,
  228/6, leadRuns null), day 4 with a lead and three innings (166697,
  inningsNumber 3, teamInningsNumber 2), and stumps on 1 and 2 innings
  (171807, 171830, 171817). Two draws are covered: 161285 (India declared 720/9d
  on day 5, result DRAW with null winner fields) and 166643 (4th-innings chase
  abandoned at 75/3 chasing 201).
- **ABANDONED**: 161260 (3rd ODI, "Match abandoned due to rain (with toss)") is
  the first real case. rawState is the bare string "Abandon" (not
  "Abandoned"), so it lands on the keyword branch, result.resultType is
  "abandon" with an empty winningTeam, the scorecard payload exists but has an
  empty scoreCard[], and the commentary payload is a map of INFO entries
  (including video snippets, which v2 filters out).
- **SESSION_BREAK**: 171331 (Plunket Shield tea) is the live-verified case; the
  score, batsmen, bowlers and lastWicket are all still present, only play has
  stopped.
- **DELAYED**: 178440 (women's T20I final) was captured twice, before and after
  the toss. Pre-toss ("Toss delayed due to rain") has toss null; post-toss has
  the toss but still no innings, rawState "Delay" while the status reads
  "Indonesia Women opt to bowl". In both, isDelayed true, live null, no scores
  and comm only has pre-match INFO entries. An in-play rain delay is still
  missing.

### 3.2 What still needs a match id

Send the id when you see one of these; every item below is implemented but has
no real payload behind it yet.

| required                           | why it matters                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T20 at TOSS                        | the TOSS state was only captured on a four-day Test; toss fields are verified, the state transition is not                                                    |
| ODI live (any phase)               | the only ODI payload is a completed chase; mid-innings target/RRR/powerplay unverified                                                                        |
| a live T10 / Hundred / Sixes match | only finished payloads so far; limits are applied but never exercised live                                                                                    |
| in-play rain delay / interruption  | DELAYED is verified before and after the toss (178440) but never mid-innings; need to see whether the score freezes                                           |
| lunch or drinks break              | only Tea (171331) is captured; Lunch/Drinks share the mapping but not the payload                                                                             |
| a DLS-revised chase                | revisedOvers is 13 while a reduced T20I innings is live (178440) but 0 once finished (161245/161256); we still need a 2nd innings batting to a revised target |
| a tied match, and a super over     | TIE result, isSuperOver, extra innings ids                                                                                                                    |
| an ODI or T20 with winProbability  | only 175273 carried it so far                                                                                                                                 |

Doc 04 lists the questions each capture has to answer.

## 4. State x payload matrix

What upstream returns and therefore what v2 can populate.

| state               | livescore                                       | scorecard                        | comm                      | v2 match fields that are meaningfully filled                                                                                                                                        |
| ------------------- | ----------------------------------------------- | -------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCHEDULED (Preview) | yes (status "Match starts at ...", inningsId 0) | yes (header only; empty innings) | 204 or INFO-only (squads) | teams (no scores), series, venue, startTime, toss null, result null, playerOfMatch usually []                                                                                       |
| TOSS                | yes (status "X opt to bat", no score)           | yes (header, tossResults)        | INFO entries              | toss populated, teams no scores, live null                                                                                                                                          |
| LIVE                | yes                                             | yes                              | yes                       | everything: live.score/target/partnership/lastWicket/batsmen/bowlers/drs/winProbability, teams scores, isBatting. A Test 4th-innings chase sets live.target (166697: 148, need 131) |
| SESSION_BREAK       | yes (status "Day 1: Tea Break")                 | yes                              | yes                       | everything LIVE has, but play is paused; rawState keeps Tea/Lunch/Drinks, the score freezes while live.updatedAt keeps moving (166697 tea lasted ~28 min on day 4)                  |
| INNINGS_BREAK       | yes ("Day 4: Innings Break - lead by 147")      | yes                              | yes                       | live.score of the finished innings, target null, lastWicket + last partnership, inningsId still points at the innings that ended, isBatting false on both sides                     |
| STUMPS              | yes (status "Day 3: Stumps - ...")              | yes                              | yes                       | live.test.day, leadRuns/trailRuns, inningsSummary 2-4 innings                                                                                                                       |
| DELAYED             | yes (status "Rain delay" etc.)                  | yes                              | yes                       | live.score frozen, isDelayed true. A delay around the toss (178440) has no innings at all: live null, teams no scores, toss null before it and populated after                      |
| COMPLETE            | yes (status = result text)                      | yes                              | yes                       | result, playerOfMatch (may lag), inningsSummary final, live.target null, winProbability null. A rain washout is COMPLETE + result NO_RESULT (161487), not ABANDONED                 |
| ABANDONED           | yes (status "Match abandoned")                  | yes (header only, zero innings)  | INFO-only map or 204      | result.type ABANDONED, no scores, inningsSummary [], toss may be present (161260) or null (161476, 162088), hasScorecard is still true                                              |
| UNKNOWN             | whatever                                        | whatever                         | whatever                  | teams + rawState only                                                                                                                                                               |

Practical rules that fall out of the matrix:

- toss is only reliable when hasScorecard is true, or when state >= TOSS. On a
  list with enrich=none it can be null.
- playerOfMatch is empty for matches that just finished (upstream lag). Show
  "Awards" only when non-empty, or refetch the hub after a few minutes.
- commentary for a not-started match is either 204 (no payload) or INFO-only
  entries ("Squads:", "Venue", ...) with inningsId 0. For an abandoned match the
  same payload can contain video snippets (commType "snippet"); v2 drops every
  entry with no text instead of returning blank rows.
- hasScorecard means "the scorecard endpoint answered", not "there are innings".
  161260 has hasScorecard true with inningsSummary []; render the scorecard tab
  from inningsSummary.inningsId.
- winProbability is live-only and optional per match.

## 5. Real examples (captured Nov 2026)

### SCHEDULED - 161296 (Test, starts later)

```json
{
	"id": 161296,
	"format": "TEST",
	"state": "SCHEDULED",
	"stateLabel": "Upcoming",
	"rawState": "Preview",
	"status": "Match starts at Nov 26, 22:00 GMT",
	"isLive": false,
	"isUpcoming": true,
	"isComplete": false,
	"startTime": "2026-11-26T22:00:00.000Z",
	"startTimeText": "27 Nov 2026, 03:30 AM IST",
	"teams": [
		{ "id": 13, "name": "New Zealand", "shortName": "NZ", "score": null, "overs": null, "isBatting": false, "innings": [] },
		{ "id": 2, "name": "India", "shortName": "IND", "score": null, "overs": null, "isBatting": false, "innings": [] }
	],
	"toss": null,
	"result": null,
	"playerOfMatch": [],
	"inningsSummary": [],
	"live": null
}
```

### TOSS - 171807 (CSA four-day, captured at the toss; now stumps)

```json
{
	"id": 171807,
	"format": "TEST",
	"state": "TOSS",
	"stateLabel": "Toss",
	"rawState": "Toss",
	"status": "Knights opt to bat",
	"isLive": false,
	"toss": { "winnerTeamId": 281, "winnerTeamName": "Knights", "winnerTeamShortName": "KNG", "decision": "BAT", "decisionText": "Batting" },
	"teams": [
		{ "shortName": "BOL", "score": null, "isBatting": false },
		{ "shortName": "KNG", "score": null, "isBatting": false }
	],
	"live": null
}
```

### LIVE - 178523 (T20 chase in progress)

```json
{
	"id": 178523,
	"format": "T20",
	"state": "LIVE",
	"stateLabel": "Live",
	"rawState": "In Progress",
	"status": "Andaman Admirals need 51 runs in 66 balls",
	"isLive": true,
	"teams": [
		{ "shortName": "AMA", "score": "54/8", "overs": "9", "isBatting": true },
		{ "shortName": "UPK", "score": "104/7", "overs": "9", "isBatting": false }
	],
	"live": {
		"inningsId": 2,
		"score": { "runs": 54, "wickets": 8, "overs": "9", "balls": 54, "runRate": 6, "display": "54/8 (9)" },
		"target": { "runs": 105, "runsNeeded": 51, "ballsRemaining": 66, "requiredRunRate": 4.64, "requiredRunsPerBall": null },
		"partnership": { "runs": 1, "balls": 1, "display": "1 (1)" },
		"lastWicket": {
			"text": "S BalaKrishna   b Ratnesh Singh 15(14)  - 53/8 in 8.5 ov.",
			"batter": "S BalaKrishna",
			"dismissal": "b Ratnesh Singh",
			"runs": 15,
			"balls": 14,
			"score": "53/8",
			"overs": "8.5",
			"wicketNumber": 8,
			"isLatest": true,
			"source": "LIVESCORE"
		},
		"drs": null,
		"winProbability": null,
		"test": null
	}
}
```

### STUMPS - 166697 (Sheffield Shield, day 3)

```json
{
	"id": 166697,
	"format": "TEST",
	"state": "STUMPS",
	"stateLabel": "Stumps",
	"rawState": "Stumps",
	"status": "Day 3: Stumps - South Australia lead by 6 runs",
	"isLive": true,
	"live": {
		"test": { "day": 3, "inningsNumber": 3, "teamInningsNumber": 2, "leadRuns": 6, "trailRuns": null, "target": null }
	},
	"inningsSummary": [
		{ "inningsId": 1, "team": { "shortName": "SAUS" }, "score": { "display": "287/10 (97.1)" } },
		{ "inningsId": 2, "team": { "shortName": "VIC" }, "score": { "display": "417/10 (135.3)" } },
		{ "inningsId": 3, "team": { "shortName": "SAUS" }, "score": { "display": "136/2 (47)" } }
	]
}
```

### INNINGS_BREAK - 166697 (same Test, day 4)

```json
{
	"id": 166697,
	"format": "TEST",
	"state": "INNINGS_BREAK",
	"stateLabel": "Innings Break",
	"rawState": "Innings Break",
	"status": "Day 4: Innings Break - South Australia lead by 147 runs",
	"isLive": true,
	"live": {
		"inningsId": 3,
		"score": { "display": "277/10 (99)", "runs": 277, "wickets": 10, "balls": 594 },
		"target": null,
		"test": { "day": 4, "inningsNumber": 3, "teamInningsNumber": 2, "leadRuns": 147, "trailRuns": null, "target": null },
		"lastWicket": { "batter": "Lloyd Pope", "runs": 1, "balls": 31, "score": "277/10", "overs": "99", "wicketNumber": 10 }
	},
	"teams": [
		{ "shortName": "SAUS", "score": "287/10 & 277/10", "overs": "99", "isBatting": false },
		{ "shortName": "VIC", "score": "417/10", "overs": "135.3", "isBatting": false }
	],
	"inningsSummary": [
		{ "inningsId": 1, "team": { "shortName": "SAUS" }, "score": { "display": "287/10 (97.1)" } },
		{ "inningsId": 2, "team": { "shortName": "VIC" }, "score": { "display": "417/10 (135.3)" } },
		{ "inningsId": 3, "team": { "shortName": "SAUS" }, "score": { "display": "277/10 (99)" } }
	]
}
```

Note: the innings ends at 277/10 in 99 overs and the next one has not started, so
`inningsId` is still 3 and `target` is null even though the chase target (148) is
already arithmetically known. Upstream's `matchHeader.complete` is **true** here
(it marks "all scheduled innings have data"), so v2 derives `isComplete` from the
state instead and the match stays live. Both sides have `isBatting: false`
because nobody is batting during the break.

Later the same day the match moved into its 4th-innings chase, and the break
became a Tea break with the chase live: `live.target {runs: 148, runsNeeded: 131,
ballsRemaining: null}` while upstream still sent `remRunsToWin: 0`, `live.test`
`{day: 4, inningsNumber: 4, teamInningsNumber: 2, leadRuns: null, trailRuns: null}`
and `isBatting` true for the chasing side only. For Tests `leadRuns`/`trailRuns`
stay null in the 4th innings - read `live.target` instead.

The other flavour is 171340 (Plunket Shield): a break after the **first** innings
only, so the batting side has 1 innings, the other side has none
(`score: null`, `innings: []`) and `live.test` reads
`{ day: 1, inningsNumber: 1, teamInningsNumber: 1, leadRuns: null, trailRuns: null,
target: null }`. That header carries no `dayNumber` at all - "Day 1" comes from
the status text, which is why the parse exists.

### COMPLETE - 177210 (ODI, POM available)

```json
{
	"id": 177210,
	"format": "ODI",
	"state": "COMPLETE",
	"stateLabel": "Completed",
	"rawState": "Complete",
	"status": "Sri Lanka A won by 8 wkts",
	"isComplete": true,
	"toss": { "winnerTeamName": "India A", "decision": "BAT", "decisionText": "Batting" },
	"result": {
		"type": "WIN",
		"text": "Sri Lanka A won by 8 wkts",
		"winnerTeamId": 43,
		"winnerTeamName": "Sri Lanka A",
		"winnerTeamShortName": "SLA",
		"margin": { "value": 8, "unit": "WICKETS" }
	},
	"playerOfMatch": [
		{
			"id": 52736,
			"name": "Sineth Jayawardena",
			"teamId": 0,
			"teamName": "",
			"faceImageUrl": "https://.../v2/player-icon/182026/sineth-jayawardena",
			"batting": "105(70)",
			"bowling": ""
		}
	],
	"teams": [
		{ "shortName": "INDA", "score": "317/8", "overs": "50", "isBatting": false },
		{ "shortName": "SLA", "score": "318/2", "overs": "41.3", "isBatting": false }
	],
	"live": null
}
```

### SESSION_BREAK - 171331 (Plunket Shield, tea on day 1)

```json
{
	"id": 171331,
	"format": "TEST",
	"state": "SESSION_BREAK",
	"stateLabel": "Break",
	"rawState": "Tea",
	"status": "Day 1: Tea Break",
	"isLive": true,
	"teams": [
		{ "shortName": "ND", "score": null, "isBatting": false },
		{ "shortName": "CD", "score": "194/10", "overs": "61.4", "isBatting": false }
	],
	"live": {
		"inningsId": 1,
		"score": { "display": "194/10 (61.4)" },
		"test": { "day": 1, "inningsNumber": 1, "teamInningsNumber": 1, "leadRuns": null, "trailRuns": null, "target": null }
	}
}
```

### DELAYED - 178440 (women's T20I final, rain around the toss)

```json
{
	"id": 178440,
	"format": "T20",
	"state": "DELAYED",
	"stateLabel": "Delayed",
	"rawState": "Delay",
	"status": "Toss delayed due to rain",
	"isLive": true,
	"isDelayed": true,
	"isUpcoming": false,
	"isComplete": false,
	"teams": [
		{ "shortName": "IDNW", "score": null, "overs": null, "isBatting": false },
		{ "shortName": "MLYW", "score": null, "overs": null, "isBatting": false }
	],
	"toss": null,
	"result": null,
	"inningsSummary": [],
	"live": null
}
```

Later the same id moved to the **post-toss** flavour of the delay: the toss was
won by Indonesia Women, who chose to bowl, but no ball had been bowled yet.

```json
{
	"id": 178440,
	"state": "DELAYED",
	"rawState": "Delay",
	"status": "Indonesia Women opt to bowl",
	"isLive": true,
	"isDelayed": true,
	"toss": { "winnerTeamName": "Indonesia Women", "decision": "BOWL", "decisionText": "Bowling" },
	"teams": [
		{ "shortName": "IDNW", "score": null, "isBatting": false },
		{ "shortName": "MLYW", "score": null, "isBatting": false }
	],
	"inningsSummary": [],
	"live": null
}
```

So a delay is DELAYED from the first rain signal until the first ball, whether or
not the toss has happened: toss goes from null to populated, everything else
stays empty. The raw state ("Delay") wins over the status text ("opt to bowl"),
which is why this does not flip to TOSS.

### LIVE (rain reduced) - 178440 (13-over innings after the delay)

```json
{
	"id": 178440,
	"format": "T20",
	"state": "LIVE",
	"status": "13 overs game due to rain",
	"isLive": true,
	"live": {
		"inningsId": 1,
		"score": { "display": "16/3 (4)", "runs": 16, "wickets": 3, "balls": 24, "revisedOvers": 13 },
		"target": null,
		"partnership": { "runs": 9, "balls": 10, "display": "9 (10)" }
	},
	"teams": [
		{ "shortName": "IDNW", "score": null, "isBatting": false },
		{ "shortName": "MLYW", "score": "16/3", "isBatting": true }
	],
	"inningsSummary": [{ "inningsId": 1, "score": { "display": "16/3 (4)", "revisedOvers": 13 } }]
}
```

Note: the 13-over revision is available as `score.revisedOvers` while the innings
is being played, so an FE can render "16/3 (4 of 13)" and progress from
`balls / (revisedOvers * 6)`. A finished DLS match sends 0 there instead, which
v2 reports as null.

### COMPLETE (draw) - 166643 (Sheffield Shield, 4th innings abandoned as a draw)

```json
{
	"id": 166643,
	"format": "TEST",
	"state": "COMPLETE",
	"stateLabel": "Completed",
	"rawState": "Complete",
	"status": "Match drawn",
	"isComplete": true,
	"result": {
		"type": "DRAW",
		"text": "Match drawn",
		"winnerTeamId": null,
		"winnerTeamName": null,
		"winnerTeamShortName": null,
		"margin": null
	},
	"playerOfMatch": [{ "name": "Jack Clayton" }],
	"teams": [
		{ "shortName": "QL", "score": "280/10 & 75/3" },
		{ "shortName": "VIC", "score": "307/10 & 173/10" }
	],
	"live": null
}
```

### COMPLETE (innings win, declaration) - 147964 (Bangladesh tour of South Africa, 2nd Test)

```json
{
	"id": 147964,
	"format": "TEST",
	"state": "COMPLETE",
	"stateLabel": "Completed",
	"rawState": "Complete",
	"status": "South Africa won by an innings and 219 runs",
	"isComplete": true,
	"dayNumber": 3,
	"toss": { "winnerTeamName": "South Africa", "decision": "BOWL", "decisionText": "Bowling" },
	"result": {
		"type": "WIN",
		"text": "South Africa won by an innings and 219 runs",
		"winnerTeamId": 11,
		"winnerTeamName": "South Africa",
		"winnerTeamShortName": "RSA",
		"margin": { "value": 219, "unit": "INNINGS_AND_RUNS" }
	},
	"playerOfMatch": [{ "name": "Wiaan Mulder", "batting": "100", "bowling": "1-15 & 7-31" }],
	"playerOfSeries": [{ "name": "MJ Ackerman", "batting": "307 Runs" }],
	"teams": [
		{ "shortName": "BAN", "score": "91/10 & 184/10" },
		{
			"shortName": "RSA",
			"score": "494/7d",
			"innings": [{ "display": "494/7d (115)", "declared": true, "followOn": false }]
		}
	],
	"live": null
}
```

### COMPLETE (follow-on) - 147931 (Australia tour of South Africa, 2nd Test)

```json
{
	"id": 147931,
	"format": "TEST",
	"state": "COMPLETE",
	"status": "South Africa won by an innings and 31 runs",
	"toss": { "winnerTeamName": "Australia", "decision": "BOWL" },
	"result": { "type": "WIN", "winnerTeamShortName": "RSA", "margin": { "value": 31, "unit": "INNINGS_AND_RUNS" } },
	"playerOfMatch": [{ "name": "Temba Bavuma", "batting": "179", "bowling": "DNB & DNB" }],
	"teams": [
		{ "shortName": "RSA", "score": "425/9d", "innings": [{ "display": "425/9d (127.1)", "declared": true }] },
		{
			"shortName": "AUS",
			"score": "99/10 & 295/10",
			"innings": [{ "display": "99/10 (42.3)" }, { "display": "295/10 (107.1)", "followOn": true }]
		}
	],
	"live": null
}
```

Note: Australia's second innings is match innings 3 (`inningsId: 3`) and carries
`followOn: true`; inningsSummary keeps match order (RSA, AUS, AUS), which is what
an FE needs to label the tabs. `playerOfMatch.bowling` can be "DNB & DNB" when
the player did not bowl in either innings - do not split that string on " & ".

### ABANDONED - 161260 (3rd ODI, abandoned after the toss)

```json
{
	"id": 161260,
	"format": "ODI",
	"state": "ABANDONED",
	"stateLabel": "Abandoned",
	"rawState": "Abandon",
	"status": "Match abandoned due to rain (with toss)",
	"isLive": false,
	"isUpcoming": false,
	"isComplete": true,
	"toss": { "winnerTeamName": "India", "decision": "BOWL", "decisionText": "Bowling" },
	"result": {
		"type": "ABANDONED",
		"text": "Match abandoned due to rain (with toss)",
		"winnerTeamId": null,
		"winnerTeamName": null,
		"winnerTeamShortName": null,
		"margin": null
	},
	"playerOfMatch": [],
	"teams": [
		{ "shortName": "NZ", "score": null, "overs": null, "isBatting": false, "innings": [] },
		{ "shortName": "IND", "score": null, "overs": null, "isBatting": false, "innings": [] }
	],
	"inningsSummary": [],
	"hasScorecard": true,
	"live": null
}
```

### NO_RESULT - 161487 (T20I, rain after 2.3 overs)

```json
{
	"id": 161487,
	"format": "T20",
	"state": "COMPLETE",
	"stateLabel": "Completed",
	"rawState": "Complete",
	"status": "No result due to rain",
	"isComplete": true,
	"toss": { "winnerTeamName": "Bahamas", "decision": "BAT", "decisionText": "Batting" },
	"result": {
		"type": "NO_RESULT",
		"text": "No result due to rain",
		"winnerTeamId": null,
		"winnerTeamName": null,
		"winnerTeamShortName": null,
		"margin": null
	},
	"playerOfMatch": [],
	"teams": [
		{ "shortName": "BER", "score": null, "overs": null, "isBatting": false, "innings": [] },
		{ "shortName": "BHM", "score": "15/1", "overs": "2.3", "isBatting": false, "innings": [{ "display": "15/1 (2.3)" }] }
	],
	"inningsSummary": [{ "inningsId": 1, "team": { "shortName": "BHM" }, "score": { "display": "15/1 (2.3)" } }],
	"live": null
}
```

Note: in a list without enrich=full, toss/result/playerOfMatch may be missing
for completed matches (they come from the scorecard). live is null for
finished matches by design (see doc 03).

## 6. States we have NOT captured live yet

These are implemented from the enum + keyword fallback, but no real payload was
recorded. The capture plan in doc 04 targets them; treat the expectations below
as hypotheses to verify.

| State             | Expected upstream signal                      | What to verify                                                                                                  |
| ----------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| DELAYED (in-play) | state "Delay"/"Interrupted", status with rain | is inningsId stable? do overs/batsmen freeze? is DRS reset? (only delays around the toss, 178440, are captured) |
| TIE               | status "Match tied", result.resultType "TIE"  | margin object (value/unit) when tied                                                                            |
| SUPER OVER        | status "Super Over", extra inningsId          | inningsSummary order, target reset, isSuperOver flag                                                            |

## 7. Result normalisation

result is built from the scorecard header (preferred) plus the status text:

| result.type | When                                                           |
| ----------- | -------------------------------------------------------------- |
| WIN         | header.result.resultType is a win, or status contains "won by" |
| DRAW        | status contains "drawn" or resultType DRAW                     |
| TIE         | status contains "tie" or resultType TIE                        |
| NO_RESULT   | status contains "no result" or resultType NO_RESULT            |
| ABANDONED   | status contains "abandon" or resultType ABANDONED              |
| null        | nothing conclusive (match not finished)                        |

winnerTeamId / winnerTeamName / winnerTeamShortName are populated for WIN only;
they are null for DRAW, TIE, NO_RESULT and ABANDONED (166643 draw, 161260
ABANDONED, 161487 NO_RESULT are the verified cases).

NO_RESULT is a **result type, not a state**: a rain washout mid-innings keeps
state COMPLETE / isComplete true and only the result changes (161487). ABANDONED
does change the state (upstream sends "Abandon").

margin:

| unit             | Meaning                      | Example                                          |
| ---------------- | ---------------------------- | ------------------------------------------------ |
| RUNS             | won by N runs                | "won by 36 runs" -> { value: 36, unit: "RUNS" }  |
| WICKETS          | won by N wickets             | "won by 8 wkts" -> { value: 8, unit: "WICKETS" } |
| INNINGS          | won by an innings            | { value: null, unit: "INNINGS" }                 |
| INNINGS_AND_RUNS | won by an innings and N runs | { value: N, unit: "INNINGS_AND_RUNS" }           |

winnerTeamId is matched against the team names in teams[]; if upstream gives
a winning team id (header.result.winningteamId) that id is used directly.

147964 sets both winByRuns and winByInnings to true; INNINGS_AND_RUNS wins and
value is the innings margin (219), not a run margin. The declaration itself is
not in the header, it comes from the innings score: 494/7d carries
score.declared true and displayShort "494/7d".
