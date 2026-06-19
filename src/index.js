import { getMatches } from './routes/matches';
import { getMatchDetails } from './routes/matchDetails';
import { error, preflight } from './utils/response';
import { getTeamIcon } from './routes/teamIcon';

export default {
	async fetch(request) {
		if (request.method === 'OPTIONS') {
			return preflight();
		}

		if (request.method !== 'GET') {
			return error('Method Not Allowed', 405);
		}

		try {
			const url = new URL(request.url);

			if (url.pathname === '/matches') {
				return getMatches(request);
			}

			const matchRoute = url.pathname.match(/^\/matches\/(\d+)$/);

			if (matchRoute) {
				return getMatchDetails(request, matchRoute[1]);
			}
			const iconRoute = url.pathname.match(/^\/team-icon\/(\d+)\/([^/]+)$/);

			if (iconRoute) {
				return getTeamIcon(iconRoute[1], iconRoute[2]);
			}

			return error('Route Not Found', 404);
		} catch (err) {
			console.error(err);

			return error(err.message || 'Internal Server Error', 500);
		}
	},
};
