#!/usr/bin/env bash
#
# Brings DeepCS up on a local kind cluster. Run it with `make k8s-up`.
#
# Expect five to ten minutes the first time and about a minute after that: the
# slow part is building seven images, and every layer but the last is cached.
#
# The order below is the whole script. Each step waits for the one before it,
# because Kubernetes has no equivalent of compose's
# `depends_on: condition: service_completed_successfully` — a Deployment
# applied before the schema exists comes up, answers its readiness probe with a
# cheerful SELECT 1, and serves queries against tables that are not there yet.
set -euo pipefail

cd "$(dirname "$0")/.."

CLUSTER=deepcs
NAMESPACE=deepcs

# Pinned rather than `main`. This is the kind-specific variant of the
# ingress-nginx manifest: it adds a nodeSelector for `ingress-ready=true` and
# tolerations for the control-plane taint, which is what lets the controller
# run on a single-node cluster and bind the node's port 80.
INGRESS_VERSION=${INGRESS_VERSION:-controller-v1.13.3}
INGRESS_MANIFEST="https://raw.githubusercontent.com/kubernetes/ingress-nginx/${INGRESS_VERSION}/deploy/static/provider/kind/deploy.yaml"

SERVICES=(gateway users questions matching collab stats)

# Every kubectl call is pinned to this cluster's context rather than switching
# the current one. `make k8s-up` should not silently repoint a kubectl that was
# aimed somewhere else.
k() { kubectl --context "kind-${CLUSTER}" "$@"; }

# ── 1. The cluster ───────────────────────────────────────────────────────────
if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "==> cluster '$CLUSTER' already exists, reusing it"
else
  echo "==> creating the cluster"
  kind create cluster --config k8s/kind-cluster.yaml
fi

# ── 2. The ingress controller ────────────────────────────────────────────────
# The label is applied here rather than through a kubeadm patch in
# kind-cluster.yaml. Both work; this one is a single line that cannot break
# when kubeadm changes the shape of its config file, and the manifest's
# nodeSelector reads it at scheduling time, so applying it first is enough.
echo "==> installing ingress-nginx"
k label node "${CLUSTER}-control-plane" ingress-ready=true --overwrite >/dev/null
k apply -f "$INGRESS_MANIFEST"
k -n ingress-nginx wait --for=condition=available deployment/ingress-nginx-controller --timeout=300s

# ── 3. The images ────────────────────────────────────────────────────────────
# The `runner` target, not `dev`: bundled dist/, production dependencies only,
# non-root. The dev target exists for compose's bind mounts, and nothing here
# is bind-mounted.
echo "==> building images"
for service in "${SERVICES[@]}"; do
  docker build --target runner --build-arg "SERVICE=${service}" -t "deepcs/${service}:local" .
done
docker build --target migrate -t deepcs/migrate:local .
docker build -t deepcs/firebase-auth:local docker/firebase-emulator

# There is no registry, so the images are pushed straight into the node's
# containerd. This is also why every manifest sets imagePullPolicy: IfNotPresent
# — these tags exist nowhere else, and the default of Always for an untagged
# image would send kubelet to Docker Hub looking for a repository nobody owns.
echo "==> loading images into the cluster"
images=(deepcs/migrate:local deepcs/firebase-auth:local)
for service in "${SERVICES[@]}"; do images+=("deepcs/${service}:local"); done
kind load docker-image --name "$CLUSTER" "${images[@]}"

# ── 4. Config, then the data tier ────────────────────────────────────────────
echo "==> applying config and the data tier"
k apply -f k8s/00-namespace.yaml -f k8s/01-config.yaml
k apply -f k8s/10-postgres.yaml -f k8s/11-redis.yaml -f k8s/12-firebase-auth.yaml
k -n "$NAMESPACE" wait --for=condition=available --timeout=300s \
  deployment/postgres deployment/redis deployment/firebase-auth

# ── 5. The schema ────────────────────────────────────────────────────────────
# Deleted first because a Job's pod template is immutable: `kubectl apply` over
# a Job that has already run is rejected rather than re-run. Deleting also
# means every `make k8s-up` starts from a known schema.
echo "==> applying migrations"
k -n "$NAMESPACE" delete job migrate --ignore-not-found >/dev/null
k apply -f k8s/20-migrate.yaml

# `wait --for=condition=complete` sits there until the timeout when the Job
# fails, so the failure condition is watched too and the logs are printed. A
# migration that failed silently for three minutes is the least useful way to
# find out the database is not there.
if ! k -n "$NAMESPACE" wait --for=condition=complete --timeout=180s job/migrate 2>/dev/null; then
  echo "migrations did not complete:" >&2
  k -n "$NAMESPACE" logs job/migrate >&2 || true
  exit 1
fi

# ── 6. The six services, the job, and the way in ─────────────────────────────
echo "==> applying services"
k apply -f k8s/30-gateway.yaml -f k8s/31-users.yaml -f k8s/32-questions.yaml \
  -f k8s/33-matching.yaml -f k8s/34-collab.yaml -f k8s/35-stats-api.yaml \
  -f k8s/40-stats-cronjob.yaml -f k8s/50-ingress.yaml

for deployment in gateway users questions matching collab stats-api; do
  k -n "$NAMESPACE" rollout status "deployment/${deployment}" --timeout=180s
done

echo
echo "gateway  http://localhost:8090"
echo "check    curl -s http://localhost:8090/roadmap | head -c 200"
echo "pods     kubectl --context kind-${CLUSTER} -n ${NAMESPACE} get pods"
