# Phone capture rig

The spare OnePlus (Android 12, Magisk root, `192.168.31.64:5555` over WiFi adb)
does the polling so nothing depends on this machine staying awake. It is a
recorder, not a server: we pull the traces when we want to analyse them.

## Why it exists

The local watchers kept dying with the environment (three restarts in one day),
and each restart lost a window we cared about. Polling from a phone on the
charger survives laptop sleep, session restarts and USB disconnects.

## What runs on the phone

```
/data/local/tmp/cap/
  watch.sh          one watcher per match: curl -> signal -> gzip -> trace
  watchdog.sh       every 5 min, restarts a window that should be open
  watchlist         "<id> <from> <to> <backbone> <fast> <burst_for> <note>"
  trace/<id>.jsonl  one line per signal change: epoch state|runs/wkts|overs|status
  raw/<id>/<ts>-{ls,sc}.json.gz   the two upstream payloads for that change
  log/              per-match log, watchdog log, heartbeat
  run/<id>.pid      pid files, also used as the liveness check
```

`/data/adb/service.d/99-capture.sh` re-arms everything on boot: disables doze,
takes the PM wakelock, turns off the phantom-process killer, starts the watchdog.

## Host commands

```bash
./scripts/device.sh status                 # pids, heartbeat age, last trace lines
./scripts/device.sh arm 161296 03:10 06:20 60 15
./scripts/device.sh stop all               # or: stop 161296
./scripts/device.sh pull                   # -> .analysis/device/{trace,raw}
./scripts/device.sh logs 40 watchdog
```

Only `arm` and `stop` change the phone. Trace lines are tiny; `pull` tars the
whole capture dir, so pull before analysing and prune raw gzips if it grows.

## Signal, not hash

Every payload embeds commentary with live timestamps, so a sha256 changes on
every poll and would store a file every time. `watch.sh` instead compares
`state|runs/wkts|overs|status` and stores a pair only when that changes, which
is 1 line per ball-ish event instead of 4-12 per minute.

## Survival measures, and what each protects against

| measure                                       | protects against                 |
| --------------------------------------------- | -------------------------------- |
| `setsid nohup`                                | adb shell exit / USB unplug      |
| `/sys/power/wake_lock`                        | CPU sleeping with the screen off |
| `dumpsys deviceidle disable`                  | Doze freezing the network        |
| `settings_enable_monitor_phantom_procs false` | Android 12 killing child shells  |
| watchdog every 5 min                          | crash, OOM, accidental kill      |
| Magisk `service.d` hook                       | reboot                           |

## Root over WiFi, and why the watcher does not need it

Magisk authorises by UID (the `shell` user), not by transport, so
`adb -s 192.168.31.64:5555 shell su -c id` returns 0 exactly like USB. The
first call may raise a Superuser prompt on the phone; allow it once and it
persists.

The watcher and watchdog run as `shell` (uid 2000) on purpose: polling and
writing under `/data/local/tmp` needs no root. Root was only needed at setup
time, for four things:

- `/data/adb/service.d/99-capture.sh` (boot hook)
- `dumpsys deviceidle disable` (doze)
- `/sys/power/wake_lock` (CPU stays awake)
- `settings put global settings_enable_monitor_phantom_procs false`

Reading those same paths back as `shell` gives "Permission denied"; that is
expected and not a sign the rig broke - prefix with `su -c`.

## Gotchas learned the hard way

- `/data/local/tmp/cap` created as root is not writable by the `shell` user;
  create it, then `chown -R shell:shell` and `chmod -R 775`.
- A redirect after `su -c "..."` is evaluated by the outer shell, before the
  inner `mkdir` runs. Make the directory first, then redirect.
- `pgrep -f watchdog.sh` matches the adb command line that contains that string;
  check `run/watchdog.pid` instead.
- A window whose end is already in the past belongs to tomorrow; `watch.sh` and
  `watchdog.sh` both roll it forward a day.
- A bare `"overs":` in livescore matches each **bowler's** overs first, so the
  first hit at an innings break was the striker's `4`, not the innings' `20`.
  The trace now reads the scorecard's last `scoreDetails` (innings-ordered)
  instead, and carries `inningsId` so an innings flip is visible on its own.
