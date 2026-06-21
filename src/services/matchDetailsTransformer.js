import { buildScore, formatDate, formatOvers } from '../utils/formats';

function buildScorecard(inningsScoreList = []) {
	return inningsScoreList.map((innings) => ({
		inningsId: innings.inningsId,
		team: innings.batTeamName,
		score: `${innings.score}/${innings.wickets}`,
		overs: String(innings.overs),
	}));
}

function buildToss(scoreDetails = {}) {
	const toss = scoreDetails?.tossResults;

	if (!toss?.tossWinnerName) {
		return null;
	}

	return {
		winner: toss.tossWinnerName,
		decision: toss.decision,
	};
}

function buildLive(miniscore) {
	if (!miniscore) {
		return null;
	}

	return {
		inningsId: miniscore?.inningsId,

		battingTeam:
			miniscore?.matchScoreDetails?.matchTeamInfo?.find((x) => x.battingTeamId === miniscore?.batTeam?.teamId)?.battingTeamShortName || '',
		currentScore: `${miniscore?.batTeam?.teamScore || 0}/${miniscore?.batTeam?.teamWkts || 0}`,
		overs: formatOvers(miniscore?.overs || ''),
		runRate: miniscore?.currentRunRate || 0,
		requiredRunRate: miniscore?.requiredRunRate || 0,
		remRunsToWin: miniscore?.remRunsToWin || 0,
		oversRem: miniscore?.oversRem || 0,
		recentOvers: miniscore?.recentOvsStats || '',
		recentBalls: (miniscore?.recentOvsStats || '').split(' ').filter(Boolean),
		partnership: {
			runs: miniscore?.partnerShip?.runs || 0,
			balls: miniscore?.partnerShip?.balls || 0,
		},
		partnershipText: `${miniscore?.partnerShip?.runs || 0} (${miniscore?.partnerShip?.balls || 0})`,
		lastWicket: miniscore?.lastWicket || '',
		striker: {
			name: miniscore?.batsmanStriker?.batName || '',
			runs: miniscore?.batsmanStriker?.batRuns || 0,
			balls: miniscore?.batsmanStriker?.batBalls || 0,
			fours: miniscore?.batsmanStriker?.batFours || 0,
			sixes: miniscore?.batsmanStriker?.batSixes || 0,
			strikeRate: miniscore?.batsmanStriker?.batStrikeRate || 0,
		},

		nonStriker: {
			name: miniscore?.batsmanNonStriker?.batName || '',
			runs: miniscore?.batsmanNonStriker?.batRuns || 0,
			balls: miniscore?.batsmanNonStriker?.batBalls || 0,
			fours: miniscore?.batsmanNonStriker?.batFours || 0,
			sixes: miniscore?.batsmanNonStriker?.batSixes || 0,
			strikeRate: miniscore?.batsmanNonStriker?.batStrikeRate || 0,
		},

		bowlerStriker: {
			id: miniscore?.bowlerStriker?.bowlId || 0,
			name: miniscore?.bowlerStriker?.bowlName || '',
			overs: miniscore?.bowlerStriker?.bowlOvs || 0,
			maidens: miniscore?.bowlerStriker?.bowlMaidens || 0,
			runs: miniscore?.bowlerStriker?.bowlRuns || 0,
			wickets: miniscore?.bowlerStriker?.bowlWkts || 0,
			economy: miniscore?.bowlerStriker?.bowlEcon || 0,
		},

		bowlerNonStriker: {
			id: miniscore?.bowlerNonStriker?.bowlId || 0,
			name: miniscore?.bowlerNonStriker?.bowlName || '',
			overs: miniscore?.bowlerNonStriker?.bowlOvs || 0,
			maidens: miniscore?.bowlerNonStriker?.bowlMaidens || 0,
			runs: miniscore?.bowlerNonStriker?.bowlRuns || 0,
			wickets: miniscore?.bowlerNonStriker?.bowlWkts || 0,
			economy: miniscore?.bowlerNonStriker?.bowlEcon || 0,
		},

		matchUdrs: miniscore?.matchUdrs || null,
	};
}

export function transformMatchDetails(rawData, matchSummary, baseUrl) {
	const miniscore = rawData?.miniscore || {};

	const scoreDetails = miniscore?.matchScoreDetails || {};

	const info = matchSummary?.match?.matchInfo;

	const score = matchSummary.match.matchScore;
	const team1Score = buildScore(score?.team1Score);
	const team2Score = buildScore(score?.team2Score);

	const showMatchScore = info?.state === 'Complete' || info?.state === 'Stumps' ? true : false;
	const isLive = info?.state === 'In Progress' || info?.state === 'Innings Break' ? true : false;
	return {
		matchFormat: info.matchFormat,
		state: info.state,
		status: info.status,
		matchInfo: {
			matchId: info.matchId,
			seriesName: info.seriesName,
			matchDesc: info.matchDesc,
			matchFormat: info.matchFormat,
			venueText: `${info.venueInfo?.ground}, ${info.venueInfo?.city}`,
			startDate: info.startDate,
			startDateText: formatDate(info.startDate),
			matchType: info.matchType,
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
			toss: buildToss(scoreDetails),
		},
		live: isLive ? buildLive(miniscore) : null,
		matchScoreDetails: showMatchScore ? miniscore?.matchScoreDetails : null,
		lastUpdated: miniscore?.responseLastUpdated || Date.now(),
	};
}
