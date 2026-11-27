export function toNumber(value, fallback = null) {
	if (value === null || value === undefined || value === '') {
		return fallback;
	}

	const num = Number(value);

	return Number.isFinite(num) ? num : fallback;
}

export function round2(value) {
	const num = toNumber(value);

	return num === null ? null : Math.round(num * 100) / 100;
}

// Cricbuzz encodes overs as "overs.balls" where the ball digit is 1-6 and "x.6"
// means the next over has started (e.g. 49.6 -> 50 overs, 13.6 -> 14 overs).
export function oversToBalls(overs) {
	const value = toNumber(overs);

	if (value === null || value < 0) {
		return null;
	}

	const completedOvers = Math.floor(value);
	const tenths = Math.round((value - completedOvers) * 10);

	if (tenths === 0) {
		return completedOvers * 6;
	}

	if (tenths === 6) {
		return (completedOvers + 1) * 6;
	}

	if (tenths > 6) {
		// Not a ball-count encoding (e.g. a real decimal overs value).
		return Math.round(value * 6);
	}

	return completedOvers * 6 + tenths;
}

// Exact ball count -> cricket overs string. 120 -> "20", 249 -> "41.3".
export function ballsToOvers(balls) {
	const value = toNumber(balls);

	if (value === null || value < 0) {
		return null;
	}

	const completedOvers = Math.floor(value / 6);
	const remaining = value % 6;

	return remaining === 0 ? String(completedOvers) : `${completedOvers}.${remaining}`;
}

// The Hundred counts in sets of 10 balls: the scorecard sends overs "9.8" (9
// sets + 8 balls) next to ballNbr 98, while livescore sends only 98. Keep the
// scorecard form and rebuild it from the ball count when only that is available.
function oversLabel(overs, balls, format) {
	const hasOvers = overs !== null && overs !== undefined && overs !== '';

	if (format === 'THE_HUNDRED') {
		if (hasOvers) {
			return String(overs);
		}

		if (balls === null) {
			return null;
		}

		const sets = Math.floor(balls / 10);
		const rest = balls % 10;

		return rest === 0 ? String(sets) : `${sets}.${rest}`;
	}

	if (balls === null) {
		return hasOvers ? String(overs) : null;
	}

	return ballsToOvers(balls);
}

export function scoreLine({ runs, wickets, overs, balls, runRate, declared = false, followOn = false, format = null } = {}) {
	const totalRuns = toNumber(runs, 0);
	const totalWickets = toNumber(wickets, 0);
	const totalBalls = balls !== undefined && balls !== null ? toNumber(balls) : oversToBalls(overs);
	const oversText = oversLabel(overs, totalBalls, format);
	const rate =
		runRate !== undefined && runRate !== null
			? round2(runRate)
			: totalBalls
				? round2(format === 'THE_HUNDRED' ? totalRuns / totalBalls : (totalRuns * 6) / totalBalls)
				: null;

	return {
		runs: totalRuns,
		wickets: totalWickets,
		overs: oversText,
		balls: totalBalls,
		runRate: rate,
		declared: Boolean(declared),
		followOn: Boolean(followOn),
		display: `${totalRuns}/${totalWickets}${declared ? 'd' : ''}${oversText ? ` (${oversText})` : ''}`,
		displayShort: `${totalRuns}/${totalWickets}${declared ? 'd' : ''}`,
	};
}

export function toIso(timestamp) {
	const value = toNumber(timestamp);

	if (!value) {
		return null;
	}

	return new Date(value).toISOString();
}

function formatInIndia(timestamp, options) {
	const value = toNumber(timestamp);

	if (!value) {
		return null;
	}

	return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...options }).format(new Date(value));
}

export function formatDateTime(timestamp) {
	const date = formatInIndia(timestamp, { day: '2-digit', month: 'short', year: 'numeric' });
	const time = formatInIndia(timestamp, { hour: '2-digit', minute: '2-digit', hour12: true });
	const upperTime = time ? time.replace(/\b(am|pm)\b/i, (meridiem) => meridiem.toUpperCase()) : time;

	return date && upperTime ? `${date}, ${upperTime} IST` : null;
}

// Upstream mixes seconds and milliseconds depending on the field (scorecard and
// commentary use seconds, livescore uses milliseconds).
export function toEpochIso(value) {
	const stamp = toNumber(value);

	if (!stamp) {
		return null;
	}

	return toIso(stamp > 1e12 ? stamp : stamp * 1000);
}

export function formatDate(timestamp) {
	return formatInIndia(timestamp, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function stripHtml(value) {
	if (!value) {
		return '';
	}

	return String(value)
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+\n\s+/g, '\n')
		.trim();
}

export function slugify(value) {
	return String(value || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function safeArray(value) {
	return Array.isArray(value) ? value : [];
}

export function sortByNumberKey(record, keySelector) {
	if (!record || typeof record !== 'object') {
		return [];
	}

	return Object.entries(record).sort((a, b) => {
		const left = keySelector(a[0], a[1]);
		const right = keySelector(b[0], b[1]);

		return left - right;
	});
}
