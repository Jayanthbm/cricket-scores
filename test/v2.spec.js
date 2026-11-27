import { describe, expect, it, vi } from 'vitest';
import { buildCommentary } from '../src/v2/commentary';
import { fetchScorecard } from '../src/v2/client';
import { MATCH_STATE, detectFormat, normalizeFormat, normalizeState } from '../src/v2/constants';
import { buildLive } from '../src/v2/live';
import { buildMatch } from '../src/v2/match';
import { buildScorecard } from '../src/v2/scorecard';
import { ballsToOvers, oversToBalls, scoreLine, toEpochIso } from '../src/v2/utils';

describe('upstream client', () => {
	it('retries once when the first attempt fails', async () => {
		const calls = [];
		vi.stubGlobal('fetch', async (url) => {
			calls.push(String(url));

			if (calls.length === 1) {
				throw new Error('socket hang up');
			}

			return new Response(JSON.stringify({ matchHeader: { state: 'Complete' } }), { status: 200 });
		});

		try {
			const payload = await fetchScorecard(161285);

			expect(payload).toEqual({ matchHeader: { state: 'Complete' } });
			expect(calls).toHaveLength(2);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('does not retry a 204', async () => {
		let calls = 0;
		vi.stubGlobal('fetch', async () => {
			calls += 1;

			return new Response(null, { status: 204 });
		});

		try {
			expect(await fetchScorecard(1)).toBe(null);
			expect(calls).toBe(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('overs helpers', () => {
	it('normalises the scorer 6-ball quirk', () => {
		expect(oversToBalls(49.6)).toBe(300);
		expect(oversToBalls(13.6)).toBe(84);
		expect(oversToBalls(41.3)).toBe(249);
		expect(oversToBalls(9)).toBe(54);
		expect(oversToBalls('97.1')).toBe(583);
		expect(oversToBalls(null)).toBe(null);
	});

	it('formats balls back to overs without a trailing .6', () => {
		expect(ballsToOvers(300)).toBe('50');
		expect(ballsToOvers(84)).toBe('14');
		expect(ballsToOvers(249)).toBe('41.3');
		expect(ballsToOvers(0)).toBe('0');
	});

	it('builds a display score from raw pieces', () => {
		const score = scoreLine({ runs: 318, wickets: 2, overs: '41.3', runRate: 7.66 });

		expect(score).toMatchObject({ runs: 318, wickets: 2, overs: '41.3', balls: 249, display: '318/2 (41.3)', displayShort: '318/2' });
	});

	it('keeps a rain revision but treats the 0 placeholder as no revision', () => {
		expect(scoreLine({ runs: 16, wickets: 3, balls: 24, revisedOvers: 13 }).revisedOvers).toBe(13);
		expect(scoreLine({ runs: 16, wickets: 3, balls: 24, revisedOvers: 0 }).revisedOvers).toBe(null);
		expect(scoreLine({ runs: 16, wickets: 3, balls: 24 }).revisedOvers).toBe(null);
	});
});

describe('timestamp normalisation', () => {
	it('accepts both seconds and milliseconds', () => {
		expect(toEpochIso(1795716947)).toBe('2026-11-26T18:15:47.000Z');
		expect(toEpochIso(1795716947000)).toBe('2026-11-26T18:15:47.000Z');
		expect(toEpochIso(null)).toBe(null);
	});
});

describe('state normalisation', () => {
	it('maps the raw states we have captured', () => {
		expect(normalizeState('Preview')).toBe(MATCH_STATE.SCHEDULED);
		expect(normalizeState('Upcoming')).toBe(MATCH_STATE.SCHEDULED);
		expect(normalizeState('Toss')).toBe(MATCH_STATE.TOSS);
		expect(normalizeState('In Progress')).toBe(MATCH_STATE.LIVE);
		expect(normalizeState('Innings Break')).toBe(MATCH_STATE.INNINGS_BREAK);
		expect(normalizeState('Stumps')).toBe(MATCH_STATE.STUMPS);
		expect(normalizeState('Complete')).toBe(MATCH_STATE.COMPLETE);
	});

	it('treats lunch, tea and drinks as session breaks', () => {
		expect(normalizeState('Tea')).toBe(MATCH_STATE.SESSION_BREAK);
		expect(normalizeState('Day 1: Tea Break')).toBe(MATCH_STATE.SESSION_BREAK);
		expect(normalizeState('Lunch')).toBe(MATCH_STATE.SESSION_BREAK);
		expect(normalizeState('Drinks')).toBe(MATCH_STATE.SESSION_BREAK);
		expect(normalizeState('', 'Day 2: Lunch - India 210/4')).toBe(MATCH_STATE.SESSION_BREAK);
		expect(normalizeState('Abandon')).toBe(MATCH_STATE.ABANDONED);
	});

	it('completes the match once the result is announced, ahead of the raw state', () => {
		// 162951: rawState "In Progress", status already decided
		expect(normalizeState('In Progress', 'Perth Scorchers Women won by 17 runs')).toBe(MATCH_STATE.COMPLETE);
		expect(normalizeState('In Progress', 'India win by 5 wickets')).toBe(MATCH_STATE.COMPLETE);
		// a chase line, a "to win by" target and a toss sentence are not results
		expect(normalizeState('In Progress', 'Hobart Hurricanes Women need 27 runs in 5 balls')).toBe(MATCH_STATE.LIVE);
		expect(normalizeState('In Progress', 'India need 20 runs to win by 4 wickets')).toBe(MATCH_STATE.LIVE);
		expect(normalizeState('Toss', 'Perth Scorchers Women won the toss and opt to bat')).toBe(MATCH_STATE.TOSS);
	});

	it('falls back to status keywords', () => {
		expect(normalizeState('', 'Match abandoned due to rain')).toBe(MATCH_STATE.ABANDONED);
		expect(normalizeState('', 'Rain delay')).toBe(MATCH_STATE.DELAYED);
		expect(normalizeState('', 'Day 3: Stumps - lead by 6 runs')).toBe(MATCH_STATE.STUMPS);
		expect(normalizeState('', 'India need 51 runs in 66 balls')).toBe(MATCH_STATE.LIVE);
		expect(normalizeState('', 'Sri Lanka A won by 8 wkts')).toBe(MATCH_STATE.COMPLETE);
		expect(normalizeState('', 'Match starts at Nov 27, 14:30 GMT')).toBe(MATCH_STATE.SCHEDULED);
		expect(normalizeState('Something new')).toBe(MATCH_STATE.UNKNOWN);
	});

	it('normalises formats', () => {
		expect(normalizeFormat('T20')).toBe('T20');
		expect(normalizeFormat('t20i')).toBe('T20');
		expect(normalizeFormat('ODM')).toBe('ODI');
		expect(normalizeFormat('Test')).toBe('TEST');
		expect(normalizeFormat('THE 100')).toBe('THE_HUNDRED');
		expect(normalizeFormat('HUN')).toBe('THE_HUNDRED');
		expect(normalizeFormat('List A')).toBe('OTHER');
	});

	it('trusts the series name when upstream mislabels the format', () => {
		expect(detectFormat({ matchFormat: 'T20', seriesName: 'Abu Dhabi T10 2026' })).toBe('T10');
		expect(detectFormat({ matchFormat: 'T20', seriesName: 'Hong Kong Sixes 2026', matchDesc: 'Group A' })).toBe('SIXES');
		expect(detectFormat({ matchFormat: 'HUN', seriesName: "The Hundred Men's Competition 2026" })).toBe('THE_HUNDRED');
		expect(detectFormat({ matchFormat: 'TEST', seriesName: 'Something T10 Sixes' })).toBe('TEST');
		expect(detectFormat({ matchFormat: 'T20', seriesName: 'IPL 2026' })).toBe('T20');
	});
});

describe('non standard formats', () => {
	it('keeps the Hundred set.ball overs label next to the real ball count', () => {
		const score = scoreLine({ runs: 138, wickets: 4, overs: 9.8, balls: 98, format: 'THE_HUNDRED' });

		expect(score).toMatchObject({ runs: 138, wickets: 4, overs: '9.8', balls: 98, display: '138/4 (9.8)' });

		const fromBalls = scoreLine({ runs: 135, wickets: 7, balls: 100, format: 'THE_HUNDRED' });

		expect(fromBalls).toMatchObject({ overs: '10', balls: 100 });
	});

	it('derives the Hundred chase maths from a ball count', () => {
		const live = buildLive({
			livescoreJson: livescoreFixture({ overs: 98, target: 136, remRunsToWin: 3, requiredRunRate: 9 }),
			scorecardJson: { scoreCard: [] },
			format: 'THE_HUNDRED',
		});

		expect(live.score).toMatchObject({ overs: '9.8', balls: 98 });
		expect(live.target).toMatchObject({ runs: 136, ballsRemaining: 2 });
	});

	it('labels a Hundred scorecard innings with its set.ball overs', () => {
		const card = buildScorecard({
			matchHeader: { matchFormat: 'HUN', seriesName: "The Hundred Men's Competition 2026" },
			scoreCard: [
				{
					inningsId: 1,
					batTeamDetails: { batTeamId: 606, batTeamName: 'Welsh Fire', batTeamShortName: 'WEF' },
					bowlTeamDetails: { bowlTeamId: 605, bowlTeamName: 'Oval Invincibles', bowlTeamShortName: 'OVI' },
					scoreDetails: { runs: 135, wickets: 7, overs: 10, ballNbr: 100, runRate: 1.35 },
					earliestBatting: 0,
				},
				{
					inningsId: 2,
					batTeamDetails: { batTeamId: 605, batTeamName: 'Oval Invincibles', batTeamShortName: 'OVI' },
					bowlTeamDetails: { bowlTeamId: 606, bowlTeamName: 'Welsh Fire', batTeamShortName: 'WEF' },
					scoreDetails: { runs: 138, wickets: 4, overs: 9.8, ballNbr: 98, runRate: 1.41 },
				},
			],
		});

		expect(card.map((innings) => innings.score.display)).toEqual(['135/7 (10)', '138/4 (9.8)']);
		expect(card[1].score.balls).toBe(98);
	});

	it('marks a follow-on innings', () => {
		const card = buildScorecard({
			matchHeader: { matchFormat: 'TEST' },
			scoreCard: [
				{
					inningsId: 3,
					batTeamDetails: { batTeamId: 4, batTeamName: 'Australia', batTeamShortName: 'AUS' },
					bowlTeamDetails: { bowlTeamId: 11, bowlTeamName: 'South Africa', bowlTeamShortName: 'RSA' },
					scoreDetails: { runs: 295, wickets: 10, overs: 107.1, ballNbr: 643, isDeclared: false, isFollowOn: true },
				},
			],
		});

		expect(card[0].score).toMatchObject({ followOn: true, display: '295/10 (107.1)' });
		expect(card[0].isFollowOn).toBe(true);
	});
});

function livescoreFixture(overrides = {}) {
	return {
		miniscore: {
			inningsId: 2,
			batTeam: { teamId: 2, teamScore: 54, teamWkts: 8 },
			status: 'Team B need 51 runs in 66 balls',
			batsmanStriker: { id: 11, name: 'Striker', runs: 3, balls: 1, fours: 0, sixes: 0, strikeRate: '300.00' },
			batsmanNonStriker: { id: 12, name: 'Non Striker', runs: 0, balls: 2, fours: 0, sixes: 0, strikeRate: '0.00' },
			bowlerStriker: { id: 21, name: 'Bowler', overs: 2, maidens: 0, runs: 10, wickets: 0, economy: 5 },
			bowlerNonStriker: { id: 22, name: 'Other Bowler', overs: 1, maidens: 0, runs: 8, wickets: 2, economy: 8 },
			overs: 9,
			target: 105,
			partnerShip: { runs: 1, balls: 1 },
			currentRunRate: 6,
			requiredRunRate: 4.64,
			requiredRunsPerBall: 0,
			remRunsToWin: 51,
			lastWicket: '',
			recentOvsStats: '4 0 W 3 W N 0',
			event: 'over-break',
			responseLastUpdated: 1795716681128,
			matchScoreDetails: {
				state: 'In Progress',
				matchFormat: 'T20',
				inningsScoreList: [
					{ inningsId: 1, batTeamId: 1, score: 104, wickets: 7, overs: 9 },
					{ inningsId: 2, batTeamId: 2, score: 54, wickets: 8, overs: 9 },
				],
			},
			...overrides,
		},
	};
}

function scorecardFixture() {
	return {
		matchHeader: {
			matchId: 1,
			matchFormat: 'T20',
			state: 'In Progress',
			status: 'Team B need 51 runs in 66 balls',
			team1: { id: 1, name: 'Team A', shortName: 'A' },
			team2: { id: 2, name: 'Team B', shortName: 'B' },
		},
		scoreCard: [
			{
				inningsId: 2,
				batTeamDetails: {
					batTeamId: 2,
					batTeamName: 'Team B',
					batTeamShortName: 'B',
					batsmenData: {
						bat_8: { batId: 14, batName: 'Eight', runs: 3, balls: 9, outDesc: 'c Fielder b Bowler' },
					},
				},
				bowlTeamDetails: { bowlTeamId: 1, bowlTeamName: 'Team A', bowlTeamShortName: 'A' },
				scoreDetails: { runs: 54, wickets: 8, overs: 9, ballNbr: 54, runRate: 6, revisedOvers: 0 },
				batsmenData: {},
				bowlersData: {},
				extrasData: {},
				ppData: {},
				wicketsData: {
					wkt_7: { batId: 13, batName: 'Seven', wktOver: 8.2, wktRuns: 50, ballNbr: 50, wktNbr: 7 },
					wkt_8: { batId: 14, batName: 'Eight', wktOver: 8.5, wktRuns: 53, ballNbr: 53, wktNbr: 8 },
				},
				partnershipsData: {},
			},
		],
	};
}

describe('match assembly', () => {
	it('exposes win probability and odds outside the live block', () => {
		const card = scorecardFixture();
		card.matchHeader.state = 'Toss';
		card.matchHeader.status = 'Team B opt to bowl';
		card.winProbability = {
			team1: { id: 1, percent: 46, name: 'Team A', shortName: 'A', color: '#DF9916|#F6B53C' },
			team2: { id: 2, percent: 54, name: 'Team B', shortName: 'B', color: '#DC3838|#DC3838' },
			drawTiePercent: 0,
			lastUpdatedOver: 0,
			odds: { team1_point: 2.1, team2_point: 1.8, draw_point: 10.6 },
		};

		const match = buildMatch({
			header: card.matchHeader,
			scorecardJson: { scoreCard: [], winProbability: card.winProbability },
			baseUrl: 'http://example.com',
		});

		expect(match.state).toBe(MATCH_STATE.TOSS);
		expect(match.live).toBe(null);
		expect(match.winProbability).toMatchObject({
			team1: { percent: 46, shortName: 'A', colors: ['#DF9916', '#F6B53C'] },
			team2: { percent: 54 },
			updatedOver: 0,
			odds: { team1: 2.1, team2: 1.8, draw: 10.6 },
		});
	});

	it('drops the live block for a finished match but keeps result and scores', () => {
		const finished = livescoreFixture();
		finished.miniscore.matchScoreDetails.state = 'Complete';
		finished.miniscore.status = 'Team A won by 50 runs';

		const match = buildMatch({
			header: {
				matchId: 1,
				matchFormat: 'T20',
				state: 'Complete',
				status: 'Team A won by 50 runs',
				team1: { id: 1, name: 'Team A', shortName: 'A' },
				team2: { id: 2, name: 'Team B', shortName: 'B' },
			},
			livescoreJson: finished,
			scorecardJson: scorecardFixture(),
			baseUrl: 'http://example.com',
		});

		expect(match.state).toBe(MATCH_STATE.COMPLETE);
		expect(match.isComplete).toBe(true);
		expect(match.live).toBe(null);
		expect(match.result).toMatchObject({ type: 'WIN', winnerTeamId: 1, margin: { value: 50, unit: 'RUNS' } });
		// the fixture only carries the chase innings, so team A has no score
		expect(match.teams[1].score).toBe('54/8');
	});

	it('replaces a stale toss status with the score line once a ball is bowled', () => {
		const live = livescoreFixture({
			inningsId: 1,
			status: 'Zimbabwe A opt to bowl',
			batTeam: { teamId: 2, teamScore: 24, teamWkts: 0 },
			overs: 3.5,
			target: 0,
			remRunsToWin: 0,
			requiredRunRate: 0,
		});
		const match = buildMatch({
			header: {
				matchId: 4,
				matchFormat: 'ODI',
				state: 'In Progress',
				status: 'Zimbabwe A opt to bowl',
				team1: { id: 1, name: 'Zimbabwe A', shortName: 'ZIMA' },
				team2: { id: 2, name: 'Ireland A', shortName: 'IREA' },
			},
			livescoreJson: live,
			scorecardJson: { scoreCard: [] },
			baseUrl: 'http://example.com',
		});

		expect(match.state).toBe(MATCH_STATE.LIVE);
		expect(match.status).toBe('Ireland A 24/0 (3.5)');
		expect(match.shortStatus).toBe('IREA 24/0 (3.5)');
	});

	it('replaces a stale rain shortStatus once play resumes', () => {
		const live = livescoreFixture({
			batTeam: { teamId: 9, teamScore: 46, teamWkts: 1 },
			overs: 4,
			target: 109,
			remRunsToWin: 63,
			matchScoreDetails: {
				state: 'In Progress',
				matchFormat: 'T20',
				inningsScoreList: [
					{ inningsId: 1, batTeamId: 4, score: 108, wickets: 10, overs: 16.5 },
					{ inningsId: 2, batTeamId: 9, score: 46, wickets: 1, overs: 4 },
				],
			},
		});
		const match = buildMatch({
			header: {
				matchId: 9,
				matchFormat: 'T20',
				state: 'In Progress',
				status: 'England need 63 runs',
				team1: { id: 4, name: 'Australia', shortName: 'AUS' },
				team2: { id: 9, name: 'England', shortName: 'ENG' },
				shortStatus: 'Rain',
			},
			livescoreJson: live,
			scorecardJson: { scoreCard: [] },
			baseUrl: 'http://example.com',
		});

		expect(match.state).toBe(MATCH_STATE.LIVE);
		expect(match.shortStatus).toBe('ENG 46/1 (4)');
	});

	it('replaces a chase sentence that goes stale within a ball', () => {
		const live = livescoreFixture({
			batTeam: { teamId: 9, teamScore: 57, teamWkts: 3 },
			overs: 6.3,
			target: 98,
			remRunsToWin: 41,
			matchScoreDetails: {
				state: 'In Progress',
				matchFormat: 'T20',
				inningsScoreList: [
					{ inningsId: 1, batTeamId: 4, score: 108, wickets: 10, overs: 16.5 },
					{ inningsId: 2, batTeamId: 9, score: 57, wickets: 3, overs: 6.3, revisedOvers: 17 },
				],
			},
		});
		const match = buildMatch({
			header: {
				matchId: 10,
				matchFormat: 'T20',
				state: 'In Progress',
				status: 'England need 40 runs in 62 balls - DLS Target 98',
				team1: { id: 4, name: 'Australia', shortName: 'AUS' },
				team2: { id: 9, name: 'England', shortName: 'ENG' },
				shortStatus: 'England need 45 runs in 64 balls',
			},
			livescoreJson: live,
			scorecardJson: { scoreCard: [] },
			baseUrl: 'http://example.com',
		});

		expect(match.shortStatus).toBe('ENG 57/3 (6.3)');
	});

	it('replaces the "Need N to win" chase label with the score line', () => {
		const live = livescoreFixture({
			batTeam: { teamId: 357, teamScore: 5, teamWkts: 0 },
			overs: 0.4,
			target: 168,
			remRunsToWin: 163,
			matchScoreDetails: {
				state: 'In Progress',
				matchFormat: 'T20',
				inningsScoreList: [
					{ inningsId: 1, batTeamId: 360, score: 167, wickets: 6, overs: 20 },
					{ inningsId: 2, batTeamId: 357, score: 5, wickets: 0, overs: 0.4 },
				],
			},
		});
		const match = buildMatch({
			header: {
				matchId: 14,
				matchFormat: 'T20',
				state: 'In Progress',
				status: 'Hobart Hurricanes Women need 163 runs',
				team1: { id: 360, name: 'Perth Scorchers Women', shortName: 'PRSW' },
				team2: { id: 357, name: 'Hobart Hurricanes Women', shortName: 'HBHW' },
				shortStatus: 'Need 164 to win',
			},
			livescoreJson: live,
			scorecardJson: { scoreCard: [] },
			baseUrl: 'http://example.com',
		});

		expect(match.shortStatus).toBe('HBHW 5/0 (0.4)');
	});

	it('derives a limited-overs target when the miniscore has not sent one yet', () => {
		const live = livescoreFixture({
			batTeam: { teamId: 40, teamScore: 0, teamWkts: 0 },
			overs: 0,
			target: 0,
			remRunsToWin: 0,
			requiredRunRate: 0,
			matchScoreDetails: {
				state: 'In Progress',
				matchFormat: 'ODI',
				inningsScoreList: [{ inningsId: 2, batTeamId: 40, score: 0, wickets: 0, overs: 0 }],
			},
		});
		const match = buildMatch({
			header: {
				matchId: 15,
				matchFormat: 'ODI',
				state: 'In Progress',
				status: 'Zimbabwe A need 279 runs',
				team1: { id: 39, name: 'Ireland A', shortName: 'IREA' },
				team2: { id: 40, name: 'Zimbabwe A', shortName: 'ZIMA' },
			},
			livescoreJson: live,
			scorecardJson: {
				scoreCard: [
					{
						inningsId: 1,
						batTeamDetails: { batTeamId: 39, batTeamName: 'Ireland A', batTeamShortName: 'IREA' },
						scoreDetails: { runs: 278, wickets: 9, overs: 50 },
					},
				],
			},
			baseUrl: 'http://example.com',
		});

		expect(match.live.target).toEqual(expect.objectContaining({ runs: 279, runsNeeded: 279, ballsRemaining: 300, requiredRunRate: 5.58 }));
	});

	it('replaces a chase shortStatus once the match is finished', () => {
		const match = buildMatch({
			header: {
				matchId: 11,
				matchFormat: 'T20',
				state: 'Complete',
				status: 'England won by 7 wkts',
				team1: { id: 4, name: 'Australia', shortName: 'AUS' },
				team2: { id: 9, name: 'England', shortName: 'ENG' },
				shortStatus: 'England need 7 runs in 50 balls',
				result: { resultType: 'win', winningTeam: 'England', winningteamId: 9, winningMargin: 7, winByRuns: false },
			},
			livescoreJson: null,
			scorecardJson: { matchHeader: { state: 'Complete' }, scoreCard: [] },
			baseUrl: 'http://example.com',
		});

		expect(match.isComplete).toBe(true);
		expect(match.shortStatus).toBe('ENG won');
	});

	it('replaces a "Need N off Nb" label once the match is finished', () => {
		const match = buildMatch({
			header: {
				matchId: 14,
				matchFormat: 'ODI',
				state: 'Complete',
				status: 'Pakistan A won by 5 wkts',
				team1: { id: 288, name: 'Bangladesh A', shortName: 'BANA' },
				team2: { id: 325, name: 'Pakistan A', shortName: 'PAKA' },
				shortStatus: 'Need 1 off 29b',
			},
			livescoreJson: null,
			scorecardJson: {
				matchHeader: { state: 'Complete' },
				scoreCard: [
					{
						inningsId: 1,
						batTeamDetails: { batTeamId: 288, batTeamName: 'Bangladesh A', batTeamShortName: 'BANA' },
						scoreDetails: { runs: 232, wickets: 8, overs: 50 },
					},
					{
						inningsId: 2,
						batTeamDetails: { batTeamId: 325, batTeamName: 'Pakistan A', batTeamShortName: 'PAKA' },
						scoreDetails: { runs: 233, wickets: 5, overs: 45.2 },
					},
				],
			},
			baseUrl: 'http://example.com',
		});

		expect(match.shortStatus).toBe('PAKA won');
	});

	it('ignores the toss shortStatus at an innings break', () => {
		const match = buildMatch({
			header: {
				matchId: 13,
				matchFormat: 'T20',
				state: 'Innings Break',
				status: 'Innings Break',
				shortStatus: 'HBHW opt to bowl',
				team1: { id: 360, name: 'Perth Scorchers Women', shortName: 'PRSW' },
				team2: { id: 357, name: 'Hobart Hurricanes Women', shortName: 'HBHW' },
			},
			livescoreJson: { miniscore: { inningsId: 1 } },
			scorecardJson: {
				matchHeader: { state: 'Innings Break' },
				scoreCard: [
					{
						inningsId: 1,
						batTeamDetails: { batTeamId: 360, batTeamName: 'Perth Scorchers Women', batTeamShortName: 'PRSW' },
						scoreDetails: { runs: 167, wickets: 6, overs: 20 },
					},
				],
			},
			baseUrl: 'http://example.com',
		});

		expect(match.shortStatus).toBe('PRSW 167/6 (20)');
	});

	it('merges POM summaries from the comm header with the team from the scorecard', () => {
		const match = buildMatch({
			header: {
				matchId: 12,
				matchFormat: 'T20',
				state: 'Complete',
				status: 'England won by 7 wkts',
				team1: { id: 4, name: 'Australia', shortName: 'AUS' },
				team2: { id: 9, name: 'England', shortName: 'ENG' },
				playersOfTheMatch: [{ id: 8512, name: 'Jamie Overton', teamId: 0, teamName: 'England', faceImageId: 848546 }],
			},
			livescoreJson: null,
			scorecardJson: { matchHeader: { state: 'Complete' }, scoreCard: [] },
			commHeader: {
				playersOfTheMatch: [{ id: 8512, name: 'Jamie Overton', battingSummary: '', bowlingSummary: '5-12' }],
			},
			baseUrl: 'http://example.com',
		});

		expect(match.playerOfMatch).toEqual([
			expect.objectContaining({
				id: 8512,
				name: 'Jamie Overton',
				teamId: null,
				teamName: 'England',
				batting: null,
				bowling: '5-12',
				faceImageUrl: 'http://example.com/v2/player-icon/848546/jamie-overton',
			}),
		]);
	});

	it('drops a POM team name that belongs to neither side', () => {
		const match = buildMatch({
			header: {
				matchId: 13,
				matchFormat: 'T20',
				state: 'Complete',
				status: 'Perth Scorchers Women won by 17 runs',
				team1: { id: 360, name: 'Perth Scorchers Women', shortName: 'PRSW' },
				team2: { id: 357, name: 'Hobart Hurricanes Women', shortName: 'HBHW' },
				playersOfTheMatch: [{ id: 24937, name: 'Freya Kemp', teamId: 0, teamName: 'New Zealand Women', faceImageId: 1005618 }],
			},
			livescoreJson: null,
			scorecardJson: { matchHeader: { state: 'Complete' }, scoreCard: [] },
			commHeader: {
				playersOfTheMatch: [{ id: 24937, name: 'Freya Kemp', battingSummary: '58(38)', bowlingSummary: '' }],
			},
			baseUrl: 'http://example.com',
		});

		expect(match.playerOfMatch).toEqual([
			expect.objectContaining({
				id: 24937,
				teamId: null,
				teamName: null,
				batting: '58(38)',
				bowling: null,
			}),
		]);
	});

	it('keeps the national side of an A team in an award', () => {
		const match = buildMatch({
			header: {
				matchId: 15,
				matchFormat: 'ODI',
				state: 'Complete',
				status: 'Pakistan A won by 5 wkts',
				team1: { id: 288, name: 'Bangladesh A', shortName: 'BANA' },
				team2: { id: 325, name: 'Pakistan A', shortName: 'PAKA' },
				playersOfTheMatch: [{ id: 41113, name: 'Hasan Nawaz', teamId: 0, teamName: 'Pakistan' }],
			},
			livescoreJson: null,
			scorecardJson: { matchHeader: { state: 'Complete' }, scoreCard: [] },
			baseUrl: 'http://example.com',
		});

		expect(match.playerOfMatch[0]).toEqual(expect.objectContaining({ name: 'Hasan Nawaz', teamId: null, teamName: 'Pakistan' }));
	});

	it('keeps the toss status before the first ball', () => {
		const live = livescoreFixture({
			inningsId: 1,
			status: 'Zimbabwe A opt to bowl',
			batTeam: { teamId: 2, teamScore: 0, teamWkts: 0 },
			overs: 0,
			target: 0,
			remRunsToWin: 0,
			requiredRunRate: 0,
		});
		const match = buildMatch({
			header: {
				matchId: 5,
				matchFormat: 'ODI',
				state: 'In Progress',
				status: 'Zimbabwe A opt to bowl',
				team1: { id: 1, name: 'Zimbabwe A', shortName: 'ZIMA' },
				team2: { id: 2, name: 'Ireland A', shortName: 'IREA' },
			},
			livescoreJson: live,
			scorecardJson: { scoreCard: [] },
			baseUrl: 'http://example.com',
		});

		expect(match.status).toBe('Zimbabwe A opt to bowl');
	});

	it('nulls the winner fields for a drawn Test', () => {
		const match = buildMatch({
			header: {
				matchId: 2,
				matchFormat: 'TEST',
				state: 'Complete',
				status: 'Match drawn',
				result: { resultType: 'draw', winningTeam: '', winByRuns: false, winByInnings: false },
				team1: { id: 1, name: 'Queensland', shortName: 'QL' },
				team2: { id: 2, name: 'Victoria', shortName: 'VIC' },
			},
			scorecardJson: { scoreCard: [] },
			baseUrl: 'http://example.com',
		});

		expect(match.result).toEqual({
			type: 'DRAW',
			text: 'Match drawn',
			winnerTeamId: null,
			winnerTeamName: null,
			winnerTeamShortName: null,
			margin: null,
		});
		expect(match.live).toBe(null);
		expect(match.shortStatus).toBe('Match drawn');
	});

	it('keeps a no result as COMPLETE with a NO_RESULT result', () => {
		const match = buildMatch({
			header: {
				matchId: 3,
				matchFormat: 'T20',
				state: 'Complete',
				status: 'No result due to rain',
				result: { resultType: 'no result', winningTeam: '', winByRuns: false, winByInnings: false },
				team1: { id: 1, name: 'Bermuda', shortName: 'BER' },
				team2: { id: 2, name: 'Bahamas', shortName: 'BHM' },
			},
			scorecardJson: { scoreCard: [] },
			baseUrl: 'http://example.com',
		});

		expect(match.state).toBe(MATCH_STATE.COMPLETE);
		expect(match.result).toEqual({
			type: 'NO_RESULT',
			text: 'No result due to rain',
			winnerTeamId: null,
			winnerTeamName: null,
			winnerTeamShortName: null,
			margin: null,
		});
		expect(match.live).toBe(null);
	});

	it('stops flagging a batting side during an innings break', () => {
		const match = buildMatch({
			header: {
				matchId: 4,
				matchFormat: 'TEST',
				state: 'Innings Break',
				status: 'Day 4: Innings Break - South Australia lead by 147 runs',
				team1: { id: 1, name: 'South Australia', shortName: 'SAUS' },
				team2: { id: 2, name: 'Victoria', shortName: 'VIC' },
			},
			livescoreJson: livescoreFixture({
				status: 'Day 4: Innings Break - South Australia lead by 147 runs',
				matchScoreDetails: { state: 'Innings Break', matchFormat: 'TEST', inningsScoreList: [] },
			}),
			baseUrl: 'http://example.com',
		});

		expect(match.state).toBe(MATCH_STATE.INNINGS_BREAK);
		expect(match.isComplete).toBe(false);
		expect(match.teams.map((team) => team.isBatting)).toEqual([false, false]);
		expect(match.live.score.runs).toBe(54);
	});
});

describe('live block', () => {
	it('derives target, required rate and balls remaining', () => {
		const live = buildLive({ livescoreJson: livescoreFixture(), scorecardJson: scorecardFixture() });

		expect(live.score).toMatchObject({ runs: 54, wickets: 8, overs: '9', balls: 54 });
		expect(live.target).toMatchObject({ runs: 105, runsNeeded: 51, ballsRemaining: 66, requiredRunRate: 4.64, requiredRunsPerBall: null });
		expect(live.partnership).toMatchObject({ runs: 1, balls: 1 });
		expect(live.batsmen.striker.name).toBe('Striker');
		expect(live.bowlers.striker.wides).toBe(null);
	});

	it('falls back to the last fall of wicket and flags whether it is current', () => {
		const live = buildLive({ livescoreJson: livescoreFixture(), scorecardJson: scorecardFixture() });

		expect(live.lastWicket).toMatchObject({
			batter: 'Eight',
			score: '53/8',
			source: 'FALL_OF_WICKETS',
			wicketNumber: 8,
			isLatest: true,
			dismissal: 'c Fielder b Bowler',
			runs: 3,
			balls: 9,
		});
	});

	it('derives runs needed for a Test chase that sends 0', () => {
		const ls = livescoreFixture({
			remRunsToWin: 0,
			target: 148,
			requiredRunRate: 0,
			batTeam: { teamId: 2, teamScore: 17, teamWkts: 3 },
			overs: 8,
		});
		ls.miniscore.matchScoreDetails.matchFormat = 'TEST';

		const live = buildLive({ livescoreJson: ls, scorecardJson: scorecardFixture() });

		expect(live.target).toMatchObject({ runs: 148, runsNeeded: 131, ballsRemaining: null, requiredRunRate: null });
		expect(live.score).toMatchObject({ runs: 17, wickets: 3, overs: '8' });
	});

	it('ignores a remRunsToWin that lags a DLS revision', () => {
		// 151352 sent target 98, score 53 and remRunsToWin 57: the target had been
		// revised but the remaining-runs field was still computed off 109.
		const ls = livescoreFixture({
			remRunsToWin: 57,
			target: 98,
			requiredRunRate: 4.22,
			batTeam: { teamId: 9, teamScore: 53, teamWkts: 3 },
			overs: 6.2,
		});

		const live = buildLive({ livescoreJson: ls, scorecardJson: scorecardFixture() });

		expect(live.target).toMatchObject({ runs: 98, runsNeeded: 45 });
	});

	it('uses the revised overs as the innings limit', () => {
		const card = scorecardFixture();
		card.scoreCard[0].scoreDetails.revisedOvers = 13;

		const live = buildLive({ livescoreJson: livescoreFixture({ requiredRunRate: 0 }), scorecardJson: card });

		expect(live.score.revisedOvers).toBe(13);
		expect(live.target).toMatchObject({ runs: 105, runsNeeded: 51, ballsRemaining: 24, requiredRunRate: 12.75 });
	});

	it('drops the chase target once the match is finished', () => {
		const finished = livescoreFixture({ state: undefined });
		finished.miniscore.matchScoreDetails.state = 'Complete';
		finished.miniscore.status = 'Team A won by 50 runs';

		const live = buildLive({ livescoreJson: finished, scorecardJson: scorecardFixture() });

		expect(live.target).toBe(null);
	});

	it('reports the match innings and the team innings for a Test', () => {
		const testScorecard = {
			scoreCard: [
				{
					inningsId: 1,
					batTeamDetails: { batTeamId: 1, batTeamName: 'South Australia', batTeamShortName: 'SAUS' },
					bowlTeamDetails: { bowlTeamId: 2, bowlTeamName: 'Victoria', bowlTeamShortName: 'VIC' },
				},
				{
					inningsId: 2,
					batTeamDetails: { batTeamId: 2, batTeamName: 'Victoria', batTeamShortName: 'VIC' },
					bowlTeamDetails: { bowlTeamId: 1, bowlTeamName: 'South Australia', bowlTeamShortName: 'SAUS' },
				},
				{
					inningsId: 3,
					batTeamDetails: { batTeamId: 1, batTeamName: 'South Australia', batTeamShortName: 'SAUS' },
					bowlTeamDetails: { bowlTeamId: 2, bowlTeamName: 'Victoria', bowlTeamShortName: 'VIC' },
				},
			],
		};
		const testLivescore = {
			miniscore: {
				inningsId: 3,
				batTeam: { teamId: 1, teamScore: 236, teamWkts: 6 },
				overs: 84,
				status: 'Day 4: 2nd Session - South Australia lead by 106 runs',
				matchScoreDetails: { state: 'In Progress', matchFormat: 'TEST', inningsScoreList: [] },
			},
		};

		const live = buildLive({ livescoreJson: testLivescore, scorecardJson: testScorecard });

		expect(live.test).toMatchObject({ day: 4, inningsNumber: 3, teamInningsNumber: 2, leadRuns: 106, trailRuns: null, target: null });
		expect(live.score).toMatchObject({ runs: 236, wickets: 6, overs: '84' });
	});

	it('parses the livescore last wicket text', () => {
		const data = livescoreFixture();
		data.miniscore.lastWicket = 'S BalaKrishna   b Ratnesh Singh 15(14)  - 53/8 in 8.5 ov.';

		const live = buildLive({ livescoreJson: data, scorecardJson: scorecardFixture() });

		expect(live.lastWicket).toMatchObject({
			batter: 'S BalaKrishna',
			dismissal: 'b Ratnesh Singh',
			runs: 15,
			balls: 14,
			score: '53/8',
			overs: '8.5',
			wicketNumber: 8,
			isLatest: true,
			source: 'LIVESCORE',
		});
	});
});

describe('scorecard', () => {
	it('classifies dismissals, keeps DNB out of the batting table and reads extras', () => {
		const json = {
			matchHeader: { matchId: 1, matchFormat: 'T20' },
			scoreCard: [
				{
					inningsId: 1,
					batTeamDetails: {
						batTeamId: 1,
						batTeamName: 'Team A',
						batTeamShortName: 'A',
						batsmenData: {
							bat_1: {
								batId: 1,
								batName: 'Out Batter',
								runs: 10,
								balls: 10,
								fours: 1,
								sixes: 0,
								outDesc: 'c Fielder b Bowler',
								wicketCode: 'CAUGHT',
							},
							bat_2: { batId: 2, batName: 'Not Out Batter', runs: 5, balls: 3, outDesc: 'not out', wicketCode: '' },
							bat_3: { batId: 3, batName: 'Did Not Bat', runs: 0, balls: 0, outDesc: '', wicketCode: '' },
						},
					},
					bowlTeamDetails: {
						bowlTeamId: 2,
						bowlTeamName: 'Team B',
						bowlTeamShortName: 'B',
						bowlersData: {
							bowl_1: {
								bowlerId: 9,
								bowlName: 'Bowler',
								overs: 4,
								maidens: 0,
								runs: 20,
								wickets: 2,
								economy: 5,
								wides: 1,
								no_balls: 0,
								dots: 10,
								balls: 24,
							},
						},
					},
					scoreDetails: { runs: 100, wickets: 5, overs: 20, ballNbr: 120, runRate: 5, revisedOvers: 0 },
					extrasData: { byes: 1, legByes: 2, noBalls: 0, penalty: 0, total: 3, wides: 3 },
					ppData: { pp_1: { ppId: 1, ppType: 'Mandatory', ppOversFrom: 0.1, ppOversTo: 6, runsScored: 45 } },
					wicketsData: { wkt_1: { batId: 1, batName: 'Out Batter', wktOver: 5.2, wktRuns: 40, ballNbr: 32, wktNbr: 1 } },
					partnershipsData: {
						pat_1: {
							bat1Id: 1,
							bat1Name: 'Out Batter',
							bat1Runs: 10,
							bat2Id: 2,
							bat2Name: 'Not Out Batter',
							bat2Runs: 5,
							totalRuns: 15,
							totalBalls: 12,
						},
					},
				},
			],
		};

		const [innings] = buildScorecard(json);

		expect(innings.batting).toHaveLength(2);
		expect(innings.batting[0]).toMatchObject({
			name: 'Out Batter',
			isOut: true,
			dismissalType: 'CAUGHT',
			dismissalText: 'c Fielder b Bowler',
		});
		expect(innings.batting[1]).toMatchObject({ name: 'Not Out Batter', isNotOut: true, dismissalType: 'NOT_OUT' });
		expect(innings.didNotBat).toEqual([{ id: 3, name: 'Did Not Bat' }]);
		expect(innings.extras).toMatchObject({ total: 3, byes: 1, legByes: 2, wides: 3, text: 'b 1, lb 2, w 3' });
		expect(innings.powerplay[0]).toMatchObject({ type: 'Mandatory', fromOvers: 0.1, toOvers: 6, runs: 45 });
		expect(innings.fallOfWickets[0]).toMatchObject({ wicket: 1, runs: 40, overs: '5.2' });
		expect(innings.bowling[0]).toMatchObject({ name: 'Bowler', overs: '4', balls: 24, wickets: 2, wides: 1 });
	});
});

describe('commentary', () => {
	it('parses deliveries, over separators and drops duplicate wicket notes', () => {
		const json = {
			matchCommentary: {
				1795716681130: {
					commType: 'over-separator',
					inningsId: 2,
					overSeparator: {
						overNumber: 19,
						overSummary: '1 4 0 W 1 0 ',
						overRuns: 6,
						batTeamObj: { teamName: 'B', teamScore: '100-4' },
						bowlerObj: { playerId: 2, playerName: 'Bowler', playerScore: '4-0-30-2' },
					},
				},
				1795716681128: {
					commType: 'commentary',
					ballMetric: '19.6',
					inningsId: 2,
					batsmanDetails: { playerId: 1, playerName: 'Striker' },
					bowlerDetails: { playerId: 2, playerName: 'Bowler' },
					commText: 'Bowler to Striker, FOUR',
					event: ['four'],
				},
				1795716681120: {
					commType: 'commentary',
					ballMetric: '19.5',
					inningsId: 2,
					batsmanDetails: { playerId: 1, playerName: 'Striker' },
					bowlerDetails: { playerId: 2, playerName: 'Bowler' },
					commText: 'Bowler to Striker, out Bowled!! Striker b Bowler',
					event: ['wicket'],
				},
				1795716681110: { commType: 'commentary', commText: 'THATS OUT!! Striker b Bowler' },
				1795716681100: { commType: 'commentary', commText: 'New batter comes to the crease' },
			},
		};

		const commentary = buildCommentary(json);
		const types = commentary.entries.map((entry) => entry.type);

		// entries are newest first, and an over separator is newer than its balls
		expect(types).toEqual(['OVER', 'BALL', 'BALL', 'INFO']);
		expect(commentary.entries[0]).toMatchObject({
			type: 'OVER',
			overNumber: 19,
			runs: 6,
			summaryText: '1 4 0 W 1 0',
			score: { display: '100/4' },
		});
		expect(commentary.entries[1]).toMatchObject({ outcome: 'FOUR', runs: 4, isBoundary: true, over: 19, ball: 6, label: '19.6' });
		expect(commentary.entries[2]).toMatchObject({ outcome: 'WICKET', isWicket: true, runs: 0 });
		// upstream never sends earlier innings in this payload (161285: 24 entries,
		// all innings 3), so clients are told the feed is latest-innings only
		expect(commentary.latestInningsOnly).toBe(true);
	});

	it('handles an empty commentary payload', () => {
		const commentary = buildCommentary(null);

		expect(commentary).toMatchObject({ available: false, entries: [] });
	});

	it('skips widgets with no text, like a video snippet', () => {
		const commentary = buildCommentary({
			responseLastUpdated: 1762753600,
			matchCommentary: {
				1794289580631: {
					commType: 'snippet',
					eventType: 'Plugin:video',
					headline: 'Rohit career driven by 2027 ODI World Cup dream',
					timestamp: 1762753600,
				},
				1794289580630: { commType: 'commentary', commText: 'Rain arrives, the covers come on.', inningsId: 0, timestamp: 1762753500 },
			},
		});

		expect(commentary.entries).toHaveLength(1);
		// upstream sends seconds here (and milliseconds in real entries); both
		// must land in this decade rather than 1970
		expect(commentary.updatedAt).toBe('2025-11-10T05:46:40.000Z');
		expect(commentary.entries[0]).toMatchObject({
			type: 'INFO',
			text: 'Rain arrives, the covers come on.',
			timestamp: '2025-11-10T05:45:00.000Z',
		});
	});
});
