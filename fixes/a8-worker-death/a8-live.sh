#!/usr/bin/env bash
set -u
cd "$1"; P=.claude/skills/verify/bin/pw
$P start-run >/dev/null 2>&1
$P launch a >/dev/null
$P click a "Create a group"; $P wait a "(this device)" 30 >/dev/null
R=.verify-runs/$(cat .verify-runs/current)
PG=$(python3 -c "import json;print(json.load(open('$R/instances/a.json'))['pgid'])")
bare () { pgrep -g "$PG" -f core-host.js; }
B1=$(bare); kill -9 "$B1"; sleep 0.3
echo "right after kill: $($P text a | head -3 | tr '\n' '|')"; $P shot a a8-restarting >/dev/null
sleep 5; echo "old worker $B1, new worker $(bare)"
echo "after restart: $($P text a | head -3 | tr '\n' '|')"; $P shot a a8-recovered >/dev/null
for i in 1 2 3 4 5 6 7; do for t in $(seq 1 100); do b=$(bare); [ -n "$b" ] && break; sleep 0.2; done; [ -n "$b" ] && kill -9 "$b" && echo "killed crash $i ($b)"; sleep 0.3; done; sleep 3
echo "after crash loop: $($P text a | tr '\n' '|')"; $P shot a a8-failed >/dev/null
$P click a "Try again"; sleep 6
echo "after Try again: $($P text a | head -3 | tr '\n' '|')"
b=$(bare); kill -9 "$b"; sleep 0.1
T0=$(python3 -c 'import time;print(time.time())'); $P stop a >/dev/null
python3 -c "import time;print('quit with dead worker took %.2fs'%(time.time()-$T0))"
$P cleanup >/dev/null; echo "artifacts: $R/artifacts"
