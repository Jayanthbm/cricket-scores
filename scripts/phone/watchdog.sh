#!/system/bin/sh
# watchdog.sh - restarts any watch window that should be running but is not.
DIR=/data/local/tmp/cap
WL="$DIR/watchlist"
echo $$ > "$DIR/run/watchdog.pid"
while :; do
  echo "$(date +%s) alive" >> "$DIR/log/watchdog-heartbeat.log"
  if [ -f "$WL" ]; then
    while read -r ID START END BASE FAST BFOR NOTE; do
      [ -z "$ID" ] && continue
      case "$ID" in \#*) continue ;; esac
      NOW=$(date +%s)
      TOD=$(date +%Y-%m-%d)
      S=$(date -d "$TOD $START:00" +%s); E=$(date -d "$TOD $END:00" +%s)
      if [ "$E" -le "$NOW" ]; then S=$((S + 86400)); E=$((E + 86400)); fi
      [ "$E" -lt "$S" ] && E=$((E + 86400))
      [ "$NOW" -lt "$S" ] || [ "$NOW" -gt "$E" ] && continue
      PIDF="$DIR/run/$ID.pid"
      if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then continue; fi
      echo "$(date +%H:%M:%S) restarting $ID" >> "$DIR/log/watchdog.log"
      setsid nohup "$DIR/watch.sh" "$ID" "$START" "$END" "${BASE:-60}" "${FAST:-8}" "${BFOR:-600}" >> "$DIR/log/$ID.log" 2>&1 &
    done < "$WL"
  fi
  sleep 300
done
