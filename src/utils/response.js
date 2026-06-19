const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET,OPTIONS',
	'Access-Control-Allow-Headers': '*',
};

export function success(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			...CORS_HEADERS,
			'Content-Type': 'application/json',
		},
	});
}

export function error(message, status = 500) {
	return new Response(
		JSON.stringify({
			success: false,
			error: message,
		}),
		{
			status,
			headers: {
				...CORS_HEADERS,
				'Content-Type': 'application/json',
			},
		},
	);
}

export function preflight() {
	return new Response(null, {
		status: 204,
		headers: CORS_HEADERS,
	});
}
