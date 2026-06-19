const BASE_URL = 'https://www.cricbuzz.com/api';

export async function fetchMatches() {
	const response = await fetch(`${BASE_URL}/home`);

	if (!response.ok) {
		throw new Error('Failed to fetch matches');
	}

	return response.json();
}

export async function fetchMatchDetails(matchId) {
	const response = await fetch(`${BASE_URL}/mcenter/livescore/${matchId}`);

	if (!response.ok) {
		throw new Error('Failed to fetch match details');
	}

	return response.json();
}
