import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

const homeFixture = {
	matches: [
		{
			match: {
				matchInfo: {
					matchId: 175273,
					seriesId: 12037,
					seriesName: 'International League T20 2026',
					matchDesc: '8th Match',
					matchFormat: 'T20',
					matchType: 'league',
					startDate: '2026-11-26T14:30:00.000Z',
					state: 'Complete',
					status: 'MI Emirates won by 36 runs',
					team1: { teamId: 1300, teamName: 'Abu Dhabi Knight Riders', teamSName: 'ADKR', imageId: 824995 },
					team2: { teamId: 1307, teamName: 'MI Emirates', teamSName: 'MIE', imageId: 824997 },
					venueInfo: { id: 0, ground: 'Sheikh Zayed Stadium', city: 'Abu Dhabi', timezone: '+04:00' },
					currBatTeamId: 1300,
				},
				matchScore: {
					team1Score: { inngs1: { inningsId: 2, runs: 171, wickets: 7, overs: 20 } },
					team2Score: { inngs1: { inningsId: 1, runs: 207, wickets: 4, overs: 20 } },
				},
			},
		},
	],
	responseLastUpdated: 1795716681128,
};

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// The worker calls global fetch, so a stubbed global is all it takes to serve
// deterministic upstream payloads in this isolate.
function mockUpstream(handler) {
	vi.stubGlobal('fetch', async (input) => handler(new URL(String(input)).pathname));
}

function mockHome() {
	mockUpstream((path) => (path === '/api/home' ? jsonResponse(homeFixture) : new Response(null, { status: 404 })));
}

function mockNotFound() {
	mockUpstream((path) => (path === '/api/home' ? jsonResponse(homeFixture) : new Response(null, { status: 204 })));
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('v1 routes (behaviour must not change)', () => {
	it('GET /matches still returns the v1 envelope', async () => {
		mockHome();

		const response = await SELF.fetch('http://example.com/matches');
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.data.count).toBe(1);
		expect(body.data.matches).toHaveLength(1);
		expect(body.data.matches[0]).toMatchObject({ matchId: 175273 });
	});

	it('keeps the v1 404 for unknown routes', async () => {
		const response = await SELF.fetch('http://example.com/nope');
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body).toMatchObject({ success: false, error: 'Route Not Found' });
	});
});

describe('v2 routes', () => {
	it('GET /v2 advertises the endpoints', async () => {
		const response = await SELF.fetch('http://example.com/v2');
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toMatchObject({ success: true, v: 2 });
		expect(Array.isArray(body.data.endpoints)).toBe(true);
	});

	it('GET /v2/matches normalises the home feed', async () => {
		mockHome();

		const response = await SELF.fetch('http://example.com/v2/matches');
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.meta).toMatchObject({ source: 'cricbuzz', count: 1, total: 1 });
		expect(body.data.matches[0]).toMatchObject({
			id: 175273,
			format: 'T20',
			state: 'COMPLETE',
			isComplete: true,
			isLive: false,
		});
		expect(body.data.matches[0].live).toBe(null);
	});

	it('filters by state', async () => {
		mockHome();

		const response = await SELF.fetch('http://example.com/v2/matches?state=live');
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.matches).toHaveLength(0);
		expect(body.meta).toMatchObject({ count: 0, total: 1 });
	});

	it('answers 404 MATCH_NOT_FOUND when upstream has no content', async () => {
		mockNotFound();

		const response = await SELF.fetch('http://example.com/v2/matches/999999999');
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body.error.code).toBe('MATCH_NOT_FOUND');
	});

	it('answers 405 for non-GET requests', async () => {
		const response = await SELF.fetch('http://example.com/v2/matches', { method: 'POST' });
		const body = await response.json();

		expect(response.status).toBe(405);
		expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
	});

	it('keeps the v2 404 for unknown v2 routes', async () => {
		const response = await SELF.fetch('http://example.com/v2/nope');
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body.error.code).toBe('NOT_FOUND');
	});
});
