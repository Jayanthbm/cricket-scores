#!/usr/bin/env node
/**
 * Cricbuzz state capture harness.
 *
 * Runs for days/weeks, watching the home feed for matches that enter an
 * interesting state (toss, live, innings break, stumps, delay, complete, ...)
 * and stores one snapshot per state transition so we can build the v2 contract
 * from real payloads instead of guesses.
 *
 * Usage:
 *   node scripts/capture.mjs                 # watch the home feed forever
 *   node scripts/capture.mjs --minutes 30    # stop after 30 minutes
 *   node scripts/capture.mjs --matches 178523,166697
 *
 * Env:
 *   CAPTURE_DIR       output directory (default: captures)
 *   CAPTURE_INTERVAL  seconds between polls (default: 120)
 */
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const API = 'https://www.cricbuzz.com/api';
const OUT_DIR = process.env.CAPTURE_DIR || 'captures';
const INTERVAL_MS = Math.max(30, Number(process.env.CAPTURE_INTERVAL || 120)) * 1000;

const INTERESTING = /toss|live|progress|innings break|stumps|delay|interrupt|rain|abandon|complete|won by|drawn|tie|no result/i;

function arg(name, fallback = null) {
	const index = process.argv.indexOf(`--${name}`);

	return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const MAX_MINUTES = arg('minutes') ? Number(arg('minutes')) : null;
const WATCHLIST = new Set(
	(arg('matches') || '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean),
);

const seen = new Map();
const stats = { ticks: 0, snapshots: 0, states: new Map(), errors: 0 };
let savedSnapshots = 0;
let lastHomeSave = 0;

async function getJson(path) {
	const response = await fetch(`${API}${path}`, {
		headers: { 'User-Agent': UA, Accept: 'application/json' },
		signal: AbortSignal.timeout(15000),
	});

	if (response.status === 204) {
		return null;
	}

	if (!response.ok) {
		throw new Error(`${path} -> ${response.status}`);
	}

	try {
		return await response.json();
	} catch {
		return null;
	}
}

function stamp(date = new Date()) {
	return date.toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
}

function day(date = new Date()) {
	return date.toISOString().slice(0, 10);
}

async function save(kind, name, payload) {
	const dir = join(OUT_DIR, day());
	const file = join(dir, `${name}.${kind}.json`);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify(payload));
	savedSnapshots += 1;
	stats.snapshots += 1;

	return file;
}

async function record(entry) {
	await mkdir(OUT_DIR, { recursive: true });
	await appendFile(join(OUT_DIR, 'states.jsonl'), `${JSON.stringify(entry)}\n`);
}

function liveState(live) {
	return live?.miniscore?.matchScoreDetails?.state || live?.miniscore?.state || null;
}

async function captureMatch(info, live) {
	const state = liveState(live) || info.state || 'Unknown';
	const inningsId = live?.miniscore?.inningsId ?? null;
	const key = `${info.matchId}|${state}|${inningsId}|${live?.miniscore?.status || info.status}`;

	if (seen.get(info.matchId) === key) {
		return;
	}

	seen.set(info.matchId, key);
	stats.states.set(state, (stats.states.get(state) || 0) + 1);

	const name = `${info.matchId}.${state.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.i${inningsId ?? 0}.${stamp()}`;
	const saved = [];

	try {
		if (live) {
			saved.push(await save('livescore', name, live));
		}

		const [scorecard, commentary] = await Promise.all([
			getJson(`/mcenter/scorecard/${info.matchId}`).catch(() => null),
			getJson(`/mcenter/comm/${info.matchId}`).catch(() => null),
		]);

		if (scorecard) {
			saved.push(await save('scorecard', name, scorecard));
		}

		if (commentary) {
			saved.push(await save('comm', name, commentary));
		}
	} catch (error) {
		stats.errors += 1;
		console.error(`[capture] ${info.matchId} ${state}: ${error.message}`);
	}

	await record({
		ts: new Date().toISOString(),
		id: info.matchId,
		format: info.matchFormat,
		homeState: info.state,
		liveState: state,
		status: live?.miniscore?.status || info.status,
		inningsId,
		files: saved.map((file) => file.replace(`${OUT_DIR}/`, '')),
	});

	console.log(`[capture] ${info.matchId} ${info.matchFormat} ${state} i${inningsId} :: ${live?.miniscore?.status || info.status}`);
}

async function tick() {
	stats.ticks += 1;
	const home = await getJson('/home');

	if (!home) {
		return;
	}

	const now = Date.now();

	if (now - lastHomeSave > 30 * 60 * 1000) {
		lastHomeSave = now;
		await save('home', `home.${stamp()}`, home);
	}

	const homeIds = new Set();

	for (const entry of home.matches || []) {
		const info = entry?.match?.matchInfo;

		if (!info) {
			continue;
		}

		homeIds.add(String(info.matchId));

		const wanted = WATCHLIST.size ? WATCHLIST.has(String(info.matchId)) : INTERESTING.test(`${info.state} ${info.status}`);

		if (!wanted) {
			continue;
		}

		const live = await getJson(`/mcenter/livescore/${info.matchId}`).catch((error) => {
			stats.errors += 1;
			console.error(`[capture] livescore ${info.matchId}: ${error.message}`);

			return null;
		});

		await captureMatch(info, live);
	}

	// The home feed only carries a handful of featured matches, so explicit
	// watchlist ids are polled directly even when they are not listed there.
	for (const matchId of WATCHLIST) {
		if (homeIds.has(matchId)) {
			continue;
		}

		const live = await getJson(`/mcenter/livescore/${matchId}`).catch((error) => {
			stats.errors += 1;
			console.error(`[capture] livescore ${matchId}: ${error.message}`);

			return null;
		});

		if (!live?.miniscore) {
			continue;
		}

		await captureMatch(
			{
				matchId,
				matchFormat: live.miniscore.matchScoreDetails?.matchFormat || 'UNKNOWN',
				state: liveState(live) || 'Unknown',
				status: live.miniscore.status || '',
			},
			live,
		);
	}
}

function summary() {
	const states = [...stats.states.entries()].map(([state, count]) => `${state}:${count}`).join(', ') || 'none';

	return `${savedSnapshots} snapshot files | states ${states} | errors ${stats.errors}`;
}

const startedAt = Date.now();
console.log(`[capture] dir=${OUT_DIR} interval=${INTERVAL_MS / 1000}s${MAX_MINUTES ? ` max=${MAX_MINUTES}m` : ''}`);

process.on('SIGINT', async () => {
	console.log(`\n[capture] stopped: ${summary()}`);
	process.exit(0);
});

while (true) {
	try {
		await tick();
	} catch (error) {
		stats.errors += 1;
		console.error(`[capture] tick failed: ${error.message}`);
	}

	if (stats.ticks % 10 === 0) {
		console.log(`[capture] ${stats.ticks} ticks :: ${summary()}`);
	}

	if (MAX_MINUTES && Date.now() - startedAt > MAX_MINUTES * 60 * 1000) {
		console.log(`[capture] finished: ${summary()}`);
		break;
	}

	await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}