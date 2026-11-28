# 05 - Coverage: what is verified, what is pending

Status of every state and format-specific behaviour in v2, from **real payloads
only**. A row is `covered` when a captured payload exists and is asserted; it is
`pending` when the code path is written but no real payload has exercised it.

The **Live needed?** column answers the question that matters before hunting:
can a finished match close this row, or does it only exist while play is on?

- **yes** - the payload only exists during play; a finished match keeps
  answering livescore, but only with its terminal state, so the transition is
  gone.
- **no** - derivable from a finished match's scorecard, or already done.

---

## Coverage table

| Format      | Item                                                        | Status  | Live needed? | Evidence / closing move                                                                                                           |
| ----------- | ----------------------------------------------------------- | ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| TEST        | Scheduled / Preview                                         | covered | no           | 161296 preview                                                                                                                    |
| TEST        | Toss                                                        | covered | yes          | 171807 (toss then stumps)                                                                                                         |
| TEST        | Live, day 1, no lead yet                                    | covered | yes          | 171340 (228/6, leadRuns null)                                                                                                     |
| TEST        | Live, day 4, lead + 3 innings                               | covered | yes          | 166697 (inningsNumber 3)                                                                                                          |
| TEST        | Stumps, 1-2 innings                                         | covered | yes          | 171807, 171830, 171817, 161296                                                                                                    |
| TEST        | Tea session break                                           | covered | yes          | 171331 (Plunket Shield)                                                                                                           |
| TEST        | Innings break                                               | covered | yes          | 166697, 171340                                                                                                                    |
| TEST        | Declaration                                                 | covered | no           | 147964, 161285 (720/9d)                                                                                                           |
| TEST        | Follow-on                                                   | covered | no           | 147931 (innings 3, followOn true)                                                                                                 |
| TEST        | Draw                                                        | covered | no           | 161285, 166643, 166697                                                                                                            |
| TEST        | Innings win                                                 | covered | no           | 147964                                                                                                                            |
| TEST        | **Day start (Stumps -> In Progress)**                       | pending | yes          | armed 03:25 on 161296                                                                                                             |
| TEST        | **Lunch session break**                                     | pending | yes          | tea is covered; lunch may never reach livescore                                                                                   |
| TEST        | **Stumps on days 3-5**                                      | pending | yes          | only day 1-2 snapshots so far                                                                                                     |
| TEST        | **Live follow-on / live declaration**                       | pending | yes          | both only seen in finished payloads                                                                                               |
| TEST        | **Delayed (rain / bad light)**                              | pending | yes          | no Test DELAYED payload at all                                                                                                    |
| TEST        | **Abandoned mid-match**                                     | pending | yes          | none captured                                                                                                                     |
| TEST        | **Tied Test**                                               | pending | yes          | resultType TIE; two in history                                                                                                    |
| TEST        | **Extended day (endTime past schedule)**                    | pending | yes          | never observed                                                                                                                    |
| ODI         | Scheduled / Preview                                         | covered | no           | 175843                                                                                                                            |
| ODI         | Toss                                                        | covered | yes          | 175843, 177214                                                                                                                    |
| ODI         | Live                                                        | covered | yes          | 175843 (24/0 in 4), 177210                                                                                                        |
| ODI         | Complete, DLS wins                                          | covered | no           | 161245 (5 wkts), 161256 (4 runs)                                                                                                  |
| ODI         | Abandoned after toss, no innings                            | covered | yes          | 161260                                                                                                                            |
| ODI         | **Innings break**                                           | pending | yes          | no 50-over break captured                                                                                                         |
| ODI         | **Live DLS chase with revised target**                      | pending | yes          | 161245/161256 are finished; revisedOvers reads 0 after the result                                                                 |
| ODI         | **Tie + super over**                                        | pending | yes          | field shape closed by 115165; only the live tie -> super-over transition remains                                                  |
| ODI         | **In-play rain delay**                                      | pending | yes          | none                                                                                                                              |
| ODI         | **Abandoned mid-innings**                                   | pending | yes          | 161260 had no innings                                                                                                             |
| ODI         | **No result with a partial innings**                        | pending | yes          | 161487 is T20                                                                                                                     |
| ODI         | **Powerplay in a rain-reduced innings**                     | pending | yes          | implied by 161245, not asserted                                                                                                   |
| T20         | Scheduled / Upcoming / Preview                              | covered | no           | 151352, 151374, 175283                                                                                                            |
| T20         | Toss                                                        | covered | yes          | 151352, 178440                                                                                                                    |
| T20         | Live + win probability                                      | covered | yes          | 162951 (43/57 at toss, 36/64 after a wicket), 175273                                                                              |
| T20         | Delayed, pre/post toss                                      | covered | yes          | 178440                                                                                                                            |
| T20         | Delayed start                                               | covered | yes          | 162963                                                                                                                            |
| T20         | Rain mid-innings (DLS)                                      | covered | yes          | 162961 (won by 5 wkts DLS)                                                                                                        |
| T20         | **Innings break**                                           | covered | yes          | 175290 (186/4 in 20, then chase from 17:27)                                                                                       |
| T20         | Innings 2 start / chase                                     | covered | yes          | 175290 (inningsId 2, DV 0/0)                                                                                                      |
| T20         | Complete (incl. DLS)                                        | covered | no           | 162961, 151352                                                                                                                    |
| T20         | Abandoned before a ball                                     | covered | yes          | 161476, 162088                                                                                                                    |
| T20         | No result, partial innings                                  | covered | yes          | 161487 (15/1 in 2.3, state COMPLETE)                                                                                              |
| T20         | **Tie + super over**                                        | pending | yes          | field shape closed by 115165; only the live tie -> super-over transition remains                                                  |
| T20         | **Abandoned mid-innings**                                   | pending | yes          | only pre-match abandonment captured                                                                                               |
| T20         | **Target populated at innings break**                       | pending | yes          | 175290 carried "need 187" in status only                                                                                          |
| T10         | Complete, 60-ball limit, labelled "T20" upstream            | covered | no           | 176250                                                                                                                            |
| T20         | **Strategic timeout (IPL / WPL only)**                      | pending | yes          | mid-innings ~2.5 min pause; check whether upstream says anything in state/status (SIG includes status, so any change is captured) |
| T10         | **Toss**                                                    | pending | yes          | -                                                                                                                                 |
| T10         | **Live innings / ball limit applied live**                  | pending | yes          | only a finished payload                                                                                                           |
| T10         | **Innings break**                                           | pending | yes          | short break, 5-min sampling is marginal                                                                                           |
| T10         | **Chase / target / required rate**                          | pending | yes          | -                                                                                                                                 |
| T10         | **Powerplay behaviour**                                     | pending | yes          | -                                                                                                                                 |
| T10         | **Delayed / abandoned**                                     | pending | yes          | -                                                                                                                                 |
| T10         | **Tie + super over**                                        | pending | yes          | field shape closed by 115165; only the live tie -> super-over transition remains                                                  |
| T10         | **Format detection on a live payload**                      | pending | yes          | series-name hint only, never exercised live                                                                                       |
| THE_HUNDRED | Complete, 100-ball limit, matchFormat "HUN"                 | covered | no           | 144673 (overs "9.8" = 9 sets + 8 balls)                                                                                           |
| THE_HUNDRED | **Toss**                                                    | pending | yes          | -                                                                                                                                 |
| THE_HUNDRED | **Live innings**                                            | pending | yes          | -                                                                                                                                 |
| THE_HUNDRED | **Live ball display (10-ball sets)**                        | pending | yes          | only a final card verified                                                                                                        |
| THE_HUNDRED | **Powerplay (25 balls)**                                    | pending | yes          | -                                                                                                                                 |
| THE_HUNDRED | **Innings break**                                           | pending | yes          | -                                                                                                                                 |
| THE_HUNDRED | **Chase**                                                   | pending | yes          | -                                                                                                                                 |
| THE_HUNDRED | **Delayed / abandoned**                                     | pending | yes          | -                                                                                                                                 |
| THE_HUNDRED | **Tie-break (Super 5, not a normal super over)**            | pending | yes          | -                                                                                                                                 |
| SIXES       | Complete, 36-ball (6 over) innings, labelled "T20" upstream | covered | no           | 175110                                                                                                                            |
| SIXES       | **Toss**                                                    | pending | yes          | -                                                                                                                                 |
| SIXES       | **Live innings**                                            | pending | yes          | -                                                                                                                                 |
| SIXES       | **Innings break**                                           | pending | yes          | very short break                                                                                                                  |
| SIXES       | **Chase**                                                   | pending | yes          | -                                                                                                                                 |
| SIXES       | **Delayed / abandoned**                                     | pending | yes          | -                                                                                                                                 |
| SIXES       | **Tie + super over**                                        | pending | yes          | field shape closed by 115165; only the live tie -> super-over transition remains                                                  |
| SIXES       | **Format detection on a live payload**                      | pending | yes          | series-name hint only                                                                                                             |
| ALL         | Player of the match published late                          | known   | no           | 151352 +8m17s, 162951 +22m00s; refetch after ~60 s                                                                                |
| ALL         | Tie + super over, field shape                               | covered | no           | 115165 (DC vs RR, IPL 2025): resultType "tie", winningTeam "", no extra innings, winner only in the status text                   |
| ALL         | **Tie + super over, the transition itself**                 | pending | yes          | same hole in T20/ODI/T10/Hundred/Sixes                                                                                            |

One upstream limitation came out of 115165: the super over has **no innings of
its own**. There is no inningsId 3, no extra scoreCard entry and no super-over
score anywhere in the livescore or scorecard payload - only the status text
("Match tied (Delhi Capitals won the Super Over)"). v2 can therefore flag
`isSuperOver` and name the winner, but cannot report the super-over score.

---

Strategic timeout is a franchise-T20 pause (IPL / WPL, about 2.5 minutes).
It is on the list to find out whether upstream models it at all - if it never
shows up in a payload it stays out of the state list, it is not derived from
commentary.

## Pending (only)

Every row still open, filtered out of the table above.

| Format      | Pending item                                 | Live needed? | Evidence / next step                                                                                                              |
| ----------- | -------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| TEST        | Day start (Stumps -> In Progress)            | yes          | armed 03:25 on 161296                                                                                                             |
| TEST        | Lunch session break                          | yes          | tea is covered; lunch may never reach livescore                                                                                   |
| TEST        | Stumps on days 3-5                           | yes          | only day 1-2 snapshots so far                                                                                                     |
| TEST        | Live follow-on / live declaration            | yes          | both only seen in finished payloads                                                                                               |
| TEST        | Delayed (rain / bad light)                   | yes          | no Test DELAYED payload at all                                                                                                    |
| TEST        | Abandoned mid-match                          | yes          | none captured                                                                                                                     |
| TEST        | Tied Test                                    | yes          | resultType TIE; two in history                                                                                                    |
| TEST        | Extended day (endTime past schedule)         | yes          | never observed                                                                                                                    |
| ODI         | Innings break                                | yes          | no 50-over break captured                                                                                                         |
| ODI         | Live DLS chase with revised target           | yes          | 161245/161256 are finished; revisedOvers reads 0 after the result                                                                 |
| ODI         | Tie + super over                             | yes          | field shape closed by 115165; only the live tie -> super-over transition remains                                                  |
| ODI         | In-play rain delay                           | yes          | none                                                                                                                              |
| ODI         | Abandoned mid-innings                        | yes          | 161260 had no innings                                                                                                             |
| ODI         | No result with a partial innings             | yes          | 161487 is T20                                                                                                                     |
| ODI         | Powerplay in a rain-reduced innings          | yes          | implied by 161245, not asserted                                                                                                   |
| T20         | Tie + super over                             | yes          | field shape closed by 115165; only the live tie -> super-over transition remains                                                  |
| T20         | Abandoned mid-innings                        | yes          | only pre-match abandonment captured                                                                                               |
| T20         | Target populated at innings break            | yes          | 175290 carried "need 187" in status only                                                                                          |
| T20         | Strategic timeout (IPL / WPL only)           | yes          | mid-innings ~2.5 min pause; check whether upstream says anything in state/status (SIG includes status, so any change is captured) |
| T10         | Toss                                         | yes          | any live match                                                                                                                    |
| T10         | Live innings / ball limit applied live       | yes          | only a finished payload                                                                                                           |
| T10         | Innings break                                | yes          | short break, 5-min sampling is marginal                                                                                           |
| T10         | Chase / target / required rate               | yes          | any live match                                                                                                                    |
| T10         | Powerplay behaviour                          | yes          | any live match                                                                                                                    |
| T10         | Delayed / abandoned                          | yes          | any live match                                                                                                                    |
| T10         | Tie + super over                             | yes          | field shape closed by 115165; only the live tie -> super-over transition remains                                                  |
| T10         | Format detection on a live payload           | yes          | series-name hint only, never exercised live                                                                                       |
| THE_HUNDRED | Toss                                         | yes          | any live match                                                                                                                    |
| THE_HUNDRED | Live innings                                 | yes          | any live match                                                                                                                    |
| THE_HUNDRED | Live ball display (10-ball sets)             | yes          | only a final card verified                                                                                                        |
| THE_HUNDRED | Powerplay (25 balls)                         | yes          | any live match                                                                                                                    |
| THE_HUNDRED | Innings break                                | yes          | any live match                                                                                                                    |
| THE_HUNDRED | Chase                                        | yes          | any live match                                                                                                                    |
| THE_HUNDRED | Delayed / abandoned                          | yes          | any live match                                                                                                                    |
| THE_HUNDRED | Tie-break (Super 5, not a normal super over) | yes          | any live match                                                                                                                    |
| SIXES       | Toss                                         | yes          | any live match                                                                                                                    |
| SIXES       | Live innings                                 | yes          | any live match                                                                                                                    |
| SIXES       | Innings break                                | yes          | very short break                                                                                                                  |
| SIXES       | Chase                                        | yes          | any live match                                                                                                                    |
| SIXES       | Delayed / abandoned                          | yes          | any live match                                                                                                                    |
| SIXES       | Tie + super over                             | yes          | field shape closed by 115165; only the live tie -> super-over transition remains                                                  |
| SIXES       | Format detection on a live payload           | yes          | series-name hint only                                                                                                             |
| ALL         | Tie + super over, the transition itself      | yes          | same hole in T20/ODI/T10/Hundred/Sixes                                                                                            |

## Can a past match close any of these?

Almost none. Two reasons:

1. **A finished match's livescore is a terminal snapshot.** It still answers
   200, but only with state "Complete"; every pending _state_ row above is a
   livescore fact (state string, inningsId, target at a break, delay,
   mid-innings abandonment), and the transition that produced it cannot be
   replayed from the scorecard.
2. **A scorecard describes the final shape only.** It can confirm field shapes
   (how a tie is typed, whether a super over gets its own innings), never when a
   state flipped or what a break looked like.

That one row is now closed: 115165 (DC vs RR, IPL 2025) answered with
resultType "tie", an empty winningTeam, two equal innings and no extra innings.
The super over lives only in the status text, which v2 now parses for the winner.

Everything else still needs a live window - in particular the tie -> super over
_transition_, which cannot be observed from a finished match.

---

## What is scheduled

| When (IST)                         | What                                 | Covers                                                                    |
| ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Sat 29 Nov, 03:25-11:10 (armed)    | 161296, Test day 3                   | TEST day start, lunch, dayNumber 2->3, stumps/possible innings change     |
| Sat 29 Nov, 15:10-23:30 (armed)    | 177218, ACC Rising Stars Final (ODI) | ODI innings break, target at the break, chase start, DLS only if it rains |
| next tied match                    | any match that reaches a super over  | the tie -> super-over transition (field shape already closed by 115165)   |
| next IPL / WPL fixture             | strategic timeout                    | whether upstream surfaces the timeout at all, and in which field          |
| next T10 / Hundred / Sixes fixture | any live match                       | the entire live surface of those three formats                            |

Both armed rows are already on the phone; the watchdog restarts them if the
process dies, and the boot hook restarts the watchdog after a reboot.
