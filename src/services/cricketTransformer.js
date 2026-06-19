import { formatDate, formatOvers, getStatusType } from "../utils/formats";



function formatInnings(inngs) {
	if (!inngs) return null;
	return `${inngs.runs}/${inngs.wickets}(${formatOvers(inngs.overs)})`;
}

function buildScore(teamScore) {
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




function buildDisplayScore(team1ShortName, team2ShortName, team1Score, team2Score, statusType, shortStatus) {
	if (team1Score || team2Score) {
		return `${team1ShortName} ${team1Score} | ${team2ShortName} ${team2Score}`;
	}

	if (statusType === 'UPCOMING') {
		return shortStatus;
	}

	return null;
}

export function transformMatch(matchData, baseUrl) {
	const info = matchData.match.matchInfo;
	const score = matchData.match.matchScore;

	const statusType = getStatusType(info.state);

	const team1Score = buildScore(score?.team1Score);
	const team2Score = buildScore(score?.team2Score);

	return {
		matchId: info.matchId,
		seriesName: info.seriesName,
		matchDesc: info.matchDesc,
		matchFormat: info.matchFormat,
		statusType,
		team1: {
			id: info.team1.teamId,
			name: info.team1.teamName,
			shortName: info.team1.teamSName,
			imageId: info.team1.imageId,
			icon: `${baseUrl}/team-icon/${info.team1.imageId}/${info.team1.teamSName}`,
		},
		team2: {
			id: info.team2.teamId,
			name: info.team2.teamName,
			shortName: info.team2.teamSName,
			imageId: info.team2.imageId,
			icon: `${baseUrl}/team-icon/${info.team2.imageId}/${info.team2.teamSName}`,
		},

		score: {
			team1: team1Score,
			team2: team2Score,
		},

		displayScore: buildDisplayScore(info.team1.teamSName, info.team2.teamSName, team1Score, team2Score, statusType, info.shortStatus),

		state: info.state,
		stateTitle: info.stateTitle,

		status: info.status,
		shortStatus: info.shortStatus,

		venueText: `${info.venueInfo?.ground}, ${info.venueInfo?.city}`,

		startDate: info.startDate,
		startDateText: formatDate(info.startDate),

		matchType: info.matchType,

		sortKey: info.startDate,
	};
}
