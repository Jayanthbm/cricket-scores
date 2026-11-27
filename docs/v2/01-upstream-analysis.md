# 01 - Upstream analysis (Cricbuzz JSON API)

Everything in this document was verified by calling the live endpoints and
diffing the payloads (captures from Nov 2026, see .analysis/raw in a local
checkout and the capture harness in doc 04). It is the evidence base for the
v2 contract.

---

## 1. The four endpoints that exist

Only these return JSON. There is no key, no auth, no cookie.

| Endpoint                                                     | Cache-Control                       | Typical size | Purpose                        |
| ------------------------------------------------------------ | ----------------------------------- | ------------ | ------------------------------ |
| GET https://www.cricbuzz.com/api/home                        | max-age=51                          | ~15-25 KB    | featured/top matches list      |
| GET https://www.cricbuzz.com/api/mcenter/livescore/{matchId} | no-cache, no-store, must-revalidate | ~4-9 KB      | current state of one match     |
| GET https://www.cricbuzz.com/api/mcenter/scorecard/{matchId} | max-age=3                           | ~30-120 KB   | full scorecard + match header  |
| GET https://www.cricbuzz.com/api/mcenter/comm/{matchId}      | max-age=4                           | ~30-80 KB    | recent ball-by-ball commentary |

A browser User-Agent is not required, but we send one. Responses are plain
JSON (UTF-8, application/json).

## 2. What does NOT exist

Every path below was probed and returns HTTP 404 with a ~217 KB HTML error
page (not JSON): mcenter/matchinfo, mcenter/squads, mcenter/playingxi,
mcenter/matchfacts, mcenter/matchfacts/{id}/overs, mcenter/partnerships,
mcenter/leanback, mcenter/venue, mcenter/forecast, mcenter/players,
mcenter/teams, mcenter/team/{id}, player/{id}, playerDetails/{id}.

Consequences for v2:

- **No playing XI / squads.** matchHeader.team1.playerDetails and team2.playerDetails
  are always empty arrays. The only squad-ish signal is commentary INFO entries
  ("Squads:", "X, right handed bat, comes to the crease").
- **No pagination for commentary.** (See section 3.) v2 returns the ~20-25
  most recent entries only.
- No venue stats, no weather/forecast, no series table, no career stats.

## 3. Status codes and what they mean

| Response                   | Meaning                                                                                                    | v2 handling                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 200 JSON                   | normal payload                                                                                             | parse                                                                                      |
| 204 No Content             | (a) commentary for a match with no play yet, or (b) any endpoint for an unknown/invalid match id           | treat as null payload; if every endpoint is null for a request, answer 404 MATCH_NOT_FOUND |
| 403 + HTML "Access Denied" | any query string on an mcenter endpoint (tested: ?i=2, ?p=2, ?page=2, ?offset=20, ?inn=2, ?type=scorecard) | we never send query strings upstream                                                       |
| 404 + HTML                 | path does not exist                                                                                        | not called                                                                                 |

Akamai also fronts these endpoints: after heavy polling from one IP you may
see 403s. The capture harness is deliberately polite (>= 30 s per match).

## 4. /api/home

```json
{
  "matches": [
    {
      "match": {
        "matchInfo": {
          "matchId": 175273, "seriesId": 12037,
          "seriesName": "International League T20 2026", "matchDesc": "8th Match",
          "matchFormat": "T20", "matchType": "league",
          "startDate": "2026-11-26T14:30:00.000Z", "endDate": "...",
          "state": "Complete", "status": "MI Emirates won by 36 runs",
          "team1": { "teamId": 1300, "teamName": "Abu Dhabi Knight Riders", "teamSName": "ADKR", "imageId": 824995 },
          "team2": { ... },
          "venueInfo": { "id": 0, "ground": "Sheikh Zayed Stadium", "city": "Abu Dhabi", "timezone": "+04:00" },
          "currBatTeamId": 1300, "stateTitle": "MIE won", "shortStatus": "MIE won",
          "matchType": "league", "isTournament": true, "matchImageId": 0
        },
        "matchScore": {
          "team1Score": { "inngs1": { "inningsId": 1, "runs": 207, "wickets": 4, "overs": 20 } },
          "team2Score": { "inngs1": { "inningsId": 2, "runs": 171, "wickets": 7, "overs": 20 } }
        }
      }
    }
  ],
  "responseLastUpdated": 1795716681128
}
```

Notes:

- ~6 matches only, and they are _featured_ matches. A live match in a league
  that is not featured simply does not appear (we found 178523 live via the
  website's live-scores page, never in /api/home). Do not treat the home feed
  as a full scoreboard.
- responseLastUpdated is **milliseconds**.
- state values observed: Preview, Toss, In Progress, Complete (+ expected
  Innings Break, Stumps, Delayed, Abandoned). stateTitle is a short display
  string, occasionally the result ("SLA won"), not an enum.
- matchScore only carries per-innings runs/wickets/overs, with the same
  overs quirk (49.6 = 50 overs). It does not say which innings is current.
- currBatTeamId is the team batting _now or last_; it stays set for completed
  matches (so v2 only uses it for in-progress states).
- matchScore.team1Score may be absent for a match that has not started.
- Team order in /api/home can differ from the scorecard header order (for
  175273: home = MIE, ADKR; scorecard = ADKR, MIE).

## 5. /api/mcenter/livescore/{id}

```json
{
  "miniscore": {
    "inningsId": 2, "batTeam": { "teamId": 1300, "teamScore": 171, "teamWkts": 7 },
    "status": "MI Emirates won by 36 runs",
    "batsmanStriker": { "id": 8313, "name": "Jason Holder", "runs": 14, "balls": 8, "fours": 2, "sixes": 0, "strikeRate": "175.00" },
    "batsmanNonStriker": { ... },
    "bowlerStriker": { "id": 14282, "name": "Fazalhaq Farooqi", "overs": 4, "maidens": 0, "runs": 43, "wickets": 2, "economy": 10.75 },
    "bowlerNonStriker": { ... },
    "overs": 20, "target": 208, "partnerShip": { "runs": 25, "balls": 15 },
    "currentRunRate": 8.55, "requiredRunRate": 0, "runsPerBall": 1.42, "requiredRunsPerBall": 0,
    "matchScoreDetails": {
      "matchId": 175273, "matchFormat": "T20", "state": "Complete",
      "customStatus": "MI Emirates won by 36 runs",
      "inningsScoreList": [ { "inningsId": 1, "batTeamId": 1307, "batTeamName": "MI Emirates", "score": 207, "wickets": 4, "overs": 20, "isDeclared": false, "isFollowOn": false, "ballNbr": 120 } ]
    },
    "lastWicket": "",
    "remRunsToWin": 0, "responseLastUpdated": 1795716681128,
    "latestPerformance": [ { "runs": 0, "wkts": 1, "label": "last 5 overs" } ],
    "recentOvsStats": "1 1 1 1 6 0",
    "event": "over-break",
    "batTeamScoreObj": { ... }, "bowlTeamScoreObj": { ... },
    "matchUdrs": { "team1Id": 1300, "team2Id": 1307, "team1Remaining": 2, "team1Successful": 0, "team1Unsuccessful": 0, "team2Remaining": 0, "team2Successful": 0, "team2Unsuccessful": 2 },
    "timestamp": 1795716681128
  },
  "matchCommentary": { ... },
  "responseLastUpdated": 1795716681128
}
```

Field notes:

- overs is a float-ish number with the same 6-ball quirk (9.3 = 9 overs 3 balls).
  v2 normalises it to a string.
- batsmanStriker.strikeRate is a **string** ("175.00"); bowlerStriker has no
  wides/no-balls/dots.
- matchScoreDetails.state is the authoritative raw state for a live match
  ("In Progress", "Stumps", "Innings Break", "Delay", "Complete", ...).
- matchScoreDetails.inningsScoreList gives every innings so far (score object,
  isDeclared/isFollowOn flags) - this is how a Test's 3rd innings is visible
  without the scorecard.
- target is the chase target in runs (0/absent when not chasing). remRunsToWin
  is runs still needed.
- **lastWicket is unreliable**: often empty even after wickets fell, and empty
  at completion. It is a human string:
  "S BalaKrishna b Ratnesh Singh 15(14) - 53/8 in 8.5 ov."
  (double spaces separate name, dismissal, batter score, team score, overs).
- **matchUdrs** exists only for matches with DRS enabled (we saw it on Tests
  and international T20s, absent on minor domestic leagues). team1Id is the
  **batting** team, team2Id the bowling team. Fields: teamNRemaining,
  teamNSuccessful, teamNUnsuccessful.
- latestPerformance is a small "last N overs" summary array.
- recentOvsStats is a space-separated token string for the current over
  ("1 1 1 1 6 0"). Tokens are the scorer's single-character codes: digits, W
  (wicket), N (no ball), WD/LB/B as used by the scorer. v2 passes the tokens
  through unchanged.
- event is a comma string ("wicket", "six", "over-break", "udrs",
  "maiden_over,over-break", "none").
- responseLastUpdated and timestamp are **milliseconds**.
- There is no team name, no venue, no match format label beyond
  matchScoreDetails.matchFormat, and no player images. That is why v2 always
  pairs livescore with the scorecard (or home) to build a match.

## 6. /api/mcenter/scorecard/{id}

Top-level keys: matchHeader, scoreCard[], status, videos, responseLastUpdated,
matchComplete, isMatchComplete. Some matches also carry winProbability.

### matchHeader (richest single object in the API)

matchId, matchDescription, matchFormat, matchType, complete, domestic,
matchStartTimestamp, matchCompleteTimestamp, dayNight, year, dayNumber, state,
status, tossResults { tossWinnerId, tossWinnerName, decision }, result
{ resultType, winningTeam, winningteamId, winningMargin, winByRuns, winByInnings },
revisedTarget, playersOfTheMatch[], playersOfTheSeries[],
matchTeamInfo[{ battingTeamId, battingTeamShortName, bowlingTeamId,
bowlingTeamShortName }], isMatchNotCovered, team1 { id, name, shortName,
playerDetails[] }, team2 { ... }, seriesDesc, seriesId, seriesName,
venue { id, name, city, country, timezone, latitude, longitude }, alertType,
livestreamEnabled.

- matchHeader.complete is not "match finished": 166697 has complete true on
  day 4 of a Sheffield Shield game that is still going. Use state/status for
  liveness and treat complete as "every scheduled innings has data".
- matchFormat values seen: T20, ODI, TEST, T10, HUN (The Hundred). It is not
  trustworthy: the Abu Dhabi T10 and the Hong Kong Sixes both report "T20",
  so the series name has to decide (see doc 02 section 3).
- state values seen: Preview, Upcoming, Toss, In Progress, Tea, Stumps, Delay,
  Complete (+ expected
  Innings Break, Delay, Abandoned, No Result).
- tossResults.decision is "bat" / "bowl" (lowercase in some payloads, "Batting"
  in others - v2 normalises to BAT/BOWL).
- result.resultType is a code (e.g. "TIE", "WIN", "DRAW", "NO_RESULT");
  winningMargin + winByRuns/winByInnings describe the margin.
- playersOfTheMatch[] entries: { id, name, fullName, nickName, teamId, teamName,
  faceImageId, battingSummary? } - **no batting/bowling summary here**, only
  the faceImageId. The same array in /comm's matchHeader has battingSummary
  and bowlingSummary strings.

### scoreCard[] (one entry per innings)

Per innings: matchId, inningsId, timeScore, batTeamDetails { batTeamId,
batTeamName, batTeamShortName, batsmenData { bat_1... } }, bowlTeamDetails
{ ... bowlersData { bowl_1... } }, scoreDetails { ballNbr, overs, revisedOvers,
runRate, runs, wickets, runsPerBall, declared, followOn, isDeclared, isFollowOn },
extrasData { byes, legByes, noBalls, penalty, total, wides },
ppData { pp_1 { ppId, ppOversFrom, ppOversTo, ppType, runsScored } },
wicketsData { wkt_1 { batId, batName, wktOver, wktRuns, ballNbr, wktNbr } },
partnershipsData { pat_1 { bat1Id, bat1Name, bat1Runs, bat2Id, bat2Name,
bat2Runs, totalRuns, totalBalls, bat1fours, bat1sixes, bat1balls, bat2balls } }.

batsmenData row keys: batId, batName, batShortName, isCaptain, isKeeper, runs,
balls, dots, fours, sixes, mins, strikeRate, outDesc, bowlerId, fielderId1..3,
ones, twos, threes, fives, boundaries, sixers, wicketCode, isOverseas,
inMatchChange, playingXIChange.

bowlersData row keys: bowlerId, bowlName, bowlShortName, isCaptain, isKeeper,
overs, maidens, runs, wickets, economy, no_balls, wides, dots, balls,
runsPerBall, isOverseas, inMatchChange, playingXIChange.

Wicket codes observed (wicketCode -> count in our capture set):
CAUGHT 95, BOWLED 31, LBW 13, "" 75, RUNOUT 1, CAUGHTBOWLED 5, STUMPED 2,
RETD_HURT 1, RETD_OUT 1. outDesc examples: "b X", "c X b Y", "lbw b X",
"not out", "batting", "retd out", "" (did not bat).

scoreDetails.overs is the same quirky number; revisedOvers is non-zero for
DLS/reduced matches (use it as the innings ball limit). declared/isDeclared
and followOn/isFollowOn are present.

ppData can hold **more than one** powerplay. Observed: T20 Mandatory 0.1-6,
ODI Mandatory 0.1-10, a rain-reduced T20 with Mandatory 0.1-4 plus a
"Batting" powerplay 15.1-17, and {} for Tests.

winProbability (only on some live matches):
{ drawTiePercent, team1 { id, percent, name, shortName, color }, team2 { ... },
lastUpdatedOver, odds }. It **disappears (null) when the match completes**.

## 7. /api/mcenter/comm/{id}

```json
{
  "matchCommentary": { "1795716681128": { ... }, "...": { ... } },
  "miniscore": { ... same shape as livescore ... },
  "enableNoContent": true,
  "matchHeader": { ... same shape as scorecard header, but playersOfTheMatch
                   entries include battingSummary/bowlingSummary ... },
  "matchVideos": [],
  "page": "commentary",
  "responseLastUpdated": 1795716962
}
```

- matchCommentary is a **dictionary keyed by timestamp** (milliseconds as
  string), not an array, and it is not guaranteed to be ordered.
- Every entry has commType: "commentary" or "over-separator".
- Ball entries: ballMetric (e.g. "19.6"), event[] (none, all, four, six, two,
  wicket, team_hundred, maiden_over, over-break), batsmanDetails
  { playerId, playerName }, bowlerDetails { ... }, teamName, inningsId,
  commText (HTML), overSeparator: null.
- Over separators: timestamp, overNumber, overSummary ("1 1 1 1 6 0 "),
  overRuns, batTeamObj { teamName, teamScore: "171-7" }, batStrikerObj
  { playerId, playerName, playerScore: "11(7)" }, batNonStrikerObj,
  bowlerObj { playerScore: "4-0-42-1" }.
- Non-ball entries (no ballMetric) are INFO: new batter notes, bowler changes,
  "Squads:", result prose, and duplicate wicket announcements ("THATS OUT!!").
- commText is HTML-ish prose. The delivery phrase is the **second
  comma-separated segment**: ", no run", ", 1 run", ", FOUR", ", SIX",
  ", out Bowled!!", ", wide", ", no ball, 1 run", ", byes, 1 run",
  ", leg byes, 1 run", ", Caught&Bowled!!".
- responseLastUpdated here is **seconds** (10 digits), unlike livescore.
- Only the most recent ~20-25 entries come back, for the **latest innings
  only** - a finished Test (161285, three innings) returned 24 entries all with
  inningsId 3, and 166697 returned 23 all with inningsId 4. Earlier innings
  never appear and there is no pagination (403), so a commentary feed cannot
  cross an innings boundary.
- The tail of that window also loses ball numbers: only 6 of 161285's 24
  entries carried ballMetric (18 of 166697's 23), so most entries arrive as
  INFO prose rather than a BALL row.

## 8. Data quirks checklist

1. **Overs encoding**: last digit = ball number 1..6, so 49.6 means 50.0.
   Normalise anywhere you do maths.
2. **Mixed timestamp units**: livescore + home = milliseconds; scorecard +
   commentary = seconds. (v2 normalises with a >1e12 heuristic.)
3. **Team order differs** between /api/home and scorecard header; never assume
   team1 = home team.
4. **miniscore.lastWicket is empty** on many finished matches, even with 7
   wickets down.
5. **Fall of wickets omits retired out** (175273: score says 7 wickets, FOW
   has 6 because Sunil Narine retired out). So FOW length can be < wickets.
6. **Player of the match appears late**: playersOfTheMatch is [] immediately
   after a win and populates minutes later (175273 finished -> []; 177210,
   completed earlier -> 1 entry).
7. **winProbability** is optional per match and sits on the scorecard, so it
   exists before the first ball (151352 at the toss), for Tests mid-match
   (161296 at stumps: NZ 48 / IND 43 / draw 9), and is absent for others
   (175843); it can vanish again at completion.
8. **Home feed is featured-only** (~6 matches) and can omit live games. A plain
   /api/home fetch also returned an empty typeMatches list for the whole 15:00
   window while v2 still had shortStatus and team icons for 177214/162951, so
   emptiness there is not proof a match is unfeatured.
9. **Home state lags livescore** (observed "In Progress" in home while
   livescore already said "Complete"). Prefer livescore, fall back to home.
10. **No squads/XI** anywhere; teamN.playerDetails is always [].
11. **Commentary is truncated** to ~20-25 entries, current innings only.
12. **Duplicate wicket announcements** in commentary (INFO "THATS OUT!!").
13. **POM in scorecard header has no batting/bowling summary**; the same
    array in the comm header does.
14. **matchUdrs.team1Id = batting team**, team2Id = bowling team.
15. **ppData is an object**, can hold multiple powerplays, {} for Tests.
16. **revisedOvers** is the only signal for a DLS/reduced-overs innings.
17. **batsmenData includes did-not-bat rows** (outDesc "", no balls faced).
18. **miniscore.overs and scoreDetails.overs disagree** in type (number vs
    float) but mean the same thing.
19. **status text is the most reliable result description** ("won by 8 wkts",
    "Match drawn", "Match abandoned", ...); header.result is present for
    completed matches but its codes vary.
20. **commentary inningsId is 0** for pre-match INFO entries (squads, venue).

## 9. Trap -> v2 handling table

| Trap                    | v2 behaviour                                                             |
| ----------------------- | ------------------------------------------------------------------------ |
| overs 49.6              | oversToBalls() -> balls 300, overs "50", display "317/8 (50)"            |
| seconds vs ms           | toEpochIso() picks *1000 when < 1e12                                     |
| team order              | home order when available, else scorecard header order                   |
| empty lastWicket        | falls back to last FOW entry; lastWicket.source says which               |
| FOW missing retired out | lastWicket.isLatest compares wicketNumber with wickets                   |
| POM delay               | playerOfMatch[] may be empty; docs say "retry later / hub call"          |
| winProbability gone     | match.winProbability null at completion                                  |
| no squads               | didNotBat[] + commentary INFO "Squads:" only; documented gap             |
| commentary truncation   | commentary.entries is "recent", not full history                         |
| duplicate wicket INFO   | dropped when text matches THATS OUT!!                                    |
| target after finish     | live is null once state is COMPLETE/ABANDONED (no stale batsmen/bowlers) |
| isBatting after finish  | false for finished matches (only live-ish states)                        |

## 10. How to re-verify

```bash
curl -s -H 'User-Agent: Mozilla/5.0' https://www.cricbuzz.com/api/home | jq '.matches[].match.matchInfo | {matchId,state,status}'
curl -s -H 'User-Agent: Mozilla/5.0' https://www.cricbuzz.com/api/mcenter/livescore/178523 | jq '.miniscore | {inningsId,status,overs,target,lastWicket}'
curl -s -H 'User-Agent: Mozilla/5.0' https://www.cricbuzz.com/api/mcenter/scorecard/175273 | jq '.matchHeader | {state,status,tossResults,playersOfTheMatch}'
curl -s -H 'User-Agent: Mozilla/5.0' https://www.cricbuzz.com/api/mcenter/comm/175273 | jq '.matchCommentary | to_entries[0:3]'
```

If a probe returns HTML, it is not an API path. If it returns 403, you added a
query string.
