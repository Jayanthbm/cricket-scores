import { scoreLine, stripHtml, toIso, toNumber } from './utils';

const EXTRA_OUTCOMES = {
	wide: 'WIDE',
	'no ball': 'NO_BALL',
	bye: 'BYE',
	byes: 'BYE',
	'leg bye': 'LEG_BYE',
	'leg byes': 'LEG_BYE',
};

function parseRunsToken(token) {
	const match = String(token || '').match(/(\d+)\s*runs?/i);

	if (match) {
		return Number(match[1]);
	}

	const plain = String(token || '')
		.trim()
		.match(/^(\d+)$/);

	return plain ? Number(plain[1]) : null;
}

function runsFromParts(parts, startIndex) {
	for (let index = startIndex; index < Math.min(parts.length, startIndex + 2); index += 1) {
		const runs = parseRunsToken(parts[index]);

		if (runs !== null) {
			return runs;
		}
	}

	return 0;
}

// The delivery phrase is always the second comma-separated segment, e.g.
// "Bowler to Batter, no ball, 1 run, ..." -> "no ball".
function deriveDelivery(text, tags) {
	const parts = String(text || '').split(', ');
	const delivery = (parts[1] || '').toLowerCase();
	const taggedWicket = tags.includes('wicket');
	const wicketInText = /\bout\b|caught|stumped|run out|lbw b /.test(delivery);
	const isWicket = taggedWicket || wicketInText;

	if (isWicket) {
		return {
			outcome: /run out/i.test(delivery) ? 'RUN_OUT' : 'WICKET',
			runs: runsFromParts(parts, 2),
			isWicket: true,
			isBoundary: false,
			isExtra: false,
		};
	}

	for (const [token, outcome] of Object.entries(EXTRA_OUTCOMES)) {
		if (delivery.startsWith(token)) {
			const penalty = token === 'wide' || token === 'no ball' ? 1 : 0;

			return {
				outcome,
				runs: penalty + runsFromParts(parts, token === 'wide' ? 2 : 2),
				isWicket: false,
				isBoundary: false,
				isExtra: true,
			};
		}
	}

	if (delivery.startsWith('four')) {
		return { outcome: 'FOUR', runs: 4, isWicket: false, isBoundary: true, isExtra: false };
	}

	if (delivery.startsWith('six')) {
		return { outcome: 'SIX', runs: 6, isWicket: false, isBoundary: true, isExtra: false };
	}

	if (delivery.startsWith('no run')) {
		return { outcome: 'DOT', runs: 0, isWicket: false, isBoundary: false, isExtra: false };
	}

	const runs = parseRunsToken(delivery);

	if (runs !== null) {
		return { outcome: 'RUN', runs, isWicket: false, isBoundary: false, isExtra: false };
	}

	return { outcome: 'UNKNOWN', runs: null, isWicket: false, isBoundary: false, isExtra: false };
}

function buildBallEntry(item, id) {
	const ballMetric = toNumber(item.ballMetric);

	if (ballMetric === null) {
		return null;
	}

	// Keep the scorer's own over.ball notation: 19.6 is the 6th ball of over 19,
	// not the first ball of over 20 (oversToBalls would fold it into 20.0).
	const overNumber = Math.trunc(ballMetric);
	const ballInOver = Math.round((ballMetric - overNumber) * 10);
	const text = stripHtml(item.commText);
	const tags = (Array.isArray(item.event) ? item.event : [])
		.map((tag) => String(tag).toLowerCase())
		.filter((tag) => tag && tag !== 'none' && tag !== 'all');
	const delivery = deriveDelivery(text, tags);

	return {
		id,
		type: 'BALL',
		inningsId: toNumber(item.inningsId, 0),
		over: overNumber,
		ball: ballInOver,
		label: String(ballMetric),
		outcome: delivery.outcome,
		runs: delivery.runs,
		isWicket: delivery.isWicket,
		isBoundary: delivery.isBoundary,
		isExtra: delivery.isExtra,
		batsman: item.batsmanDetails ? { id: toNumber(item.batsmanDetails.playerId, 0), name: item.batsmanDetails.playerName || '' } : null,
		bowler: item.bowlerDetails ? { id: toNumber(item.bowlerDetails.playerId, 0), name: item.bowlerDetails.playerName || '' } : null,
		text,
		tags,
		timestamp: toIso(item.timestamp),
	};
}

function parseFigures(value) {
	const parts = String(value || '').split('-');

	if (parts.length !== 4) {
		return null;
	}

	return {
		overs: parts[0],
		maidens: toNumber(parts[1], 0),
		runs: toNumber(parts[2], 0),
		wickets: toNumber(parts[3], 0),
	};
}

function parseBatterScore(value) {
	const match = String(value || '').match(/^(\d+)\((\d+)\)$/);

	if (!match) {
		return { runs: 0, balls: 0, text: value || '' };
	}

	return { runs: Number(match[1]), balls: Number(match[2]), text: value };
}

function buildOverEntry(item, id) {
	const separator = item.overSeparator || {};
	const summary = String(separator.overSummary || '')
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean);
	const scoreMatch = String(separator.batTeamObj?.teamScore || '').match(/^(\d+)-(\d+)$/);
	const score = scoreMatch ? scoreLine({ runs: Number(scoreMatch[1]), wickets: Number(scoreMatch[2]) }) : null;

	return {
		id,
		type: 'OVER',
		inningsId: toNumber(item.inningsId, 0),
		overNumber: toNumber(separator.overNumber, 0),
		runs: toNumber(separator.overRuns, 0),
		summary,
		summaryText: summary.join(' '),
		score: score ? { runs: score.runs, wickets: score.wickets, display: `${score.runs}/${score.wickets}` } : null,
		teamName: separator.batTeamObj?.teamName || '',
		batsmen: [separator.batStrikerObj, separator.batNonStrikerObj].filter(Boolean).map((player) => ({
			id: toNumber(player.playerId, 0),
			name: player.playerName || '',
			...parseBatterScore(player.playerScore),
		})),
		bowler: separator.bowlerObj
			? {
					id: toNumber(separator.bowlerObj.playerId, 0),
					name: separator.bowlerObj.playerName || '',
					figures: parseFigures(separator.bowlerObj.playerScore),
					figuresText: separator.bowlerObj.playerScore || '',
				}
			: null,
		timestamp: toIso(item.timestamp),
	};
}

function buildInfoEntry(item, id) {
	const text = stripHtml(item.commText);
	const tags = (Array.isArray(item.event) ? item.event : [])
		.map((tag) => String(tag).toLowerCase())
		.filter((tag) => tag && tag !== 'none' && tag !== 'all');

	return {
		id,
		type: 'INFO',
		inningsId: toNumber(item.inningsId, 0),
		text,
		tags,
		timestamp: toIso(item.timestamp),
	};
}

const DUPLICATE_WICKET_ANNOUNCEMENT = /THATS OUT!!/i;

export function buildCommentary(commJson) {
	const raw = commJson?.matchCommentary;

	if (!raw || typeof raw !== 'object') {
		return { available: false, inningsId: null, entries: [], updatedAt: null };
	}

	const entries = [];

	for (const [id, item] of Object.entries(raw)) {
		if (!item) {
			continue;
		}

		if (item.commType === 'over-separator') {
			entries.push(buildOverEntry(item, id));
			continue;
		}

		if (item.ballMetric !== null && item.ballMetric !== undefined) {
			const entry = buildBallEntry(item, id);

			if (entry) {
				entries.push(entry);
			}

			continue;
		}

		// Separate "THATS OUT!!" notes duplicate the wicket ball entry itself.
		if (DUPLICATE_WICKET_ANNOUNCEMENT.test(String(item.commText || ''))) {
			continue;
		}

		entries.push(buildInfoEntry(item, id));
	}

	entries.sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));

	const latestBall = entries.find((entry) => entry.type === 'BALL');

	return {
		available: true,
		inningsId: latestBall ? latestBall.inningsId : (entries.find((entry) => entry.inningsId)?.inningsId ?? null),
		entries,
		updatedAt: toIso(commJson.responseLastUpdated),
	};
}
