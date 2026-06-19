export async function getTeamIcon(imageId, shortName) {
	const targetUrl = `https://static.cricbuzz.com/a/img/v1/0x0/i1/c${imageId}/${shortName}.jpg`;

	const response = await fetch(targetUrl);

	return new Response(response.body, {
		headers: {
			'Content-Type': response.headers.get('content-type') || 'image/jpeg',

			'Access-Control-Allow-Origin': '*',

			'Cache-Control': 'public, max-age=86400',
		},
	});
}
