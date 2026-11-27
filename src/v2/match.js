import { FINISHED_STATES, LIVE_STATES, MATCH_STATE, STATE_LABELS, detectFormat, normalizeState } from './constants';
import { buildLive, buildWinProbability } from './live';
import { buildTeamCard, buildTeamRef } from './teams';
import { formatDateTime, safeArray, scoreLine, slugify, toIso, toNumber } from './utils';

const BREAK_STATES = new Set([MATCH_STATE.INNINGS_BREAK, MATCH_STATE.SESSION_BREAK, MATCH_STATE.STUMPS]);

const STALE_SHORT_STATUS = /opt to (bat|bowl)|^rain|need \d+ runs?|innings break|stumps|delay|abandon/i;

const RESULT_TYPES = {
	win: 'WIN',
	draw: 'DRAW',
	tie: 'TIE',
	'no result': 'NO_RESULT',
	no_result: 'NO_RESULT',
	abandoned: 'ABANDONED',
};

function resolveTeamShortName(teams, teamId, fallbackName = '') {
	const team = teams.find((item) => item.id === toNumber(teamId));

	if (team) {
		return team.shortName;
	}

	const named = teams.find((item) => item.name === fallbackName || item.shortName === fallbackName);

	return named ? named.shortName : '';
}

function winnerFromStatus(status = '') {
	const match = String(status).match(/^(.+?) won by /i);

	return match ? match[1].trim() : '';
}

function resultTypeFromStatus(status = '') {
	const text = String(status);

	if (/abandon|called off/i.test(text)) {
		return 'ABANDONED';
	}

	if (/no result/i.test(text)) {
		return 'NO_RESULT';
	}

	if (/\bwon by\b/i.test(text)) {
		return 'WIN';
	}

	if (/\btied\b/i.test(text)) {
		return 'TIE';
	}

	if (/\bdrawn\b/i.test(text)) {
		return 'DRAW';
	}

	return null;
}

function marginFromStatus(status = '') {
	const text = String(status);
	const innings = text.match(/innings and (\d+) runs/i);

	if (innings) {
		return { value: Number(innings[1]), unit: 'INNINGS_AND_RUNS' };
	}

	const runs = text.match(/won by (\d+) runs?/i);

	if (runs) {
		return { value: Number(runs[1]), unit: 'RUNS' };
	}

	const wickets = text.match(/won by (\d+) wkts?|won by (\d+) wickets?/i);

	if (wickets) {
		return { value: Number(wickets[1] || wickets[2]), unit: 'WICKETS' };
	}

	return null;
}

function buildResult(header, status, teams) {
	const raw = header?.result || {};
	const rawType = String(raw.resultType || '')
		.trim()
		.toLowerCase();
	const type = RESULT_TYPES[rawType] || resultTypeFromStatus(status);

	if (!type) {
		return null;
	}

	const winnerTeamName = raw.winningTeam || (type === 'WIN' ? winnerFromStatus(status) : '');
	const matchedTeam = teams.find((team) => team.name === winnerTeamName || team.shortName === winnerTeamName);
	const winnerTeamId = toNumber(raw.winningteamId) || matchedTeam?.id || 0;
	const marginValue = toNumber(raw.winningMargin);

	let margin = null;

	if (type === 'WIN') {
		const unit = raw.winByInnings ? 'INNINGS_AND_RUNS' : raw.winByRuns ? 'RUNS' : marginValue !== null ? 'WICKETS' : null;

		margin = unit && marginValue !== null ? { value: marginValue, unit } : marginFromStatus(status);
	}

	// Draws, ties, no-results and abandonments have no winning side: keep every
	// winner field null instead of leaking 0 / '' for the client to filter out.
	const isWin = type === 'WIN';

	return {
		type,
		text: status || header?.status || '',
		winnerTeamId: isWin ? winnerTeamId || null : null,
		winnerTeamName: isWin ? winnerTeamName || matchedTeam?.name || null : null,
		winnerTeamShortName: isWin ? matchedTeam?.shortName || null : null,
		margin,
	};
}

function buildToss(header, teams) {
	const toss = header?.tossResults;

	if (!toss?.tossWinnerName) {
		return null;
	}

	const decisionText = toss.decision || '';
	const decision = /^bat/i.test(decisionText) ? 'BAT' : /^bowl/i.test(decisionText) ? 'BOWL' : 'UNKNOWN';
	const winnerTeamId = toNumber(toss.tossWinnerId) || 0;

	return {
		winnerTeamId,
		winnerTeamName: toss.tossWinnerName,
		winnerTeamShortName: resolveTeamShortName(teams, winnerTeamId, toss.tossWinnerName),
		decision,
		decisionText,
	};
}

function summaryText(value) {
	const text = typeof value === 'string' ? value.trim() : '';

	return text || null;
}

function buildPlayerAward(player, baseUrl, fallbackPlayer) {
	const imageId = toNumber(player?.faceImageId) ?? toNumber(fallbackPlayer?.faceImageId);
	const name = player?.fullName || player?.name || fallbackPlayer?.fullName || '';
	// The comm header carries the summaries but no team, the scorecard header
	// carries the team but no summaries (151352); 0 is upstream's unknown team.
	const teamId = toNumber(player?.teamId) || toNumber(fallbackPlayer?.teamId) || null;
	const teamName = player?.teamName || fallbackPlayer?.teamName || null;

	return {
		id: toNumber(player?.id),
		name: player?.name || name,
		fullName: name,
		teamId,
		teamName,
		faceImageUrl: imageId ? `${baseUrl}/v2/player-icon/${imageId}/${slugify(name) || 'player'}` : null,
		batting: summaryText(player?.battingSummary) ?? summaryText(fallbackPlayer?.battingSummary),
		bowling: summaryText(player?.bowlingSummary) ?? summaryText(fallbackPlayer?.bowlingSummary),
	};
}

function buildAwardsWithFallback(primary, fallback, baseUrl) {
	const other = Array.isArray(fallback) ? fallback : [];

	return (Array.isArray(primary) ? primary : []).map((player) => {
		const match = other.find((candidate) => toNumber(candidate?.id) === toNumber(player?.id));

		return buildPlayerAward(player, baseUrl, match);
	});
}

const SHORT_RESULT = {
	DRAW: 'Match drawn',
	TIE: 'Match tied',
	NO_RESULT: 'No result',
	ABANDONED: 'Abandoned',
};

function shortResultText(result) {
	if (!result) {
		return null;
	}

	if (result.type === 'WIN') {
		return result.winnerTeamShortName ? `${result.winnerTeamShortName} won` : result.text;
	}

	return SHORT_RESULT[result.type] || result.text;
}

function buildAwards(players, baseUrl) {
	return safeArray(players)
		.filter((player) => player && (player.id || player.name))
		.map((player) => buildPlayerAward(player, baseUrl));
}

function buildStateFlags(state) {
	return {
		isLive: LIVE_STATES.has(state),
		isUpcoming: state === MATCH_STATE.SCHEDULED || state === MATCH_STATE.TOSS,
		isComplete: FINISHED_STATES.has(state),
		isDelayed: state === MATCH_STATE.DELAYED,
	};
}

function buildVenue(header, homeInfo) {
	const venue = header?.venue || {};
	const name = venue.name || homeInfo?.venueInfo?.ground || '';
	const city = venue.city || homeInfo?.venueInfo?.city || '';

	return {
		id: toNumber(venue.id, 0),
		name,
		city,
		country: venue.country || '',
		timezone: venue.timezone || homeInfo?.venueInfo?.timezone || '',
		latitude: venue.latitude || '',
		longitude: venue.longitude || '',
		short: name && city ? `${name}, ${city}` : name || city,
	};
}

function inningsFromScorecard(scorecardJson, format) {
	return safeArray(scorecardJson?.scoreCard).map((innings) => ({
		inningsId: toNumber(innings.inningsId),
		team: buildTeamRef({
			id: innings.batTeamDetails?.batTeamId,
			name: innings.batTeamDetails?.batTeamName,
			shortName: innings.batTeamDetails?.batTeamShortName,
		}),
		score: scoreLine({
			runs: innings.scoreDetails?.runs,
			wickets: innings.scoreDetails?.wickets,
			balls: innings.scoreDetails?.ballNbr,
			overs: innings.scoreDetails?.overs,
			runRate: innings.scoreDetails?.runRate,
			declared: innings.scoreDetails?.isDeclared,
			followOn: innings.scoreDetails?.isFollowOn,
			revisedOvers: innings.scoreDetails?.revisedOvers,
			format,
		}),
	}));
}

export function buildHomeInnings(homeTeamScore, format) {
	const innings = [];

	for (const key of ['inngs1', 'inngs2', 'inngs3']) {
		const raw = homeTeamScore?.[key];

		if (!raw) {
			continue;
		}

		innings.push({
			inningsId: toNumber(raw.inningsId),
			...scoreLine({
				runs: raw.runs,
				wickets: raw.wickets,
				overs: raw.overs,
				format,
			}),
		});
	}

	return innings;
}

function inningsFromHome(homeInfo, homeMatch, format) {
	const score = homeMatch?.matchScore || homeMatch?.match?.matchScore || {};
	const pairs = [
		[homeInfo?.team1, score.team1Score],
		[homeInfo?.team2, score.team2Score],
	];
	const list = [];

	for (const [team, teamScore] of pairs) {
		for (const innings of buildHomeInnings(teamScore, format)) {
			list.push({
				inningsId: innings.inningsId,
				team: buildTeamRef(team),
				score: innings,
			});
		}
	}

	return list.sort((left, right) => (left.inningsId || 0) - (right.inningsId || 0));
}

function buildTeamCards({ header, scorecardJson, homeInfo, homeMatch, livescoreJson, baseUrl, state, format }) {
	const inningsList = scorecardJson ? inningsFromScorecard(scorecardJson, format) : inningsFromHome(homeInfo, homeMatch, format);
	const battingTeamId = toNumber(livescoreJson?.miniscore?.batTeam?.teamId) || toNumber(homeInfo?.currBatTeamId);
	// Nobody is batting during an innings break: livescore still points at the
	// side that was just bowled out (or declared), so the flag must drop.
	const showBatting = LIVE_STATES.has(state) && state !== MATCH_STATE.INNINGS_BREAK;

	const rawTeams = header
		? [
				{ id: header.team1?.id, name: header.team1?.name, shortName: header.team1?.shortName },
				{ id: header.team2?.id, name: header.team2?.name, shortName: header.team2?.shortName },
			]
		: [
				{ id: homeInfo?.team1?.teamId, name: homeInfo?.team1?.teamName, shortName: homeInfo?.team1?.teamSName },
				{ id: homeInfo?.team2?.teamId, name: homeInfo?.team2?.teamName, shortName: homeInfo?.team2?.teamSName },
			];

	// Upstream team1/team2 ordering differs between /api/home and the scorecard
	// header, so use the home order whenever it is available to stay stable.
	const order = homeInfo
		? [toNumber(homeInfo.team1?.teamId), toNumber(homeInfo.team2?.teamId)]
		: [toNumber(header?.team1?.id), toNumber(header?.team2?.id)];

	const teams = rawTeams
		.map((team) => ({
			...team,
			id: toNumber(team.id),
			innings: inningsList.filter((innings) => innings.team.id === toNumber(team.id)).map((innings) => innings.score),
			isBatting: showBatting && Boolean(battingTeamId && battingTeamId === toNumber(team.id)),
		}))
		.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));

	return teams.map((team) => buildTeamCard({ ...team, baseUrl }));
}

function buildSeries(header, homeInfo) {
	return {
		id: toNumber(header?.seriesId ?? homeInfo?.seriesId, 0),
		name: header?.seriesName || homeInfo?.seriesName || '',
		desc: header?.seriesDesc || header?.seriesName || homeInfo?.seriesName || '',
	};
}

export function buildMatch({
	header = null,
	scorecardJson = null,
	commHeader = null,
	homeMatch = null,
	livescoreJson = null,
	baseUrl,
	hasScorecard,
}) {
	const homeInfo = homeMatch?.matchInfo || homeMatch?.match?.matchInfo || null;

	if (!header && !homeInfo) {
		return null;
	}

	const status = livescoreJson?.miniscore?.status || header?.status || homeInfo?.status || '';
	const rawState = livescoreJson?.miniscore?.matchScoreDetails?.state || header?.state || homeInfo?.state || '';
	const state = normalizeState(rawState, status);
	const format = detectFormat({
		matchFormat: header?.matchFormat || homeInfo?.matchFormat,
		seriesName: header?.seriesName || homeInfo?.seriesName,
		matchDesc: header?.matchDescription || homeInfo?.matchDesc,
	});
	const startTime = header?.matchStartTimestamp || homeInfo?.startDate;
	const endTime = header?.matchCompleteTimestamp || homeInfo?.endDate;

	const match = {
		id: toNumber(header?.matchId ?? homeInfo?.matchId),
		format,
		formatLabel: header?.matchFormat || homeInfo?.matchFormat || format,
		matchDesc: header?.matchDescription || homeInfo?.matchDesc || '',
		matchType: header?.matchType || homeInfo?.matchType || '',
		state,
		stateLabel: STATE_LABELS[state] || state,
		rawState: rawState || null,
		status,
		shortStatus: homeInfo?.shortStatus || null,
		...buildStateFlags(state),
		isSuperOver: /super over/i.test(status),
		series: buildSeries(header, homeInfo),
		venue: buildVenue(header, homeInfo),
		startTime: toIso(startTime),
		startTimeText: formatDateTime(startTime),
		endTime: toIso(endTime),
		dayNight: Boolean(header?.dayNight),
		dayNumber: toNumber(header?.dayNumber, 0) || null,
		year: toNumber(header?.year, 0) || null,
		hasScorecard: hasScorecard ?? Boolean(scorecardJson),
	};

	match.teams = buildTeamCards({ header, scorecardJson, homeInfo, homeMatch, livescoreJson, baseUrl, state, format });
	match.toss = buildToss(header, match.teams);
	match.result = buildResult(header, status, match.teams);
	const awardSource = commHeader?.playersOfTheMatch?.length ? commHeader : header;
	const awardFallback = awardSource === commHeader ? header : commHeader;
	match.playerOfMatch = buildAwardsWithFallback(awardSource?.playersOfTheMatch, awardFallback?.playersOfTheMatch, baseUrl);
	match.playerOfSeries = buildAwardsWithFallback(awardSource?.playersOfTheSeries, awardFallback?.playersOfTheSeries, baseUrl);
	match.inningsSummary = scorecardJson ? inningsFromScorecard(scorecardJson, format) : inningsFromHome(homeInfo, homeMatch, format);
	// The home feed drops finished matches (or keeps the chase line: 151352 ended
	// with shortStatus "England need 7 runs in 50 balls"), so give cards a short
	// result label unless upstream already sent a result-shaped one.
	if (match.isComplete && (!match.shortStatus || STALE_SHORT_STATUS.test(match.shortStatus))) {
		match.shortStatus = shortResultText(match.result) || match.shortStatus;
	}

	// A finished match keeps its final scores in teams/inningsSummary; a live
	// block there would only show stale batsmen/bowlers and a null target.
	const liveRelevant = !FINISHED_STATES.has(state);

	match.live = liveRelevant ? buildLive({ livescoreJson, scorecardJson, teams: match.teams, format }) : null;
	// Odds/probability exist before the first ball and after the last (upstream
	// puts them on the scorecard), so they live on the match, not inside live.
	match.winProbability = buildWinProbability(
		livescoreJson?.miniscore?.winProbability || livescoreJson?.winProbability || scorecardJson?.winProbability,
	);

	// Upstream keeps the toss sentence as the status well into the new innings
	// (175843 still said "Zimbabwe A opt to bowl" at 24/0 in 4), so once a ball
	// has been bowled the score line says more than the toss.
	if (match.live && match.live.score.balls > 0) {
		const batting = match.teams.find((team) => team.isBatting);

		if (batting) {
			if (/opt to (bat|bowl)/i.test(status)) {
				match.status = `${batting.name} ${match.live.score.display}`;
			}

			// shortStatus comes from the home feed, which keeps the toss sentence
			// (151352), a rain label from before the resumption ("Rain", still shown
			// at 46/1 in 4 after play restarted), a chase sentence that goes stale
			// within a ball ("England need 45 runs in 64 balls" while the live block
			// said 40 in 62) or drops the match entirely; the score line is the honest
			// short label in every case.
			if (!match.shortStatus || STALE_SHORT_STATUS.test(match.shortStatus)) {
				match.shortStatus = `${batting.shortName} ${match.live.score.display}`;
			}
		}
	}

	// A break drops the home feed's short label (175843 sent shortStatus null at
	// "Innings Break"), but the innings that just ended is the useful compact
	// label for a list card.
	if (BREAK_STATES.has(state) && match.inningsSummary.length && (!match.shortStatus || STALE_SHORT_STATUS.test(match.shortStatus))) {
		const last = match.inningsSummary[match.inningsSummary.length - 1];

		if (last?.team?.shortName && last?.score?.display) {
			match.shortStatus = `${last.team.shortName} ${last.score.display}`;
		}
	}

	return match;
}
