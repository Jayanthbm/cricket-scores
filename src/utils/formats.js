export function formatInnings(inngs) {
	if (!inngs) return null;
	return `${inngs.runs}/${inngs.wickets}(${formatOvers(inngs.overs)})`;
}
export function getStatusType(state) {
	switch (state) {
		case 'In Progress':
			return 'Live';

		case 'Innings Break':
			return 'Live';

		case 'Preview':
			return 'Upcoming';

		case 'Toss':
			return 'Toss';

		case 'Complete':
			return 'Completed';

		case 'Stumps':
			return 'Stumps';

		default:
			return 'UNKNOWN';
	}
}

export function formatDate(timestamp) {
	return new Date(timestamp).toLocaleDateString('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	});
}

export function formatOvers(overs) {
	if (overs == null) return null;

	const [completedOvers, balls] = String(overs).split('.');

	const finalOvers = balls === '6' ? Number(completedOvers) + 1 : overs;

	return finalOvers;
}

export function buildScore(teamScore) {
	if (!teamScore) return '';

	const innings = [];

	if (teamScore.inngs1) {
		innings.push(formatInnings(teamScore.inngs1));
	}

	if (teamScore.inngs2) {
		innings.push(formatInnings(teamScore.inngs2));
	}

	return innings.join(' & ');
}

export function buildDisplayScore(team1ShortName, team2ShortName, team1Score, team2Score, statusType, shortStatus) {
	if (team1Score || team2Score) {
		return `${team1ShortName} ${team1Score} | ${team2ShortName} ${team2Score}`;
	}

	if (statusType === 'UPCOMING') {
		return shortStatus;
	}

	return null;
}
