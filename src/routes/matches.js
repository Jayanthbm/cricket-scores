import { fetchMatches } from '../services/cricketApi';
import { transformMatch } from '../services/cricketTransformer';
import { success } from '../utils/response';

function formatLastUpdated(timestamp) {
	return new Date(timestamp).toLocaleString('en-IN', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'Asia/Kolkata',
	});
}

export async function getMatches(request) {
	const response = await fetchMatches();

	const baseUrl = new URL(request.url).origin;

	const matches = response.matches.map((match) => transformMatch(match, baseUrl));

	return success({
		success: true,
		data: {
			matches,
			count: matches.length,
			lastUpdated: response.responseLastUpdated,
			lastUpdatedText: formatLastUpdated(response.responseLastUpdated),
		},
	});
}
