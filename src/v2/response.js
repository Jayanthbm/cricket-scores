import { UpstreamError } from './client';
import { SCHEMA_VERSION } from './constants';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,OPTIONS',
	'Access-Control-Allow-Headers': '*',
};

// Cache hints per endpoint. Live payloads stay short so FE polling always sees
// fresh data even through browser/proxy caches.
export const CACHE = {
	list: 'public, max-age=20, stale-while-revalidate=40',
	detail: 'public, max-age=10, stale-while-revalidate=20',
	live: 'public, max-age=5, stale-while-revalidate=10',
	scorecard: 'public, max-age=20, stale-while-revalidate=40',
	commentary: 'public, max-age=5, stale-while-revalidate=10',
	icon: 'public, max-age=86400',
};

function respond(body, status, cacheControl) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...CORS_HEADERS,
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': cacheControl,
		},
	});
}

export function send(data, { status = 200, meta = {}, cacheControl = 'no-store' } = {}) {
	return respond(
		{
			success: true,
			v: SCHEMA_VERSION,
			meta: { generatedAt: new Date().toISOString(), ...meta },
			data,
		},
		status,
		cacheControl,
	);
}

export function fail(code, message, { status = 500, meta = {}, cacheControl = 'no-store' } = {}) {
	return respond(
		{
			success: false,
			v: SCHEMA_VERSION,
			meta: { generatedAt: new Date().toISOString(), ...meta },
			error: { code, message },
		},
		status,
		cacheControl,
	);
}

export function failFromError(error) {
	if (error instanceof UpstreamError) {
		return fail(error.code, error.message, { status: error.status });
	}

	console.error(error);

	return fail('INTERNAL_ERROR', error?.message || 'Internal Server Error', { status: 500 });
}

export function notFound(message = 'Route Not Found') {
	return fail('NOT_FOUND', message, { status: 404 });
}

// A match id we cannot resolve anywhere upstream. Distinct from NOT_FOUND
// (bad route) so clients know to stop polling instead of retrying.
export function matchNotFound(message = 'Match not found') {
	return fail('MATCH_NOT_FOUND', message, { status: 404 });
}
