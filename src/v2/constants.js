export const SCHEMA_VERSION = 2;

export const UPSTREAM_BASE = 'https://www.cricbuzz.com/api';

export const UPSTREAM_TIMEOUT_MS = 6000;

// Normalised, FE-friendly match states. Anything we cannot classify becomes UNKNOWN
// and keeps the raw upstream string in `rawState`.
export const MATCH_STATE = {
	SCHEDULED: 'SCHEDULED',
	TOSS: 'TOSS',
	LIVE: 'LIVE',
	SESSION_BREAK: 'SESSION_BREAK',
	INNINGS_BREAK: 'INNINGS_BREAK',
	STUMPS: 'STUMPS',
	DELAYED: 'DELAYED',
	COMPLETE: 'COMPLETE',
	ABANDONED: 'ABANDONED',
	UNKNOWN: 'UNKNOWN',
};

export const STATE_LABELS = {
	SCHEDULED: 'Upcoming',
	TOSS: 'Toss',
	LIVE: 'Live',
	SESSION_BREAK: 'Break',
	INNINGS_BREAK: 'Innings Break',
	STUMPS: 'Stumps',
	DELAYED: 'Delayed',
	COMPLETE: 'Completed',
	ABANDONED: 'Abandoned',
	UNKNOWN: 'Unknown',
};

// States where the match is considered to be in progress (poll-worthy).
export const LIVE_STATES = new Set([
	MATCH_STATE.LIVE,
	MATCH_STATE.SESSION_BREAK,
	MATCH_STATE.INNINGS_BREAK,
	MATCH_STATE.STUMPS,
	MATCH_STATE.DELAYED,
]);

// States where the match has effectively finished.
export const FINISHED_STATES = new Set([MATCH_STATE.COMPLETE, MATCH_STATE.ABANDONED]);

const RAW_STATE_MAP = {
	preview: MATCH_STATE.SCHEDULED,
	upcoming: MATCH_STATE.SCHEDULED,
	scheduled: MATCH_STATE.SCHEDULED,
	toss: MATCH_STATE.TOSS,
	'in progress': MATCH_STATE.LIVE,
	inprogress: MATCH_STATE.LIVE,
	live: MATCH_STATE.LIVE,
	tea: MATCH_STATE.SESSION_BREAK,
	'tea break': MATCH_STATE.SESSION_BREAK,
	lunch: MATCH_STATE.SESSION_BREAK,
	'lunch break': MATCH_STATE.SESSION_BREAK,
	drinks: MATCH_STATE.SESSION_BREAK,
	'session break': MATCH_STATE.SESSION_BREAK,
	'innings break': MATCH_STATE.INNINGS_BREAK,
	inningsbreak: MATCH_STATE.INNINGS_BREAK,
	stumps: MATCH_STATE.STUMPS,
	complete: MATCH_STATE.COMPLETE,
	completed: MATCH_STATE.COMPLETE,
	delay: MATCH_STATE.DELAYED,
	delayed: MATCH_STATE.DELAYED,
	'rain delay': MATCH_STATE.DELAYED,
	rain: MATCH_STATE.DELAYED,
	interrupted: MATCH_STATE.DELAYED,
	abandoned: MATCH_STATE.ABANDONED,
	cancelled: MATCH_STATE.ABANDONED,
	canceled: MATCH_STATE.ABANDONED,
};

export function normalizeState(rawState, status = '') {
	const raw = String(rawState || '').trim();
	const direct = RAW_STATE_MAP[raw.toLowerCase()];

	if (direct) {
		return direct;
	}

	const text = `${raw} ${status}`.toLowerCase();

	if (/abandon|called off|cancelled/.test(text)) {
		return MATCH_STATE.ABANDONED;
	}

	if (/rain|delay|interrupt|wet outfield|bad light|drizzle/.test(text)) {
		return MATCH_STATE.DELAYED;
	}

	if (/stumps|end of day|close of play/.test(text)) {
		return MATCH_STATE.STUMPS;
	}

	if (/innings break|break,? .* need|end of innings/.test(text)) {
		return MATCH_STATE.INNINGS_BREAK;
	}

	// Lunch, Tea and Drinks are intra-day breaks: still live, but not a ball
	// being bowled. Innings Break is matched earlier, so the order matters.
	if (/\btea\b|lunch|drinks|session break/.test(text)) {
		return MATCH_STATE.SESSION_BREAK;
	}

	if (/toss/.test(text)) {
		return MATCH_STATE.TOSS;
	}

	if (/in progress|live|need \d+ runs? in \d+ balls?/.test(text)) {
		return MATCH_STATE.LIVE;
	}

	if (/complete|won by|drawn|no result/.test(text)) {
		return MATCH_STATE.COMPLETE;
	}

	if (/preview|upcoming|match starts|start delayed|yet to start/.test(text)) {
		return MATCH_STATE.SCHEDULED;
	}

	return raw ? MATCH_STATE.UNKNOWN : MATCH_STATE.UNKNOWN;
}

const FORMAT_ALIASES = {
	T20: 'T20',
	T20I: 'T20',
	ODI: 'ODI',
	ODM: 'ODI',
	TEST: 'TEST',
	T10: 'T10',
	SIXES: 'SIXES',
	HONG_KONG_SIXES: 'SIXES',
	THE_HUNDRED: 'THE_HUNDRED',
	HUNDRED: 'THE_HUNDRED',
	HUN: 'THE_HUNDRED',
	THE_100: 'THE_HUNDRED',
};

export function normalizeFormat(rawFormat) {
	const key = String(rawFormat || '')
		.trim()
		.toUpperCase()
		.replace(/[-\s]+/g, '_');

	return FORMAT_ALIASES[key] || 'OTHER';
}

// Upstream sometimes labels a tournament with a format it does not play: Abu
// Dhabi T10 and the Hong Kong Sixes both arrive as matchFormat "T20". The series
// name is the only hint, so it overrides T20/OTHER (never TEST/ODI/Hundred).
const SERIES_FORMAT_HINTS = [
	[/\bsixes\b/, 'SIXES'],
	[/\bt10\b/, 'T10'],
];

export function detectFormat({ matchFormat, seriesName, matchDesc } = {}) {
	const base = normalizeFormat(matchFormat);

	if (base === 'TEST' || base === 'ODI' || base === 'THE_HUNDRED') {
		return base;
	}

	const text = `${seriesName || ''} ${matchDesc || ''}`.toLowerCase();

	for (const [pattern, format] of SERIES_FORMAT_HINTS) {
		if (pattern.test(text)) {
			return format;
		}
	}

	return base;
}

// Maximum balls in a regular innings. Used to derive balls remaining for a chase.
// TEST is intentionally absent (no fixed limit, and 4th innings has no over cap).
export const FORMAT_INNINGS_BALLS = {
	T20: 120,
	ODI: 300,
	T10: 60,
	THE_HUNDRED: 100,
	SIXES: 36,
};

// Team id -> image id cache, filled from /api/home. Upstream never returns team
// image ids on the scorecard/commentary headers, so this is the only way to build
// icon URLs for those payloads.
export const ICON_CACHE_TTL_MS = 30 * 60 * 1000;
