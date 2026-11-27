import { UpstreamError, fetchCommentary, fetchHome, fetchLiveScore, fetchScorecard } from './client';
import { LIVE_STATES, MATCH_STATE, normalizeFormat, normalizeState } from './constants';
import { buildCommentary } from './commentary';
import { buildMatch } from './match';
import { CACHE, fail, matchNotFound, send } from './response';
import { buildScorecard } from './scorecard';
import { rememberTeams } from './teams';
import { safeArray, toEpochIso, toNumber } from './utils';

const STATE_FILTER_ALIASES = {
	live: [...LIVE_STATES],
	upcoming: [MATCH_STATE.SCHEDULED, MATCH_STATE.TOSS],
	completed: [MATCH_STATE.COMPLETE, MATCH_STATE.ABANDONED],
	finished: [MATCH_STATE.COMPLETE, MATCH_STATE.ABANDONED],
	delayed: [MATCH_STATE.DELAYED],
};

function homeMatches(homeJson) {
	return safeArray(homeJson?.matches)
		.map((entry) => entry?.match)
		.filter(Boolean);
}

function findHomeMatch(homeJson, matchId) {
	return homeMatches(homeJson).find((entry) => toNumber(entry?.matchInfo?.matchId) === toNumber(matchId)) || null;
}

function parseStateFilter(value) {
	if (!value) {
		return null;
	}

	const states = new Set();

	for (const token of String(value).split(',')) {
		const key = token.trim().toLowerCase();

		if (!key) {
			continue;
		}

		const aliased = STATE_FILTER_ALIASES[key];

		if (aliased) {
			aliased.forEach((state) => states.add(state));
		} else {
			states.add(key.toUpperCase());
		}
	}

	return states.size ? states : null;
}

function matchState(entry) {
	return normalizeState(entry?.state, entry?.status);
}

function applyFilters(entries, filters) {
	return entries.filter((entry) => {
		const info = entry.matchInfo || {};

		if (filters.states && !filters.states.has(matchState(info))) {
			return false;
		}

		if (filters.format && normalizeFormat(info.matchFormat) !== filters.format) {
			return false;
		}

		if (filters.seriesId && toNumber(info.seriesId) !== filters.seriesId) {
			return false;
		}

		return true;
	});
}

async function settle(promise) {
	try {
		return await promise;
	} catch {
		return null;
	}
}

async function buildListCard({ entry, enrich, baseUrl }) {
	const info = entry.matchInfo || {};
	const state = matchState(info);
	// Live data is only fetched for matches that are actually in progress; a finished
	// match is fully described by its scorecard/home scores.
	const wantsLive = enrich !== 'none' && LIVE_STATES.has(state);
	const wantsScorecard = enrich === 'full';
	const [livescoreJson, scorecardJson] = await Promise.all([
		wantsLive ? settle(fetchLiveScore(info.matchId)) : null,
		wantsScorecard ? settle(fetchScorecard(info.matchId)) : null,
	]);

	return buildMatch({
		header: scorecardJson?.matchHeader || null,
		scorecardJson,
		homeMatch: entry,
		livescoreJson,
		baseUrl,
	});
}

export async function getMatches(request) {
	const url = new URL(request.url);
	const filters = {
		states: parseStateFilter(url.searchParams.get('state')),
		format: url.searchParams.get('format') ? normalizeFormat(url.searchParams.get('format')) : null,
		seriesId: toNumber(url.searchParams.get('seriesId') ?? url.searchParams.get('series'), 0) || null,
		enrich: (url.searchParams.get('enrich') || 'live').toLowerCase(),
	};
	const homeJson = await fetchHome();

	if (!homeJson) {
		throw new UpstreamError('Cricbuzz home feed is unavailable');
	}

	rememberTeams(homeJson);

	const allEntries = homeMatches(homeJson);
	const entries = applyFilters(allEntries, filters);
	const baseUrl = url.origin;
	const matches = (await Promise.all(entries.map((entry) => buildListCard({ entry, enrich: filters.enrich, baseUrl })))).filter(Boolean);

	return send(
		{ matches },
		{
			cacheControl: CACHE.list,
			meta: {
				source: 'cricbuzz',
				count: matches.length,
				total: allEntries.length,
				lastUpdated: toEpochIso(homeJson.responseLastUpdated),
				filters: {
					state: url.searchParams.get('state'),
					format: filters.format,
					seriesId: filters.seriesId,
					enrich: filters.enrich,
				},
			},
		},
	);
}

export async function getMatch(request, matchId) {
	const url = new URL(request.url);
	const [homeJson, livescoreJson, scorecardJson] = await Promise.all([
		settle(fetchHome()),
		settle(fetchLiveScore(matchId)),
		settle(fetchScorecard(matchId)),
	]);
	const homeMatch = findHomeMatch(homeJson, matchId);
	const header = scorecardJson?.matchHeader || null;

	if (!header && !homeMatch) {
		return matchNotFound(`Match ${matchId} was not found`);
	}

	rememberTeams(homeJson);

	const state = normalizeState(
		livescoreJson?.miniscore?.matchScoreDetails?.state || header?.state || homeMatch?.match?.matchInfo?.state,
		livescoreJson?.miniscore?.status || header?.status || homeMatch?.match?.matchInfo?.status,
	);
	const commJson = state === MATCH_STATE.COMPLETE || state === MATCH_STATE.ABANDONED ? await settle(fetchCommentary(matchId)) : null;
	const match = buildMatch({
		header,
		scorecardJson,
		commHeader: commJson?.matchHeader || null,
		homeMatch,
		livescoreJson,
		baseUrl: url.origin,
	});

	return send(
		{ match },
		{
			cacheControl: CACHE.detail,
			meta: {
				source: 'cricbuzz',
				matchId: toNumber(matchId),
				lastUpdated: toEpochIso(
					livescoreJson?.miniscore?.responseLastUpdated || scorecardJson?.responseLastUpdated || homeJson?.responseLastUpdated,
				),
			},
		},
	);
}

export async function getMatchLive(request, matchId) {
	const url = new URL(request.url);
	const [livescoreJson, scorecardJson] = await Promise.all([settle(fetchLiveScore(matchId)), settle(fetchScorecard(matchId))]);

	if (!livescoreJson && !scorecardJson) {
		return matchNotFound(`Match ${matchId} was not found`);
	}

	const header = scorecardJson?.matchHeader || null;

	if (!header) {
		return matchNotFound(`Match ${matchId} was not found`);
	}

	const match = buildMatch({
		header,
		scorecardJson,
		livescoreJson,
		baseUrl: url.origin,
	});

	return send(
		{ match },
		{
			cacheControl: CACHE.live,
			meta: {
				source: 'cricbuzz',
				matchId: toNumber(matchId),
				lastUpdated: toEpochIso(livescoreJson?.miniscore?.responseLastUpdated || scorecardJson?.responseLastUpdated),
			},
		},
	);
}

export async function getMatchScorecard(request, matchId) {
	const url = new URL(request.url);
	const [homeJson, scorecardJson] = await Promise.all([settle(fetchHome()), settle(fetchScorecard(matchId))]);
	const header = scorecardJson?.matchHeader || null;

	if (!header) {
		return matchNotFound(`Scorecard for match ${matchId} was not found`);
	}

	rememberTeams(homeJson);

	const match = buildMatch({
		header,
		scorecardJson,
		homeMatch: findHomeMatch(homeJson, matchId),
		baseUrl: url.origin,
	});
	const innings = buildScorecard(scorecardJson);

	return send(
		{ match, innings },
		{
			cacheControl: CACHE.scorecard,
			meta: {
				source: 'cricbuzz',
				matchId: toNumber(matchId),
				lastUpdated: toEpochIso(scorecardJson?.responseLastUpdated),
			},
		},
	);
}

export async function getMatchCommentary(request, matchId) {
	const url = new URL(request.url);
	const [commJson, livescoreJson] = await Promise.all([settle(fetchCommentary(matchId)), settle(fetchLiveScore(matchId))]);
	let header = commJson?.matchHeader || null;
	let scorecardJson = null;

	// Upcoming matches answer 204 on the commentary endpoint; fall back to the
	// scorecard header so the response still carries the match context.
	if (!header && !livescoreJson) {
		scorecardJson = await settle(fetchScorecard(matchId));
		header = scorecardJson?.matchHeader || null;
	}

	if (!header && !livescoreJson) {
		return matchNotFound(`Commentary for match ${matchId} was not found`);
	}

	const match = header
		? buildMatch({
				header,
				scorecardJson,
				commHeader: commJson?.matchHeader || null,
				livescoreJson,
				baseUrl: url.origin,
				hasScorecard: Boolean(scorecardJson),
			})
		: null;
	const commentary = buildCommentary(commJson);

	return send(
		{ match, commentary },
		{
			cacheControl: CACHE.commentary,
			meta: {
				source: 'cricbuzz',
				matchId: toNumber(matchId),
				lastUpdated: toEpochIso(commJson?.responseLastUpdated),
			},
		},
	);
}

export function methodNotAllowed() {
	return fail('METHOD_NOT_ALLOWED', 'Only GET is supported', { status: 405 });
}
