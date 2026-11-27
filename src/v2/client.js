import { UPSTREAM_BASE, UPSTREAM_TIMEOUT_MS } from './constants';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export class UpstreamError extends Error {
	constructor(message, { code = 'UPSTREAM_ERROR', status = 502, upstreamStatus = null } = {}) {
		super(message);
		this.name = 'UpstreamError';
		this.code = code;
		this.status = status;
		this.upstreamStatus = upstreamStatus;
	}
}

async function getJson(path) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

	try {
		const response = await fetch(`${UPSTREAM_BASE}${path}`, {
			headers: {
				Accept: 'application/json',
				'User-Agent': USER_AGENT,
			},
			signal: controller.signal,
		});

		// Cricbuzz answers 204 for unknown match ids and for matches without
		// commentary yet, so 204 has to be treated as "no payload", not an error.
		if (response.status === 204) {
			return null;
		}

		if (!response.ok) {
			throw new UpstreamError(`Cricbuzz responded with ${response.status}`, {
				upstreamStatus: response.status,
			});
		}

		const body = await response.text();

		if (!body.trim()) {
			return null;
		}

		try {
			return JSON.parse(body);
		} catch {
			throw new UpstreamError('Cricbuzz returned a non-JSON payload');
		}
	} catch (error) {
		if (error instanceof UpstreamError) {
			throw error;
		}

		if (error?.name === 'AbortError') {
			throw new UpstreamError('Cricbuzz request timed out', { code: 'UPSTREAM_TIMEOUT', status: 504 });
		}

		throw new UpstreamError(error?.message || 'Cricbuzz request failed');
	} finally {
		clearTimeout(timer);
	}
}

export function fetchHome() {
	return getJson('/home');
}

export function fetchLiveScore(matchId) {
	return getJson(`/mcenter/livescore/${matchId}`);
}

export function fetchScorecard(matchId) {
	return getJson(`/mcenter/scorecard/${matchId}`);
}

export function fetchCommentary(matchId) {
	return getJson(`/mcenter/comm/${matchId}`);
}

export async function fetchMany(tasks) {
	const results = await Promise.allSettled(tasks.map((task) => task()));

	return results.map((result) => (result.status === 'fulfilled' ? result.value : null));
}
