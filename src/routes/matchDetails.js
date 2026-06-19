import { fetchMatches, fetchMatchDetails } from '../services/cricketApi';

import { transformMatchDetails } from '../services/matchDetailsTransformer';

import { success } from '../utils/response';

export async function getMatchDetails(request, matchId) {
	const [details, matches] = await Promise.all([fetchMatchDetails(matchId), fetchMatches()]);

	const matchSummary = matches.matches.find((match) => match.match.matchInfo.matchId === Number(matchId));

	if (!matchSummary) {
		throw new Error(`Match ${matchId} not found`);
	}

	const baseUrl = new URL(request.url).origin;

	const transformed = transformMatchDetails(details, matchSummary, baseUrl);

	return success({
		success: true,
		data: transformed,
	});
}
