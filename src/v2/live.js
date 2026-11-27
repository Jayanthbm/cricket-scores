import { FINISHED_STATES, FORMAT_INNINGS_BALLS, detectFormat, normalizeState } from './constants';
import { ballsToOvers, oversToBalls, round2, safeArray, scoreLine, stripHtml, toEpochIso, toNumber } from './utils';

function normalizeOversText(overs) {
	const balls = oversToBalls(overs);

	return balls === null ? null : ballsToOvers(balls);
}

function parseLastWicket(text) {
	const raw = stripHtml(text);

	if (!raw) {
		return null;
	}

	const structured = raw.match(/^(.+?)\s{2,}(.*?)\s+(\d+)\((\d+)\)\s*-\s*(\d+\/\d+)\s+in\s+([\d.]+)\s+ov/i);

	if (!structured) {
		return {
			text: raw,
			batter: raw.split(/\s{2,}/)[0],
			dismissal: null,
			runs: null,
			balls: null,
			score: null,
			overs: null,
		};
	}

	return {
		text: raw,
		batter: structured[1].trim(),
		dismissal: structured[2].trim(),
		runs: toNumber(structured[3]),
		balls: toNumber(structured[4]),
		score: structured[5],
		overs: normalizeOversText(structured[6]),
		wicketNumber: toNumber(structured[5].split('/')[1]),
	};
}

function lastWicketFromScorecard(scorecardJson, inningsId) {
	const inningsList = safeArray(scorecardJson?.scoreCard);
	const innings = inningsList.find((item) => toNumber(item.inningsId) === toNumber(inningsId)) || inningsList[inningsList.length - 1];
	const wickets = Object.values(innings?.wicketsData || {});

	if (!wickets.length) {
		return null;
	}

	const last = wickets.reduce((current, item) => (toNumber(item.wktNbr) >= toNumber(current.wktNbr) ? item : current));
	const overs = normalizeOversText(last.wktOver);
	// wicketsData only says who fell and at what score; the dismissed batter's own
	// scorecard row has the dismissal text and the runs/balls.
	const batsmanRow = Object.values(innings?.batTeamDetails?.batsmenData || {}).find((row) => toNumber(row.batId) === toNumber(last.batId));

	return {
		text: `${last.batName} - ${last.wktRuns}/${last.wktNbr} in ${overs} ov.`,
		batter: last.batName || '',
		dismissal: batsmanRow?.outDesc || null,
		runs: batsmanRow ? toNumber(batsmanRow.runs) : null,
		balls: batsmanRow ? toNumber(batsmanRow.balls) : null,
		score: `${last.wktRuns}/${last.wktNbr}`,
		overs,
		batterId: toNumber(last.batId, 0),
	};
}

function buildBatter(raw, isStriker) {
	if (!raw || !raw.id) {
		return null;
	}

	return {
		id: toNumber(raw.id),
		name: raw.name || '',
		runs: toNumber(raw.runs, 0),
		balls: toNumber(raw.balls, 0),
		fours: toNumber(raw.fours, 0),
		sixes: toNumber(raw.sixes, 0),
		strikeRate: round2(raw.strikeRate),
		isStriker: Boolean(isStriker),
	};
}

function buildBowler(raw, isStriker) {
	if (!raw || !raw.id) {
		return null;
	}

	return {
		id: toNumber(raw.id),
		name: raw.name || '',
		overs: normalizeOversText(raw.overs),
		maidens: toNumber(raw.maidens, 0),
		runs: toNumber(raw.runs, 0),
		wickets: toNumber(raw.wickets, 0),
		economy: round2(raw.economy),
		dots: toNumber(raw.dots),
		wides: toNumber(raw.wides),
		noBalls: toNumber(raw.no_balls),
		isStriker: Boolean(isStriker),
	};
}

function withWicketContext(lastWicket, wickets, source) {
	if (!lastWicket) {
		return null;
	}

	const wicketNumber = lastWicket.wicketNumber ?? toNumber(String(lastWicket.score || '').split('/')[1]) ?? lastWicket.wicketNo ?? null;

	return {
		...lastWicket,
		wicketNumber,
		isLatest: wicketNumber === null ? null : wicketNumber === wickets,
		source,
	};
}

function buildTeamRef(team) {
	return team
		? {
				id: toNumber(team.id),
				name: team.name || '',
				shortName: team.shortName || '',
			}
		: null;
}

function resolveTeams({ scorecardJson, teams, battingTeamId, inningsId, inningsScoreEntry }) {
	const header = scorecardJson?.matchHeader;
	const known = teams.length
		? teams
		: [header?.team1, header?.team2].filter(Boolean).map((team) => ({ id: team.id, name: team.name, shortName: team.shortName }));
	const fromInnings = inningsScoreEntry
		? { id: toNumber(inningsScoreEntry.batTeamId), name: inningsScoreEntry.batTeamName || '', shortName: '' }
		: null;
	const batting = known.find((team) => toNumber(team.id) === battingTeamId) || fromInnings;
	const bowlingId = toNumber(safeArray(header?.matchTeamInfo)[inningsId - 1]?.bowlingTeamId);
	const bowling = known.find((team) => toNumber(team.id) === bowlingId) || known.find((team) => toNumber(team.id) !== battingTeamId);

	return { batting, bowling };
}

function buildDrs(udrs, teams) {
	if (!udrs) {
		return null;
	}

	const side = (teamId, remaining, successful, unsuccessful) => {
		const team = teams.find((item) => item.id === toNumber(teamId));

		return {
			teamId: toNumber(teamId),
			teamName: team?.name || '',
			shortName: team?.shortName || '',
			remaining: toNumber(remaining, 0),
			successful: toNumber(successful, 0),
			unsuccessful: toNumber(unsuccessful, 0),
		};
	};

	return {
		batting: side(udrs.team1Id, udrs.team1Remaining, udrs.team1Successful, udrs.team1Unsuccessful),
		bowling: side(udrs.team2Id, udrs.team2Remaining, udrs.team2Successful, udrs.team2Unsuccessful),
	};
}

export function buildWinProbability(raw) {
	if (!raw || (!raw.team1 && !raw.team2)) {
		return null;
	}

	const side = (team) =>
		team
			? {
					id: toNumber(team.id),
					name: team.name || '',
					shortName: team.shortName || '',
					percent: toNumber(team.percent, 0),
					colors: String(team.color || '')
						.split('|')
						.map((color) => color.trim())
						.filter(Boolean),
				}
			: null;

	const odds = raw.odds
		? {
				team1: toNumber(raw.odds.team1_point),
				team2: toNumber(raw.odds.team2_point),
				// Tests price the draw too (161296: 10.6); limited-overs omit it.
				draw: toNumber(raw.odds.draw_point),
			}
		: null;

	return {
		team1: side(raw.team1),
		team2: side(raw.team2),
		drawTiePercent: toNumber(raw.drawTiePercent, 0),
		updatedOver: raw.lastUpdatedOver ?? null,
		odds,
	};
}

function buildTestContext({ format, status, battingTeamId, inningsSummary, currentInningsId, dayNumber, target }) {
	if (format !== 'TEST') {
		return null;
	}

	const text = String(status || '');
	const day = text.match(/day\s*(\d+)/i);
	const lead = text.match(/lead(?:s|ing)?\s+(?:by|of)\s+(\d+)\s+runs?/i);
	const trail = text.match(/trail(?:s|ing)?\s+(?:by|of)\s+(\d+)\s+runs?/i);
	const ownInnings = safeArray(inningsSummary).filter((innings) => toNumber(innings.team?.id) === toNumber(battingTeamId));

	return {
		day: day ? Number(day[1]) : toNumber(dayNumber) || null,
		// 1-4: which innings of the match is being played (equals live.inningsId).
		inningsNumber: toNumber(currentInningsId) || ownInnings.length || null,
		// 1, 2, ...: how many innings this batting side has had in the match.
		teamInningsNumber: ownInnings.length || null,
		leadRuns: lead ? Number(lead[1]) : null,
		trailRuns: trail ? Number(trail[1]) : null,
		target: target ? target.runs : null,
	};
}

function inningsLimitBalls({ format, scorecardJson, inningsId }) {
	const innings = safeArray(scorecardJson?.scoreCard).find((item) => toNumber(item.inningsId) === toNumber(inningsId));
	const revisedOvers = toNumber(innings?.scoreDetails?.revisedOvers);

	if (revisedOvers !== null && revisedOvers > 0) {
		return oversToBalls(revisedOvers);
	}

	return FORMAT_INNINGS_BALLS[format] ?? null;
}

export function buildLive({ livescoreJson, scorecardJson, teams = [], format }) {
	const miniscore = livescoreJson?.miniscore;

	if (!miniscore) {
		return null;
	}

	const inningsId = toNumber(miniscore.inningsId, 0);
	const battingTeamId = toNumber(miniscore.batTeam?.teamId, 0);

	if (!inningsId || !battingTeamId) {
		return null;
	}

	const resolvedFormat = format || detectFormat({ matchFormat: miniscore.matchScoreDetails?.matchFormat });
	// The Hundred livescore sends overs as a raw ball count (98), not as "."
	// notation, so hand it over as `balls` and let scoreLine rebuild the label.
	const hundred = resolvedFormat === 'THE_HUNDRED';
	const inningsScoreList = safeArray(miniscore.matchScoreDetails?.inningsScoreList);
	const inningsScoreEntry = inningsScoreList.find((item) => toNumber(item.inningsId) === inningsId) || null;
	// A rain-reduced innings carries its new length on the scorecard: 178440 sent
	// revisedOvers 13 while the 13-over innings was still being played.
	const currentInnings = safeArray(scorecardJson?.scoreCard).find((item) => toNumber(item.inningsId) === inningsId);
	const revisedOvers = toNumber(currentInnings?.scoreDetails?.revisedOvers);
	const { batting, bowling } = resolveTeams({ scorecardJson, teams, battingTeamId, inningsId, inningsScoreEntry });
	const allTeams = teams.length ? teams : [batting, bowling].filter(Boolean);

	const score = scoreLine({
		runs: miniscore.batTeam?.teamScore,
		wickets: miniscore.batTeam?.teamWkts,
		overs: hundred ? null : miniscore.overs,
		balls: hundred ? toNumber(miniscore.overs) : null,
		runRate: miniscore.currentRunRate,
		revisedOvers,
		format: resolvedFormat,
	});

	const targetRuns = toNumber(miniscore.target, 0);
	// Target minus scored first: it always agrees with the two numbers we expose.
	// remRunsToWin lags a DLS revision (151352 sent target 98 with remRunsToWin 57
	// while the score was 53, so 57 would have contradicted both), and Tests send
	// it as 0 even while a 4th-innings chase is live (166697: "Victoria need 131
	// runs"), so it is only a fallback.
	const computedRunsNeeded = targetRuns > 0 && score.runs !== null ? targetRuns - score.runs : null;
	const runsNeeded = computedRunsNeeded !== null && computedRunsNeeded > 0 ? computedRunsNeeded : toNumber(miniscore.remRunsToWin, 0);
	const limitBalls = inningsLimitBalls({ format: resolvedFormat, scorecardJson, inningsId });
	const ballsRemaining = limitBalls !== null && score.balls !== null ? Math.max(limitBalls - score.balls, 0) : null;
	const providedRequiredRate = toNumber(miniscore.requiredRunRate, 0);
	const requiredRunRate =
		runsNeeded > 0 ? providedRequiredRate || (ballsRemaining ? round2((runsNeeded * 6) / ballsRemaining) : null) : null;

	// A finished match keeps its last score but a chase target is meaningless once
	// the result is known, so drop it to keep clients from rendering "need 51 in 0".
	const matchOver = FINISHED_STATES.has(normalizeState(miniscore.matchScoreDetails?.state, miniscore.status));

	const target =
		targetRuns > 0 && !matchOver
			? {
					runs: targetRuns,
					runsNeeded: runsNeeded > 0 ? runsNeeded : 0,
					ballsRemaining,
					requiredRunRate,
					requiredRunsPerBall: toNumber(miniscore.requiredRunsPerBall) || null,
				}
			: null;

	const partnership = miniscore.partnerShip
		? {
				runs: toNumber(miniscore.partnerShip.runs, 0),
				balls: toNumber(miniscore.partnerShip.balls, 0),
				display: `${toNumber(miniscore.partnerShip.runs, 0)} (${toNumber(miniscore.partnerShip.balls, 0)})`,
			}
		: null;

	const recentBalls = String(miniscore.recentOvsStats || '')
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean);

	const events = String(miniscore.event || '')
		.split(',')
		.map((event) => event.trim())
		.filter((event) => event && event !== 'none' && event !== 'all');

	const recentPerformance = safeArray(miniscore.latestPerformance).map((item) => ({
		label: item.label || '',
		runs: toNumber(item.runs, 0),
		wickets: toNumber(item.wkts, 0),
	}));

	const livescoreWicket = parseLastWicket(miniscore.lastWicket);

	return {
		inningsId,
		battingTeam: buildTeamRef(batting),
		bowlingTeam: buildTeamRef(bowling),
		score,
		target,
		partnership,
		lastWicket: livescoreWicket
			? withWicketContext(livescoreWicket, score.wickets, 'LIVESCORE')
			: withWicketContext(lastWicketFromScorecard(scorecardJson, inningsId), score.wickets, 'FALL_OF_WICKETS'),
		batsmen: {
			striker: buildBatter(miniscore.batsmanStriker, true),
			nonStriker: buildBatter(miniscore.batsmanNonStriker, false),
		},
		bowlers: {
			striker: buildBowler(miniscore.bowlerStriker, true),
			nonStriker:
				toNumber(miniscore.bowlerNonStriker?.id) && toNumber(miniscore.bowlerNonStriker?.id) !== toNumber(miniscore.bowlerStriker?.id)
					? buildBowler(miniscore.bowlerNonStriker, false)
					: null,
		},
		recentBalls,
		recentPerformance,
		events,
		drs: buildDrs(miniscore.matchUdrs, allTeams),
		test: buildTestContext({
			format: resolvedFormat,
			status: miniscore.status,
			battingTeamId,
			inningsSummary: scorecardJson
				? safeArray(scorecardJson.scoreCard).map((innings) => ({
						inningsId: toNumber(innings.inningsId),
						team: { id: toNumber(innings.batTeamDetails?.batTeamId) },
					}))
				: [],
			currentInningsId: inningsId,
			dayNumber: scorecardJson?.matchHeader?.dayNumber,
			target,
		}),
		updatedAt: toEpochIso(miniscore.responseLastUpdated || miniscore.timestamp),
	};
}
