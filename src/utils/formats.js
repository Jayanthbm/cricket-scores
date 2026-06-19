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