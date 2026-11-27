# 03 - v2 API contract

This is the document to integrate against. Field names, types and null rules
here are guaranteed by the implementation in src/v2. Anything not listed is not
part of the contract.

Conventions repeated from the README: ids are numbers, timestamps are ISO 8601
UTC strings (or null), overs are scorer strings, null = unknown (never 0), and
every score object has the same shape.

---

## 1. GET /v2/matches

List of match cards. Query: format, state, seriesId, enrich (see README).

data:

```json
{ "matches": [ MatchCard, ... ] }
```

meta: { generatedAt, source, count, total, lastUpdated, filters }.

- count = matches after filters, total = matches in the home feed.
- A MatchCard is the same match object as in the hub, except live is null
  unless enrich fetches it (only for in-progress matches). No innings[] rows.

Filter examples:

```
/v2/matches?state=live
/v2/matches?state=upcoming,completed&format=T20
/v2/matches?seriesId=12037&enrich=full
```

## 2. GET /v2/matches/:id

The hub: one match object with everything known from home + livescore +
scorecard (+ commentary header when the match is finished, for POM summaries).

data: { "match": Match }

```json
{
  "data": {
    "match": {
      "id": 178523, "format": "T20", "formatLabel": "T20",
      "matchDesc": "8th Match", "matchType": "league",
      "state": "LIVE", "stateLabel": "Live", "rawState": "In Progress",
      "status": "Andaman Admirals need 51 runs in 66 balls",
      "shortStatus": "AMA need 51 runs",
      "isLive": true, "isUpcoming": false, "isComplete": false,
      "isDelayed": false, "isSuperOver": false,
      "series": { "id": 12037, "name": "...", "desc": "..." },
      "venue": { "id": 0, "name": "...", "city": "...", "country": "...",
                 "timezone": "+05:30", "latitude": "", "longitude": "",
                 "short": "Ground, City" },
      "startTime": "2026-11-26T14:30:00.000Z",
      "startTimeText": "26 Nov 2026, 08:00 PM IST",
      "endTime": null, "dayNight": false, "dayNumber": null, "year": 2026,
      "hasScorecard": true,
      "teams": [ TeamCard, TeamCard ],
      "toss": { ... }, "result": null,
      "playerOfMatch": [], "playerOfSeries": [],
      "inningsSummary": [ { "inningsId": 1, "team": {...}, "score": Score } ],
      "live": { ... }
    }
  }
}
```

404 MATCH_NOT_FOUND when neither the scorecard nor the home feed knows the id.
MATCH_NOT_FOUND is always used for an unresolvable match id (never NOT_FOUND).

state follows rawState, except when the status already announces a decided
result ("won by N runs/wkts"): 162951 reported rawState "In Progress" for 21s
after the last ball while the status read "Perth Scorchers Women won by 17
runs". That window now normalises to COMPLETE, so isLive flips false and the
stale shortStatus ("Need 27 off 4b") is replaced with a result label. A tie is
not promoted this way, because a tie can still go to a super over.

## 3. GET /v2/matches/:id/live

Same match object as the hub, built from livescore + scorecard only (no home
call, so icons may be null until the list/home has been called once in the same
isolate). Meant for 5-10 s polling.

data: { "match": Match } (match.live is the interesting part)

404 MATCH_NOT_FOUND when the match has no livescore and no scorecard payload.

## 4. GET /v2/matches/:id/scorecard

data: { "match": Match, "innings": [ Innings, ... ] }

innings is ordered by inningsId and contains one entry per innings that the
scorecard has. 404 MATCH_NOT_FOUND when the scorecard payload is empty.

## 5. GET /v2/matches/:id/commentary

data: { "match": Match, "commentary": Commentary }

Commentary:

```json
{
  "available": true,
  "inningsId": 2,
  "latestInningsOnly": true,
  "entries": [ Entry, ... ],
  "updatedAt": "2026-11-26T18:31:22.000Z"
}
```

- entries is **newest first**. Entries without text are dropped (video
  snippets, `commType: "snippet"`), so every INFO entry has a non-empty text.
- available = false, entries = [] for a match with no commentary payload yet
  (e.g. a match that starts tomorrow).
- Only the most recent ~20-25 entries exist upstream, and **all of them are
  from the latest innings** (161285, a finished Test, sent 24 entries all from
  innings 3). `latestInningsOnly` says so explicitly; earlier innings cannot be
  requested - there is no pagination.
- A drinks break or timeout appears **only as an INFO entry**, never in the
  match payload: 162951 sat at "51/3 (10)" for 1m40s with state LIVE, rawState
  "In Progress" and events [] while commentary carried "Drinks are on the field
  now". No field is derived from those notices.

404 MATCH_NOT_FOUND only when neither commentary, livescore nor the scorecard
header knows the match.

---

## 6. Shared objects

### 6.1 Match

| Field          | Type             | Null | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | ---------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id             | number           | no   | Cricbuzz match id                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| format         | string           | no   | T20, ODI, TEST, T10, THE_HUNDRED, SIXES, OTHER                                                                                                                                                                                                                                                                                                                                                                                                                        |
| formatLabel    | string           | no   | upstream label ("T20", "TEST", "HUN", ...); may disagree with format, see below                                                                                                                                                                                                                                                                                                                                                                                       |
| matchDesc      | string           | no   | "2nd Test", "8th Match", "1st Semi-Final (A1 v B2)"                                                                                                                                                                                                                                                                                                                                                                                                                   |
| matchType      | string           | no   | "league", "International", "domestic", ...                                                                                                                                                                                                                                                                                                                                                                                                                            |
| state          | string           | no   | enum, see doc 02                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| stateLabel     | string           | no   | "Live", "Break", "Stumps", "Completed", "Upcoming", ...                                                                                                                                                                                                                                                                                                                                                                                                               |
| rawState       | string           | yes  | untouched upstream state                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| status         | string           | no   | human status line ("won by 8 wkts", "need 51 runs in 66 balls"); a stale toss sentence is replaced by "<team> <score>" once a ball is bowled                                                                                                                                                                                                                                                                                                                          |
| shortStatus    | string           | yes  | compact upstream status ("SLA won"); live it falls back to "<short> <score>" ("AUS 7/0 (1)") when upstream is stale (toss sentence, "Rain", "Need 64 to win", "Need 164 to win" at 5/0, "England need 45 runs in 64 balls" while the live block said 40 in 62), and at a break it falls back to the innings that just ended ("IREA 278/9 (50)") when the feed sends null or a toss sentence, and finished matches fall back to the result ("Match drawn", "IREA won") |
| isLive         | boolean          | no   | state in {LIVE, SESSION_BREAK, INNINGS_BREAK, STUMPS, DELAYED}                                                                                                                                                                                                                                                                                                                                                                                                        |
| isUpcoming     | boolean          | no   | state in {SCHEDULED, TOSS}                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| isComplete     | boolean          | no   | state in {COMPLETE, ABANDONED}                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| isDelayed      | boolean          | no   | state = DELAYED                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| isSuperOver    | boolean          | no   | status mentions "super over"                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| series         | object           | no   | { id, name, desc } (id 0 if unknown)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| venue          | object           | no   | { id, name, city, country, timezone, latitude, longitude, short } (latitude/longitude are strings, may be "")                                                                                                                                                                                                                                                                                                                                                         |
| startTime      | string           | yes  | ISO UTC                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| startTimeText  | string           | yes  | IST, "27 Nov 2026, 03:30 AM IST"                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| endTime        | string           | yes  | ISO UTC, only when upstream knows it                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| dayNight       | boolean          | no   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| dayNumber      | number           | yes  | Tests only; may be null while the status still says "Day N" (171340)                                                                                                                                                                                                                                                                                                                                                                                                  |
| year           | number           | yes  |                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| hasScorecard   | boolean          | no   | true when a scorecard payload was available (an abandoned match can be true with zero innings - use inningsSummary to render tabs)                                                                                                                                                                                                                                                                                                                                    |
| teams          | TeamCard[2]      | no   | home order when known, else header order                                                                                                                                                                                                                                                                                                                                                                                                                              |
| toss           | Toss             | yes  | null until the toss happened (or needs scorecard)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| result         | Result           | yes  | null until finished                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| playerOfMatch  | Player[]         | no   | [] until upstream publishes it, minutes after the win (151352: 8m17s after the last ball); the comm header carries batting/bowling summaries while the scorecard header carries the team, so v2 merges them by player id. teamId is null when upstream sends 0 (unknown team), teamName null when absent, and summaries are null rather than ""                                                                                                                       |
| playerOfSeries | Player[]         | no   | [] usually                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| inningsSummary | InningsSummary[] | no   | ordered by inningsId, one entry per innings                                                                                                                                                                                                                                                                                                                                                                                                                           |
| live           | Live             | yes  | null for upcoming/finished matches                                                                                                                                                                                                                                                                                                                                                                                                                                    |

`format` is normalised and then corrected from the series name: upstream labels
both the Abu Dhabi T10 and the Hong Kong Sixes as matchFormat "T20", so
`/\bt10\b/` and `/\bsixes\b/` in series.name/matchDesc win over T20/OTHER.
TEST, ODI and The Hundred are never overridden. Always branch on `format`,
treat `formatLabel` as display-only.

### 6.2 Score

Used by team cards, inningsSummary, innings and live.score.

| Field   | Type   | Notes                                    |
| ------- | ------ | ---------------------------------------- |
| runs    | number |                                          |
| wickets | number |                                          |
| overs   | string | "41.3", "50", "97.1" (x.6 normalised up) |
| balls   | number | integer balls bowled                     |

`balls` comes from scoreDetails.ballNbr when upstream sends it, so it stays
correct where overs are written in another counting system. The Hundred is the
only such case today: overs is "9.8" (9 sets of 10 balls + 8) and balls is 98.
On livescore-only payloads a Hundred innings sends overs as the ball count, and
v2 turns that back into "9.8".
| runRate | number | 2 decimals |
| declared | boolean | innings declared |
| followOn | boolean | innings is a follow-on (147931 innings 3) |
| revisedOvers | number \| null | innings length after a rain/DLS revision (13 in 178440, 17 then 16 in 151352); null when upstream sends 0, and it goes back to null at completion even for a reduced innings - the reduction then survives only in the status/result text |
| display | string | "318/2 (41.3)" - render this |
| displayShort | string | "318/2" |

### 6.3 TeamCard

| Field     | Type        | Notes                                          |
| --------- | ----------- | ---------------------------------------------- |
| id        | number      |                                                |
| name      | string      |                                                |
| shortName | string      |                                                |
| icon      | string/null | proxy URL /team-icon/{imageId}/{shortName}     |
| isBatting | boolean     | true only while the match is live-ish          |
| score     | string/null | current/last innings "171/7", null before play |
| overs     | string/null | "20", null before play                         |
| innings   | Score[]     | every innings of this team, ordered            |

### 6.4 Toss / Result / Player

```json
"toss": { "winnerTeamId": 1300, "winnerTeamName": "Abu Dhabi Knight Riders",
          "winnerTeamShortName": "ADKR", "decision": "BOWL", "decisionText": "Bowling" }
```

decision is BAT, BOWL or UNKNOWN; decisionText is the display string ("Batting").
Toss comes from the scorecard header, so it survives matches whose livescore
carries no matchHeader at all (175843 at its toss).

```json
"result": {
  "type": "WIN",                       // WIN, DRAW, TIE, NO_RESULT, ABANDONED
  "text": "Sri Lanka A won by 8 wkts",
  "winnerTeamId": 43, "winnerTeamName": "Sri Lanka A", "winnerTeamShortName": "SLA",
  "margin": { "value": 8, "unit": "WICKETS" }   // RUNS, WICKETS, INNINGS, INNINGS_AND_RUNS
}
```

winnerTeamId, winnerTeamName and winnerTeamShortName are all null unless type
is WIN (draws, ties, no-results and abandonments have no winning side).

```json
{
	"id": 52736,
	"name": "Sineth Jayawardena",
	"fullName": "Sineth Jayawardena",
	"teamId": 0,
	"teamName": "",
	"faceImageUrl": "https://host/v2/player-icon/182026/sineth-jayawardena",
	"batting": "105(70)",
	"bowling": ""
}
```

teamId/teamName can be 0/"" when upstream omits them; faceImageUrl is null if
upstream has no faceImageId.

### 6.5 InningsSummary

```json
{ "inningsId": 1, "team": { "id": 158, "name": "South Australia", "shortName": "SAUS" },
  "score": Score }
```

### 6.6 Live

| Field             | Type        | Null | Notes                                                                                                         |
| ----------------- | ----------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| inningsId         | number      | no   | current innings (0 before start); during an innings break it stays on the innings that just ended             |
| battingTeam       | TeamRef     | yes  | { id, name, shortName }                                                                                       |
| bowlingTeam       | TeamRef     | yes  |                                                                                                               |
| score             | Score       | no   | current innings score                                                                                         |
| target            | Target      | yes  | null when not chasing **and null once finished**                                                              |
| partnership       | object      | yes  | { runs, balls, display }; can lag a ball behind a wicket (175843 kept 22 (33) with the new batter still null) |
| lastWicket        | LastWicket  | yes  | null when no wicket fell                                                                                      |
| batsmen           | object      | no   | { striker: Batter/null, nonStriker: Batter/null }                                                             |
| bowlers           | object      | no   | { striker: Bowler/null, nonStriker: Bowler/null }                                                             |
| recentBalls       | string[]    | no   | tokens of the current over, oldest first                                                                      |
| recentPerformance | object[]    | no   | [{ label, runs, wickets }]                                                                                    |
| events            | string[]    | no   | e.g. ["over-break"], ["wicket"]                                                                               |
| drs               | DRS         | yes  | null when the match has no UDRS                                                                               |
| test              | TestContext | yes  | Tests only; leadRuns/trailRuns are null in a 4th-innings chase - use live.target                              |
| updatedAt         | string      | yes  | ISO upstream response time, not the last ball: it keeps moving during a break while the score is frozen       |

WinProbability sits on **match**, not on live, because upstream publishes it on
the scorecard before the first ball and drops it again on some finished matches:

```json
"winProbability": {
  "team1": { "id": 4, "name": "Australia", "shortName": "AUS", "percent": 46, "colors": ["#DF9916", "#F6B53C"] },
  "team2": { "id": 9, "name": "England", "shortName": "ENG", "percent": 54, "colors": ["#DC3838", "#DC3838"] },
  "drawTiePercent": 0,
  "updatedOver": 0,
  "odds": { "team1": 2.1, "team2": 1.8 }
}
```

team1/team2 are the two sides in upstream's order (not batting order); percent is
an integer share, colors are the two brand colours, updatedOver is the over the
model last ran, odds are decimal prices and null when absent.

It also appears outside internationals: the WBBL match 162951 carried it from the
toss (43/57), moved to 50/50 after one over and 36/64 after a wicket — the model
reacts ball by ball, not just at milestones.

Tests split the probability three ways: 161296 at stumps on day 1 is NZ 48 /
IND 43 with `drawTiePercent` 9, and its odds carry a third price
(`"draw": 10.6`). Limited-overs matches leave both at 0 / null. The whole
object is null once a match finishes (166697) - treat it as an in-play widget.

Target:

```json
{ "runs": 105, "runsNeeded": 51, "ballsRemaining": 66, "requiredRunRate": 4.64, "requiredRunsPerBall": null }
```

ballsRemaining uses the format innings limit or revisedOvers (DLS), so it is
null for Tests. requiredRunsPerBall is null unless upstream provides it.
runsNeeded is runs - score.runs whenever that is positive, and only falls back
to upstream remRunsToWin when it is not. remRunsToWin lags a DLS revision
(151352 sent target 98 and score 53 but remRunsToWin 57, which contradicted
both), and Tests send 0 there even while a 4th-innings chase is live (166697:
target 148, runsNeeded 131). requiredRunRate is upstream's when non-zero,
otherwise recomputed from runsNeeded, so a Test chase keeps it null.

A DLS revision arrives in pieces, roughly 40 s apart (151352): revisedOvers and
the status text ("2nd Innings reduced to 17 Overs, DLS Target 98") update first,
while target.runs and remRunsToWin still carry the pre-rain values (109 and 56).
For a few seconds target.runs is therefore the older number; runsNeeded and
ballsRemaining stay internally consistent with whatever target.runs says.

In a limited-overs chase the opposite lag also happens: miniscore.inningsId
flips to 2 about 30 s before it carries a target (175843 at 17:13:03 said
"Zimbabwe A need 279 runs" with target null while the scorecard still listed
only innings 1). target is then derived as first innings + 1, so the chase
object is already usable; in Tests nothing is derived and it waits for
upstream.

When the chase finishes the reduction leaves the structured fields again
(revisedOvers back to null, target null) but stays in result.text: 151352 ends
with "England won by 7 wkts (2nd Innings reduced to 16 Overs, DLS Target 93)".

LastWicket:

```json
{
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
}
```

source = LIVESCORE when the text came from livescore.lastWicket, else
FALL_OF_WICKETS (built from the scorecard FOW). isLatest compares
wicketNumber with the current wickets, so false means upstream's FOW is missing
a dismissal (e.g. a retired out).

For a FALL_OF_WICKETS entry, dismissal/runs/balls are taken from the dismissed
batter's own scorecard row when that row is present, so a stumps Test still
reads "run out (Siya Plaatjie)" with 20(42). They are null only when upstream's
FOW lists a batter who is not in the innings card.

```json
{
	"text": "Juan James - 28/1 in 11.3 ov.",
	"batter": "Juan James",
	"dismissal": "run out (Siya Plaatjie)",
	"runs": 20,
	"balls": 42,
	"score": "28/1",
	"overs": "11.3",
	"batterId": 31972,
	"wicketNumber": 1,
	"isLatest": true,
	"source": "FALL_OF_WICKETS"
}
```

Batter: { id, name, runs, balls, fours, sixes, strikeRate, isStriker }
Bowler: { id, name, overs, maidens, runs, wickets, economy, dots, wides,
noBalls, isStriker } - dots/wides/noBalls are null in live data (upstream does
not send them there; the scorecard does).

DRS:

```json
{
	"batting": {
		"teamId": 1300,
		"teamName": "Abu Dhabi Knight Riders",
		"shortName": "ADKR",
		"remaining": 2,
		"successful": 0,
		"unsuccessful": 0
	},
	"bowling": { "teamId": 1307, "teamName": "MI Emirates", "shortName": "MIE", "remaining": 0, "successful": 0, "unsuccessful": 2 }
}
```

TestContext:

```json
{ "day": 4, "inningsNumber": 3, "teamInningsNumber": 2, "leadRuns": 106, "trailRuns": null, "target": null }
```

inningsNumber is which innings of the match is being played (1-4, equal to
live.inningsId); teamInningsNumber is how many innings this batting side has
had (its 2nd innings in the example). Both can be null on early data.
leadRuns/trailRuns are parsed from the status text, so they stay null while the
status does not state a lead (for example "Day 1: 3rd Session").

WinProbability:

```json
{ "drawTiePercent": 2, "lastUpdatedOver": "18.4",
  "team1": { "id": 1300, "name": "...", "shortName": "ADKR", "percent": 62, "color": "#00bcd4" },
  "team2": { "id": 1307, "name": "...", "shortName": "MIE", "percent": 36, "color": "#e91e63" },
  "odds": { ... } }
```

Only some matches carry it; null otherwise and after completion.

### 6.7 Innings (scorecard endpoint)

| Field         | Type           | Notes                                     |
| ------------- | -------------- | ----------------------------------------- |
| inningsId     | number         | 1..4                                      |
| battingTeam   | TeamRef        | { id, name, shortName }                   |
| bowlingTeam   | TeamRef        |                                           |
| score         | Score          | includes declared/followOn                |
| isDeclared    | boolean        |                                           |
| isFollowOn    | boolean        |                                           |
| extras        | Extras         |                                           |
| powerplay     | Powerplay[]    | [] for Tests                              |
| batting       | BattingRow[]   | excludes did-not-bat rows                 |
| bowling       | BowlingRow[]   |                                           |
| didNotBat     | [{ id, name }] |                                           |
| fallOfWickets | FallOfWicket[] | may be shorter than wickets (retired out) |
| partnerships  | Partnership[]  |                                           |

Extras: { total, byes, legByes, wides, noBalls, penalty, text: "lb 1, w 16" }

Powerplay: { id, type, fromOvers, toOvers, runs, oversText }
(type is "Mandatory" or "Batting"; oversText "0.1-6"; fromOvers/toOvers are
numbers with the same 6-ball quirk, e.g. 0.1 / 6 / 15.1.)

BattingRow:

```json
{
	"id": 1394,
	"name": "Andre Fletcher",
	"shortName": "Andre Fletcher",
	"isCaptain": false,
	"isKeeper": true,
	"isOverseas": false,
	"runs": 16,
	"balls": 12,
	"fours": 1,
	"sixes": 2,
	"dots": 9,
	"minutes": 12,
	"strikeRate": 133.33,
	"isOut": true,
	"isNotOut": false,
	"didNotBat": false,
	"dismissalType": "BOWLED",
	"dismissalText": "b Fazalhaq Farooqi",
	"bowlerId": 14282,
	"fielderIds": [],
	"inMatchChange": null
}
```

dismissalType is one of: BOWLED, CAUGHT, LBW, RUN_OUT, STUMPED,
CAUGHT_AND_BOWLED, HIT_WICKET, RETIRED_HURT, RETIRED_OUT, OBSTRUCTING,
TIMED_OUT, NOT_OUT, UNKNOWN. dismissalText is the raw "c X b Y" style text.

BowlingRow:

```json
{
	"id": 14282,
	"name": "Fazalhaq Farooqi",
	"shortName": "Fazalhaq Farooqi",
	"isCaptain": false,
	"isKeeper": false,
	"isOverseas": false,
	"overs": "4",
	"balls": 24,
	"maidens": 0,
	"runs": 43,
	"wickets": 2,
	"economy": 10.8,
	"dots": 0,
	"wides": 11,
	"noBalls": 0,
	"inMatchChange": "MIN"
}
```

FallOfWicket: { wicket, runs, overs, balls, batsmanId, batsmanName,
display: "146/6 (17.3)" }

Partnership: { runs, balls, batsmen: [{ id, name, runs, balls, fours, sixes }] }

### 6.8 Commentary entries

Every entry has: id (string), type, inningsId, timestamp (ISO).

BALL:

```json
{
	"id": "1795716681128",
	"type": "BALL",
	"inningsId": 2,
	"over": 20,
	"ball": 0,
	"label": "20",
	"outcome": "DOT",
	"runs": 0,
	"isWicket": false,
	"isBoundary": false,
	"isExtra": false,
	"batsman": { "id": 14728, "name": "Abdullah Tarakhail" },
	"bowler": { "id": 6532, "name": "Chris Jordan" },
	"text": "Chris Jordan to Abdullah Tarakhail, no run",
	"tags": ["none"],
	"timestamp": "2026-11-26T18:11:21.128Z"
}
```

outcome: DOT, RUN, FOUR, SIX, WICKET, RUN_OUT, WIDE, NO_BALL, BYE, LEG_BYE,
UNKNOWN. over and ball keep the scorer's notation: 19.6 is over 19, ball 6
(not over 20, ball 0); 20.0 is over 20, ball 0. label is the same token as a
string ("19.6").

OVER:

```json
{
	"id": "1795716681130",
	"type": "OVER",
	"inningsId": 2,
	"overNumber": 20,
	"runs": 10,
	"summary": ["1", "1", "1", "1", "6", "0"],
	"summaryText": "1 1 1 1 6 0",
	"score": { "runs": 171, "wickets": 7, "display": "171/7" },
	"teamName": "ADKR",
	"batsmen": [{ "id": 14728, "name": "Abdullah Tarakhail", "runs": 11, "balls": 7, "text": "11(7)" }],
	"bowler": { "id": 6532, "name": "Chris Jordan", "figures": "4-0-42-1", "figuresText": "4-0-42-1" },
	"timestamp": "..."
}
```

INFO:

```json
{ "id": "1795717238328", "type": "INFO", "inningsId": 0, "text": "Squads: ...", "tags": [], "timestamp": "..." }
```

INFO covers new-batter notes, bowler changes, squads, venue notes and result
prose. Duplicate wicket announcements ("THATS OUT!!") are dropped.

---

## 7. Front-end recipes

### 7.1 Match list

```js
const res = await fetch(origin + '/v2/matches?state=live,upcoming,completed&format=T20');
const { data } = await res.json();
data.matches.forEach(renderCard);
```

renderCard uses: teams[i].shortName, teams[i].score, teams[i].overs,
teams[i].icon, state/stateLabel, status, toss (if present), startTimeText.
Poll every 20-30 s while the tab is visible.

### 7.2 Match page (state machine)

1. on open: GET /v2/matches/:id -> render header (series, venue, toss, result),
   innings summary, and live block.
2. if match.isLive: poll GET /v2/matches/:id/live every 5-10 s; patch
   match.teams, match.live, match.status, match.state.
3. if match.isComplete: no live polling; if playerOfMatch is empty, refetch
   the hub after ~60 s (upstream publishes awards late).
4. scorecard tab: GET /v2/matches/:id/scorecard once on open, and again when
   live.inningsId changes.
5. commentary tab: GET /v2/matches/:id/commentary every 5-10 s while visible,
   prepend entries whose id is not already rendered (entries are newest first).
6. stop all polling when document.hidden; resume on visibilitychange.

### 7.3 Rendering rules

- Render score.display, never concatenate runs/wickets/overs yourself.
- Switch on state, not on status text. Use isLive/isUpcoming/isComplete.
- Teams: only one team has isBatting true while live; for finished matches
  and during an innings break every isBatting is false (do not paint a
  "batting" badge then), even though livescore still points at the side that
  was batting.
- Show the target banner only when live.target is non-null:
  "Need {runsNeeded} in {ballsRemaining} balls (RRR {requiredRunRate})".
- Show lastWicket when non-null; if lastWicket.isLatest is false, label it
  "Last fall of wicket" rather than "Last wicket".
- For Tests show live.test.day and leadRuns/trailRuns; there is no target until
  the 4th innings.
- Commentary: group by type; OVER entries are inning dividers; INFO entries are
  notes; BALL entries are the ball-by-ball rows. Colour by outcome
  (FOUR/SIX/WICKET badges).
- Icons: use teams[i].icon and player.faceImageUrl directly (proxied, cached).
  They can be null if the Worker isolate has not seen the home feed yet.

### 7.4 Choosing between endpoints

| Need                                | Call                       |
| ----------------------------------- | -------------------------- |
| home screen cards                   | /v2/matches                |
| match header + current situation    | /v2/matches/:id            |
| cheap high-frequency score updates  | /v2/matches/:id/live       |
| full scorecard tab                  | /v2/matches/:id/scorecard  |
| commentary tab                      | /v2/matches/:id/commentary |
| toss / POM for many matches at once | /v2/matches?enrich=full    |

### 7.5 What not to do

- Do not assume /v2/matches contains every live match (home feed is featured).
- Do not poll the hub every second; use /live.
- Do not rely on the order of teams[] being team1/team2 - use ids.
- Do not parse status text for the result; use result.type/margin.
- Do not treat commentary as full history.
