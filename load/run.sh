#!/usr/bin/env bash
#
# The k6 load run. Needs `make up` first — it drives the real stack.
#
#   ./load/run.sh                          the full run, 250 sockets
#   PEAK_VUS=50 HOLD=1m ./load/run.sh      a smaller one
#
# Two things happen at once, and that is the point: k6 measures from the client
# side while this samples Collab's own /metrics. One of them saying "250
# connections, 4 ms" is a claim about the load generator; both of them saying
# it is a claim about the server.
set -euo pipefail

cd "$(dirname "$0")"

GATEWAY_URL=${GATEWAY_URL:-http://gateway:8080}
COLLAB_METRICS=${COLLAB_METRICS:-http://localhost:8084/metrics}
NETWORK=${NETWORK:-deepcs_default}
SAMPLE_SECONDS=${SAMPLE_SECONDS:-5}
CSV=dist/collab-metrics.csv

if ! curl -fsS --max-time 3 "$COLLAB_METRICS" >/dev/null; then
  echo "collab is not answering $COLLAB_METRICS — run 'make up' first" >&2
  exit 1
fi

# k6 resolves neither node_modules nor TypeScript, so the script it runs is a
# bundle built here rather than the file in this directory.
node bundle.mjs

# Both memory numbers, because they answer different questions. Node hands
# resident memory back to the operating system reluctantly, so RSS staying high
# after a run is not evidence of a leak; the used heap coming back down is
# evidence of the opposite.
metric() { awk -v name="$1" '$1 == name { print $2 }'; }

mkdir -p dist
echo 'seconds,connections,rooms,rss_bytes,heap_bytes' >"$CSV"
(
  start=$SECONDS
  while true; do
    if body=$(curl -fsS --max-time 2 "$COLLAB_METRICS"); then
      printf '%s,%s,%s,%s,%s\n' "$((SECONDS - start))" \
        "$(metric collab_websocket_connections <<<"$body")" \
        "$(metric collab_rooms <<<"$body")" \
        "$(metric process_resident_memory_bytes <<<"$body")" \
        "$(metric nodejs_heap_size_used_bytes <<<"$body")" >>"$CSV"
    fi
    sleep "$SAMPLE_SECONDS"
  done
) &
sampler=$!
trap 'kill "$sampler" 2>/dev/null || true' EXIT

# --network, so the load generator talks to the Gateway over the compose
# network rather than through published ports. It goes through the Gateway
# rather than straight to Collab because that is the path a browser takes, and
# one collab socket occupies a concurrency slot on both.
status=0
docker run --rm -i --network "$NETWORK" \
  -e GATEWAY_URL="$GATEWAY_URL" \
  -e PEAK_VUS="${PEAK_VUS:-250}" \
  -e HOLD="${HOLD:-3m}" \
  -e SOCKET_SECONDS="${SOCKET_SECONDS:-30}" \
  -e EDIT_INTERVAL_MS="${EDIT_INTERVAL_MS:-1000}" \
  -e TOPIC="${TOPIC:-concurrency}" \
  -e DIFFICULTY="${DIFFICULTY:-medium}" \
  grafana/k6:latest run - <dist/collab.bundle.js 2>&1 | tee dist/k6-summary.txt || status=$?

kill "$sampler" 2>/dev/null || true

# Read the socket count once more a few seconds after the run rather than
# taking the last sample: the samples at the end land mid-ramp-down, and the
# claim being made is that sockets return to zero once the last one closes,
# not that they were zero while people were still leaving.
sleep 10
settled=$(curl -fsS --max-time 3 "$COLLAB_METRICS")

# The server's own view, which is where the claims that do not depend on this
# machine's speed are read: no leaked sockets, and memory that comes back once
# the documents are gone.
awk -F, 'NR > 1 {
  if ($2 > peakConn) peakConn = $2
  if ($3 > peakRooms) peakRooms = $3
  if (!firstRss) { firstRss = $4; firstHeap = $5 }
  if ($4 > peakRss) peakRss = $4
  if ($5 > peakHeap) peakHeap = $5
} END {
  printf "\ncollab /metrics over the run\n"
  printf "  peak connections / rooms   %d / %d\n", peakConn, peakRooms
  printf "  rss  start / peak          %.0f / %.0f MB\n", firstRss / 1048576, peakRss / 1048576
  printf "  heap start / peak          %.0f / %.0f MB\n", firstHeap / 1048576, peakHeap / 1048576
}' "$CSV"
printf '  10s after the run          %s connections, %.0f MB rss, %.0f MB heap\n' \
  "$(metric collab_websocket_connections <<<"$settled")" \
  "$(($(metric process_resident_memory_bytes <<<"$settled") / 1048576))" \
  "$(($(metric nodejs_heap_size_used_bytes <<<"$settled") / 1048576))"
echo "  samples in load/$CSV"

exit "$status"
