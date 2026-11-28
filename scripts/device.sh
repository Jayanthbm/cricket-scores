#!/usr/bin/env bash
# Capture phone helper. The phone does the polling; this only arms, checks, pulls.
set -euo pipefail
DIR=/data/local/tmp/cap
LOCAL=.\.analysis/device
# Two devices are often attached (the phone over WiFi plus anything on USB);
# pin to the capture phone unless CAP_DEVICE overrides it.
CAP_DEVICE=${CAP_DEVICE:-192.168.31.64:5555}
adb() { command adb -s "$CAP_DEVICE" "$@"; }
cmd=${1:-status}

case "$cmd" in
  status)
    adb shell "date '+%H:%M:%S'; echo '--- pids ---'; cat $DIR/run/*.pid 2>/dev/null | tr '\\n' ' '; echo; echo '--- watchdog heartbeat ---'; tail -1 $DIR/log/watchdog-heartbeat.log 2>/dev/null; echo '--- traces ---'; for f in $DIR/trace/*.jsonl; do echo \"\$(basename \$f): \$(wc -l < \$f) lines\"; tail -2 \$f; done"
    ;;
  arm)
    id=${2:?id}; from=${3:?from}; to=${4:?to}; base=${5:-60}; fast=${6:-15}
    adb shell "grep -q '^$id ' $DIR/watchlist || echo '$id $from $to $base $fast 900 manual' >> $DIR/watchlist"
    adb shell "setsid nohup $DIR/watch.sh $id $from $to $base $fast 900 >> $DIR/log/$id.log 2>&1 & echo armed $id"
    ;;
  stop)
    which=${2:-all}
    adb shell "if [ '$which' = all ]; then pkill -f '$DIR/watch.sh'; rm -f $DIR/run/*.pid; else kill \$(cat $DIR/run/$which.pid) 2>/dev/null; rm -f $DIR/run/$which.pid; fi; echo stopped $which"
    ;;
  pull)
    mkdir -p "$LOCAL"
    adb shell "tar -czf - -C $DIR trace raw 2>/dev/null" > "$LOCAL/phone-capture.tgz"
    tar -xzf "$LOCAL/phone-capture.tgz" -C "$LOCAL" && rm -f "$LOCAL/phone-capture.tgz"
    echo "pulled to $LOCAL"; du -sh "$LOCAL"
    ;;
  push)
    adb push scripts/phone/watch.sh scripts/phone/watchdog.sh /data/local/tmp/cap/ >/dev/null
    adb shell 'chmod 755 /data/local/tmp/cap/watch.sh /data/local/tmp/cap/watchdog.sh'
    adb push scripts/phone/99-capture.sh /data/local/tmp/cap/99-capture.sh >/dev/null
    adb shell 'su -c "cp /data/local/tmp/cap/99-capture.sh /data/adb/service.d/99-capture.sh; chmod 755 /data/adb/service.d/99-capture.sh"'
    echo "pushed scripts and boot hook"
    ;;

  digest)
    "$0" pull >/dev/null
    python3 - "$LOCAL" <<'PY'
import sys, glob, os, datetime, json
root = sys.argv[1]
for path in sorted(glob.glob(os.path.join(root, 'trace', '*.jsonl'))):
    lines = [l.rstrip('\n') for l in open(path) if l.strip()]
    if not lines:
        continue
    print('\n==', os.path.basename(path), f'({len(lines)} lines)')
    prev_state = None
    for line in lines:
        parts = line.split(' ', 1)
        try:
            ts = int(parts[0])
            when = datetime.datetime.fromtimestamp(ts).strftime('%H:%M:%S')
        except ValueError:
            print('  ', line[:120]); continue
        body = parts[1] if len(parts) > 1 else ''
        state = body.split('|')[0].strip()
        mark = '>>' if prev_state and state != prev_state else '  '
        print(f'  {mark} {when}  {body[:110]}')
        prev_state = state or prev_state
PY
    ;;

  logs)
    adb shell "tail -${2:-40} $DIR/log/${3:-watchdog}.log"
    ;;
  *)
    echo "usage: $0 {status|arm <id> <from> <to> [base] [fast]|stop [id|all]|pull|push|logs [n] [name]}"; exit 1
    ;;
esac
