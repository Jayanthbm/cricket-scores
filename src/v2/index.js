import { getTeamIcon } from '../routes/teamIcon';
import { failFromError, notFound, send } from './response';
import { getMatch, getMatchCommentary, getMatchLive, getMatchScorecard, getMatches, methodNotAllowed } from './routes';

const ENDPOINTS = [
	{ method: 'GET', path: '/v2/matches', description: 'Match list cards (filters: format, state, seriesId, enrich)' },
	{ method: 'GET', path: '/v2/matches/:id', description: 'Match hub: info, toss, result, awards, innings summary, live block' },
	{ method: 'GET', path: '/v2/matches/:id/live', description: 'Poll-friendly live snapshot' },
	{ method: 'GET', path: '/v2/matches/:id/scorecard', description: 'Full scorecard with batting, bowling, extras, FOW, partnerships' },
	{ method: 'GET', path: '/v2/matches/:id/commentary', description: 'Recent ball-by-ball commentary with over summaries' },
	{ method: 'GET', path: '/v2/player-icon/:imageId/:name', description: 'Player headshot proxy' },
];

function normalizePath(pathname) {
	if (pathname.length > 1 && pathname.endsWith('/')) {
		return pathname.slice(0, -1);
	}

	return pathname;
}

export async function handleV2(request) {
	const url = new URL(request.url);
	const pathname = normalizePath(url.pathname);

	if (pathname !== '/v2' && !pathname.startsWith('/v2/')) {
		return null;
	}

	if (request.method !== 'GET') {
		return methodNotAllowed();
	}

	try {
		if (pathname === '/v2') {
			return send({ endpoints: ENDPOINTS }, { cacheControl: 'public, max-age=300' });
		}

		if (pathname === '/v2/matches') {
			return await getMatches(request);
		}

		const matchRoute = pathname.match(/^\/v2\/matches\/(\d+)(?:\/(live|scorecard|commentary))?$/);

		if (matchRoute) {
			const [, matchId, section] = matchRoute;

			if (section === 'live') {
				return await getMatchLive(request, matchId);
			}

			if (section === 'scorecard') {
				return await getMatchScorecard(request, matchId);
			}

			if (section === 'commentary') {
				return await getMatchCommentary(request, matchId);
			}

			return await getMatch(request, matchId);
		}

		const playerIconRoute = pathname.match(/^\/v2\/player-icon\/(\d+)\/([^/]+)$/);

		if (playerIconRoute) {
			return getTeamIcon(playerIconRoute[1], playerIconRoute[2]);
		}

		return notFound(`Unknown v2 route: ${pathname}`);
	} catch (error) {
		return failFromError(error);
	}
}
