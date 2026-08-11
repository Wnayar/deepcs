#!/usr/bin/env bash
#
# The claims the cluster exists to make, measured. Run it with `make k8s-check`
# while the cluster is up; about three minutes.
#
# It exists because the k6 script cannot make this measurement. `load/collab.js`
# sends its HTTP in setup() and teardown() and holds WebSockets in between, so
# during the window a rolling update happens there are no requests in flight to
# drop. Counting dropped requests needs requests. So this sends a steady stream
# through the Ingress, disrupts the cluster underneath it, and counts what came
# back. The k6 run answers the other half — what a disruption does to a live
# collaboration socket — and the two together are the whole picture.
#
# Three scenarios, in increasing order of violence, because the claim is only
# worth anything if the point where it stops holding is stated too:
#
#   rolling update   kubectl rollout restart, every pod replaced
#   graceful kill    kubectl delete pod, the SIGTERM path
#   forced kill      kubectl delete pod --force --grace-period=0, no SIGTERM
#
# The first two are what Kubernetes does on purpose. The third is what a node
# running out of memory looks like, and nothing in this repo claims to survive
# it — it is here to show the difference the graceful path actually makes.
set -euo pipefail

CONTEXT=${CONTEXT:-kind-deepcs}
NAMESPACE=${NAMESPACE:-deepcs}
GATEWAY_URL=${GATEWAY_URL:-http://localhost:8090}

# One probe per identity, and the identity is the reason there are forty of
# them. The Gateway rate-limits an authenticated caller to 120 tokens refilling
# at 2 per second (services/gateway/src/rate-limit.ts), so one prober cannot
# sustain more than 2 requests a second without measuring the rate limiter
# instead of the rollout. Forty of them at roughly 1.6/s is about 65 requests a
# second, which puts a request on the wire every 15 ms — fine enough that an
# interruption of even a fraction of a second cannot hide between two of them.
PROBES=${PROBES:-40}
PROBE_INTERVAL=${PROBE_INTERVAL:-0.5}

# Quiet time either side of the disruption, so the count includes traffic from
# before it started and after it finished rather than only during.
SETTLE=${SETTLE:-5}

k() { kubectl --context "$CONTEXT" -n "$NAMESPACE" "$@"; }

if ! curl -fsS --max-time 5 "$GATEWAY_URL/roadmap" >/dev/null; then
  echo "the gateway is not answering $GATEWAY_URL — run 'make k8s-up' first" >&2
  exit 1
fi

OUT=$(mktemp -d)
cleanup() {
  pkill -P $$ curl 2>/dev/null || true
  rm -rf "$OUT"
}
trap cleanup EXIT

b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }

# A token in the shape the Auth emulator issues: `alg: none` and an empty
# signature. The Gateway checks iss, aud, exp and sub on this path and nothing
# else, which is what lets this script hold forty identities without an
# emulator round trip per probe. Same trick as load/collab.js.
mint() {
  local uid=$1 now exp
  now=$(date +%s)
  exp=$((now + 3600))
  printf '%s.%s.' \
    "$(printf '{"alg":"none","typ":"JWT"}' | b64url)" \
    "$(printf '{"iss":"https://securetoken.google.com/demo-deepcs","aud":"demo-deepcs","sub":"%s","iat":%d,"exp":%d}' \
      "$uid" "$now" "$exp" | b64url)"
}

# /roadmap rather than /health: a health endpoint is answered by the Gateway
# itself and would prove only that one process stayed up. This crosses the
# Ingress, the Gateway and Questions, so it fails if any hop in the chain is
# replaced badly.
#
# curl prints 000 for a connection that never produced a response, which is the
# failure mode this whole script is looking for — a refused connection, not an
# HTTP error.
probe() {
  local token=$1 file=$2
  while :; do
    curl -s -o /dev/null --max-time 5 -w '%{http_code}\n' \
      -H "authorization: Bearer $token" "$GATEWAY_URL/roadmap" >>"$file" 2>/dev/null || true
    sleep "$PROBE_INTERVAL"
  done
}

report() {
  local label=$1 dir=$2 elapsed=$3 total bad
  total=$(cat "$dir"/* 2>/dev/null | wc -l)
  bad=$(cat "$dir"/* 2>/dev/null | grep -cv '^200$' || true)

  printf '\n%s\n' "$label"
  printf '  disruption took     %ss\n' "$elapsed"
  printf '  requests            %s (about %s/s)\n' "$total" "$((total / (elapsed + 2 * SETTLE + 1)))"
  printf '  not 200             %s\n' "$bad"
  if [ "$bad" -gt 0 ]; then
    printf '  what came back      '
    cat "$dir"/* | grep -v '^200$' | sort | uniq -c | awk '{printf "%s×%s ", $1, $2}'
    printf '\n'
  fi
}

scenario() {
  local label=$1
  shift
  local dir="$OUT/${label// /-}"
  mkdir -p "$dir"

  local pids=()
  local i
  for i in $(seq 1 "$PROBES"); do
    probe "$(mint "probe-$i")" "$dir/$i" &
    pids+=($!)
  done

  sleep "$SETTLE"
  local started=$SECONDS
  "$@"
  local elapsed=$((SECONDS - started))
  sleep "$SETTLE"

  kill "${pids[@]}" 2>/dev/null || true
  wait "${pids[@]}" 2>/dev/null || true

  report "$label" "$dir" "$elapsed"
}

# Every pod of both Deployments replaced. `rollout restart` rather than an edit
# to a manifest because it is the same mechanism — it stamps an annotation on
# the pod template, which is exactly what `kubectl apply` of a changed image
# would do — without needing a change to apply.
rolling_update() {
  k rollout restart deployment/gateway deployment/questions >/dev/null
  k rollout status deployment/gateway --timeout=180s >/dev/null
  k rollout status deployment/questions --timeout=180s >/dev/null
}

# One pod, deleted the ordinary way: preStop runs, then SIGTERM, then the
# process has its grace period to finish what it was doing.
graceful_kill() {
  k delete "$(k get pods -l app=gateway -o name | head -1)" >/dev/null
  k rollout status deployment/gateway --timeout=180s >/dev/null
}

# The same pod, SIGKILLed. No preStop pause, so the endpoint removal has not
# propagated when the process disappears, and whatever the Ingress sends in
# that window has nowhere to land.
forced_kill() {
  k delete "$(k get pods -l app=gateway -o name | head -1)" --force --grace-period=0 >/dev/null 2>&1
  k rollout status deployment/gateway --timeout=180s >/dev/null
}

echo "probing $GATEWAY_URL/roadmap with $PROBES identities"

scenario 'rolling update' rolling_update
scenario 'graceful kill' graceful_kill
scenario 'forced kill' forced_kill

echo
echo 'Every number above is this machine. What is not machine-dependent is the'
echo 'shape: the first two are a property of readiness probes and the preStop'
echo 'pause, and the third is what happens without them.'
