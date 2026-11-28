#!/system/bin/sh
# watch.sh <id> <start HH:MM> <end HH:MM> [backbone=60] [fast=8] [burst_for=600]
# Records only when the match signal changes; gzips every changed pair.
ID=$1; START=$2; END=$3; BASE=${4:-60}; FAST=${5:-8}; BURST_FOR=${6:-600}
DIR=/data/local/tmp/cap
mkdir -p "$DIR/raw/$ID" "$DIR/tmp" "$DIR/run" "$DIR/last" "$DIR/log"
NOW=$(date +%s)
TODAY=$(date +%Y-%m-%d)
S=$(date -d "$TODAY $START:00" +%s)
E=$(date -d "$TODAY $END:00" +%s)
# A window whose end is already behind us belongs to tomorrow.
if [ "$E" -le "$NOW" ]; then S=$((S + 86400)); E=$((E + 86400)); fi
[ "$E" -lt "$S" ] && E=$((E + 86400))
echo $$ > "$DIR/run/$ID.pid"
if [ "$S" -gt "$NOW" ]; then
  echo "$(date +%H:%M:%S) sleeping $(( (S - NOW) / 60 )) min until $START" >> "$DIR/log/$ID.log"
  sleep $((S - NOW))
fi
CADENCE=$BASE
BURST_END=0
LAST_SIG=""
LAST_STATE=""
echo "$(date +%H:%M:%S) watching $ID until $END base ${BASE}s fast ${FAST}s" >> "$DIR/log/$ID.log"
while :; do
  TS=$(date +%s)
  [ "$TS" -ge "$E" ] && { echo "$(date +%H:%M:%S) window closed" >> "$DIR/log/$ID.log"; break; }
  LN=$(curl -s -m 12 -H 'Connection: close' -o "$DIR/tmp/$ID.ls.json" -w '%{http_code}' "https://www.cricbuzz.com/api/mcenter/livescore/$ID")
  SC=$(curl -s -m 12 -H 'Connection: close' -o "$DIR/tmp/$ID.sc.json" -w '%{http_code}' "https://www.cricbuzz.com/api/mcenter/scorecard/$ID")
  if [ "$LN" = "200" ] && [ "$SC" = "200" ]; then
    STATE=$(grep -o '"state":"[^"]*"' "$DIR/tmp/$ID.sc.json" | head -1 | sed 's/.*:"//;s/"$//')
    STATUS=$(grep -o '"status":"[^"]*"' "$DIR/tmp/$ID.sc.json" | head -1 | sed 's/.*:"//;s/"$//')
    # The scorecard's innings list is ordered by innings, so the last
    # scoreDetails is the innings in progress (or the one that just ended).
    # A bare "overs" in livescore also matches each bowler's overs.
    DET=$(grep -o '"scoreDetails":{[^}]*}' "$DIR/tmp/$ID.sc.json" | tail -1)
    if [ -n "$DET" ]; then
      RUNS=$(printf '%s' "$DET" | sed 's/.*"runs":\([0-9]*\).*/\1/')
      WKTS=$(printf '%s' "$DET" | sed 's/.*"wickets":\([0-9]*\).*/\1/')
      OVERS=$(printf '%s' "$DET" | sed 's/.*"overs":\([0-9.]*\).*/\1/')
    else
      BAT=$(grep -o '"batTeam":{[^}]*}' "$DIR/tmp/$ID.ls.json" | head -1)
      RUNS=$(printf '%s' "$BAT" | grep -o '"teamScore":[0-9]*' | head -1 | cut -d: -f2)
      WKTS=$(printf '%s' "$BAT" | grep -o '"teamWkts":[0-9]*' | head -1 | cut -d: -f2)
      OVERS=$(grep -o '"overs":[0-9.]*' "$DIR/tmp/$ID.ls.json" | tail -1 | cut -d: -f2)
    fi
    IID=$(grep -o '"inningsId":[0-9]*' "$DIR/tmp/$ID.ls.json" | head -1 | cut -d: -f2)
    SIG="$STATE|${IID:--}|${RUNS:--}/${WKTS:--}|${OVERS:--}|$STATUS"
    if [ "$SIG" != "$LAST_SIG" ]; then
      echo "$TS $SIG" >> "$DIR/trace/$ID.jsonl"
      gzip -c "$DIR/tmp/$ID.ls.json" > "$DIR/raw/$ID/$TS-ls.json.gz"
      gzip -c "$DIR/tmp/$ID.sc.json" > "$DIR/raw/$ID/$TS-sc.json.gz"
      echo "$(date +%H:%M:%S) $SIG" >> "$DIR/log/$ID.log"
      LAST_SIG=$SIG
      if [ "$STATE" != "$LAST_STATE" ] && [ -n "$LAST_STATE" ]; then
        CADENCE=$FAST; BURST_END=$((TS + BURST_FOR))
        echo "$(date +%H:%M:%S) state $LAST_STATE -> $STATE, ${FAST}s for ${BURST_FOR}s" >> "$DIR/log/$ID.log"
      fi
      LAST_STATE=$STATE
    fi
  else
    echo "$TS http $LN/$SC" >> "$DIR/trace/$ID.jsonl"
  fi
  [ "$CADENCE" != "$BASE" ] && [ "$TS" -ge "$BURST_END" ] && CADENCE=$BASE
  sleep "$CADENCE"
done
rm -f "$DIR/run/$ID.pid"
