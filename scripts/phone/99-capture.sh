#!/system/bin/sh
# Magisk boot hook: keep the capture phone awake and restart the watchdog.
sleep 20
dumpsys deviceidle disable >/dev/null 2>&1
settings put global settings_enable_monitor_phantom_procs false 2>/dev/null
echo cricket-capture > /sys/power/wake_lock 2>/dev/null
mkdir -p /data/local/tmp/cap/log /data/local/tmp/cap/run
PIDF=/data/local/tmp/cap/run/watchdog.pid
if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then exit 0; fi
setsid nohup /data/local/tmp/cap/watchdog.sh >> /data/local/tmp/cap/log/watchdog.log 2>&1 &
exit 0
