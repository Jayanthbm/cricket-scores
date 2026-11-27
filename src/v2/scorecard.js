import { detectFormat } from './constants';
import { ballsToOvers, oversToBalls, round2, safeArray, scoreLine, sortByNumberKey, toNumber } from './utils';

const DISMISSAL_TYPES = {
	CAUGHT: 'CAUGHT',
	BOWLED: 'BOWLED',
	LBW: 'LBW',
	RUNOUT: 'RUN_OUT',
	CAUGHTBOWLED: 'CAUGHT_AND_BOWLED',
	STUMPED: 'STUMPED',
	HITWICKET: 'HIT_WICKET',
	RETD_HURT: 'RETIRED_HURT',
	RETD_OUT: 'RETIRED_OUT',
};

function dismissalTypeFromText(text) {
	const desc = String(text || '').toLowerCase();

	if (desc.startsWith('c & b') || desc.startsWith('c&b')) {
		return 'CAUGHT_AND_BOWLED';
	}

	if (desc.startsWith('c ')) {
		return 'CAUGHT';
	}

	if (desc.startsWith('b ')) {
		return 'BOWLED';
	}

	if (desc.startsWith('lbw')) {
		return 'LBW';
	}

	if (desc.startsWith('run out') || desc.includes('run out')) {
		return 'RUN_OUT';
	}

	if (desc.startsWith('st ')) {
		return 'STUMPED';
	}

	if (desc.startsWith('hit wicket')) {
		return 'HIT_WICKET';
	}

	if (desc.startsWith('retd') || desc.startsWith('retired')) {
		return desc.includes('hurt') ? 'RETIRED_HURT' : 'RETIRED_OUT';
	}

	return null;
}

function isDidNotBat(row) {
	const desc = String(row.outDesc || '').trim();

	return !desc && toNumber(row.balls, 0) === 0 && toNumber(row.runs, 0) === 0;
}

function buildBattingRow(row) {
	const desc = String(row.outDesc || '').trim();
	const lower = desc.toLowerCase();
	const didNotBat = isDidNotBat(row);
	const code = String(row.wicketCode || '').trim();
	const isNotOut = lower === 'not out' || lower === 'batting';
	const isRetiredHurt = code === 'RETD_HURT' || lower.includes('retired hurt');
	const isOut = !didNotBat && !isNotOut && !isRetiredHurt;
	const dismissalType = didNotBat
		? 'DID_NOT_BAT'
		: isNotOut
			? 'NOT_OUT'
			: DISMISSAL_TYPES[code] || dismissalTypeFromText(desc) || 'UNKNOWN';

	return {
		id: toNumber(row.batId, 0),
		name: row.batName || '',
		shortName: row.batShortName || row.batName || '',
		isCaptain: Boolean(row.isCaptain),
		isKeeper: Boolean(row.isKeeper),
		isOverseas: Boolean(row.isOverseas),
		runs: toNumber(row.runs, 0),
		balls: toNumber(row.balls, 0),
		fours: toNumber(row.fours, 0),
		sixes: toNumber(row.sixes, 0),
		dots: toNumber(row.dots, 0),
		minutes: toNumber(row.mins, 0),
		strikeRate: round2(row.strikeRate),
		isOut,
		isNotOut: isNotOut || isRetiredHurt,
		didNotBat,
		dismissalType,
		dismissalText: desc || null,
		bowlerId: toNumber(row.bowlerId, 0),
		fielderIds: [row.fielderId1, row.fielderId2, row.fielderId3].map((id) => toNumber(id, 0)).filter(Boolean),
		inMatchChange: row.inMatchChange || null,
	};
}

function buildBowlingRow(row) {
	const balls = toNumber(row.balls);
	const overs = balls !== null && balls > 0 ? ballsToOvers(balls) : ballsToOvers(oversToBalls(row.overs));

	return {
		id: toNumber(row.bowlerId, 0),
		name: row.bowlName || '',
		shortName: row.bowlShortName || row.bowlName || '',
		isCaptain: Boolean(row.isCaptain),
		isKeeper: Boolean(row.isKeeper),
		isOverseas: Boolean(row.isOverseas),
		overs,
		balls,
		maidens: toNumber(row.maidens, 0),
		runs: toNumber(row.runs, 0),
		wickets: toNumber(row.wickets, 0),
		economy: round2(row.economy),
		dots: toNumber(row.dots, 0),
		wides: toNumber(row.wides, 0),
		noBalls: toNumber(row.no_balls, 0),
		inMatchChange: row.inMatchChange || null,
	};
}

function buildExtras(extrasData) {
	const byes = toNumber(extrasData?.byes, 0);
	const legByes = toNumber(extrasData?.legByes, 0);
	const wides = toNumber(extrasData?.wides, 0);
	const noBalls = toNumber(extrasData?.noBalls, 0);
	const penalty = toNumber(extrasData?.penalty, 0);
	const parts = [];

	if (byes) parts.push(`b ${byes}`);
	if (legByes) parts.push(`lb ${legByes}`);
	if (wides) parts.push(`w ${wides}`);
	if (noBalls) parts.push(`nb ${noBalls}`);
	if (penalty) parts.push(`p ${penalty}`);

	return {
		total: toNumber(extrasData?.total, 0),
		byes,
		legByes,
		wides,
		noBalls,
		penalty,
		text: parts.join(', '),
	};
}

function buildPowerplay(ppData) {
	return sortByNumberKey(ppData, (key) => toNumber(String(key).replace('pp_', ''), 0)).map(([, pp]) => ({
		id: toNumber(pp.ppId, 0),
		type: pp.ppType || '',
		fromOvers: pp.ppOversFrom ?? null,
		toOvers: pp.ppOversTo ?? null,
		runs: toNumber(pp.runsScored, 0),
		oversText: `${pp.ppOversFrom ?? 0}-${pp.ppOversTo ?? 0}`,
	}));
}

function buildFallOfWickets(wicketsData) {
	return sortByNumberKey(wicketsData, (key, value) => toNumber(value.wktNbr, 0)).map(([, wicket]) => {
		const balls = toNumber(wicket.ballNbr);
		const overs = balls !== null ? ballsToOvers(balls) : ballsToOvers(oversToBalls(wicket.wktOver));

		return {
			wicket: toNumber(wicket.wktNbr, 0),
			runs: toNumber(wicket.wktRuns, 0),
			overs,
			balls,
			batsmanId: toNumber(wicket.batId, 0),
			batsmanName: wicket.batName || '',
			display: `${toNumber(wicket.wktRuns, 0)}/${toNumber(wicket.wktNbr, 0)} (${overs})`,
		};
	});
}

function buildPartnerships(partnershipsData) {
	return sortByNumberKey(partnershipsData, (key) => toNumber(String(key).replace('pat_', ''), 0)).map(([, partnership]) => ({
		runs: toNumber(partnership.totalRuns, 0),
		balls: toNumber(partnership.totalBalls, 0),
		batsmen: [
			{
				id: toNumber(partnership.bat1Id, 0),
				name: partnership.bat1Name || '',
				runs: toNumber(partnership.bat1Runs, 0),
				balls: toNumber(partnership.bat1balls, 0),
				fours: toNumber(partnership.bat1fours, 0),
				sixes: toNumber(partnership.bat1sixes, 0),
			},
			{
				id: toNumber(partnership.bat2Id, 0),
				name: partnership.bat2Name || '',
				runs: toNumber(partnership.bat2Runs, 0),
				balls: toNumber(partnership.bat2balls, 0),
				fours: toNumber(partnership.bat2fours, 0),
				sixes: toNumber(partnership.bat2sixes, 0),
			},
		],
	}));
}

function buildInnings(innings, format) {
	const battingRows = sortByNumberKey(innings.batTeamDetails?.batsmenData, (key) => toNumber(String(key).replace('bat_', ''), 0)).map(
		([, row]) => buildBattingRow(row),
	);
	const bowlingRows = sortByNumberKey(innings.bowlTeamDetails?.bowlersData, (key) => toNumber(String(key).replace('bowl_', ''), 0)).map(
		([, row]) => buildBowlingRow(row),
	);
	const score = scoreLine({
		runs: innings.scoreDetails?.runs,
		wickets: innings.scoreDetails?.wickets,
		balls: innings.scoreDetails?.ballNbr,
		overs: innings.scoreDetails?.overs,
		runRate: innings.scoreDetails?.runRate,
		declared: innings.scoreDetails?.isDeclared,
		followOn: innings.scoreDetails?.isFollowOn,
		format,
	});

	return {
		inningsId: toNumber(innings.inningsId),
		battingTeam: {
			id: toNumber(innings.batTeamDetails?.batTeamId, 0),
			name: innings.batTeamDetails?.batTeamName || '',
			shortName: innings.batTeamDetails?.batTeamShortName || '',
		},
		bowlingTeam: {
			id: toNumber(innings.bowlTeamDetails?.bowlTeamId, 0),
			name: innings.bowlTeamDetails?.bowlTeamName || '',
			shortName: innings.bowlTeamDetails?.bowlTeamShortName || '',
		},
		score,
		isDeclared: score.declared,
		isFollowOn: score.followOn,
		extras: buildExtras(innings.extrasData),
		powerplay: buildPowerplay(innings.ppData),
		batting: battingRows.filter((row) => !row.didNotBat),
		bowling: bowlingRows,
		didNotBat: battingRows.filter((row) => row.didNotBat).map((row) => ({ id: row.id, name: row.name })),
		fallOfWickets: buildFallOfWickets(innings.wicketsData),
		partnerships: buildPartnerships(innings.partnershipsData),
	};
}

export function buildScorecard(scorecardJson) {
	const header = scorecardJson?.matchHeader;
	const format = detectFormat({
		matchFormat: header?.matchFormat,
		seriesName: header?.seriesName,
		matchDesc: header?.matchDescription,
	});

	return safeArray(scorecardJson?.scoreCard)
		.map((innings) => buildInnings(innings, format))
		.sort((left, right) => (left.inningsId || 0) - (right.inningsId || 0));
}
