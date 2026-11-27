import { ICON_CACHE_TTL_MS } from './constants';
import { toNumber } from './utils';

const teamIconCache = new Map();

// /api/home is the only endpoint that exposes team image ids, so every list/hub
// request feeds this cache. Icons are best-effort: routes that never see /api/home
// (live, commentary) can return `icon: null`.
export function rememberTeams(homeJson) {
	const matches = homeJson?.matches;

	if (!Array.isArray(matches)) {
		return;
	}

	const now = Date.now();

	for (const entry of matches) {
		const info = entry?.match?.matchInfo;

		if (!info) {
			continue;
		}

		for (const team of [info.team1, info.team2]) {
			const teamId = toNumber(team?.teamId);
			const imageId = toNumber(team?.imageId);

			if (!teamId || !imageId) {
				continue;
			}

			teamIconCache.set(teamId, {
				imageId,
				shortName: team.teamSName || '',
				updatedAt: now,
			});
		}
	}
}

export function teamIconUrl(baseUrl, teamId, fallbackShortName = '') {
	const cached = teamIconCache.get(toNumber(teamId));

	if (!cached || Date.now() - cached.updatedAt > ICON_CACHE_TTL_MS) {
		return null;
	}

	const shortName = cached.shortName || fallbackShortName;

	if (!shortName) {
		return null;
	}

	return `${baseUrl}/team-icon/${cached.imageId}/${encodeURIComponent(shortName)}`;
}

export function buildTeamRef(team = {}) {
	return {
		id: toNumber(team.teamId ?? team.id),
		name: team.teamName || team.name || '',
		shortName: team.teamSName || team.shortName || '',
	};
}

export function buildTeamCard({ id, name, shortName, innings = [], isBatting = false, baseUrl }) {
	const cleanInnings = innings.filter(Boolean);
	const latest = cleanInnings[cleanInnings.length - 1] || null;

	return {
		id: toNumber(id),
		name: name || '',
		shortName: shortName || '',
		icon: baseUrl ? teamIconUrl(baseUrl, id, shortName) : null,
		isBatting: Boolean(isBatting),
		score: cleanInnings.length ? cleanInnings.map((inningsItem) => inningsItem.displayShort).join(' & ') : null,
		overs: latest ? latest.overs : null,
		innings: cleanInnings,
	};
}
