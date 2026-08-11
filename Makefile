# The two commands you need to run deepcs locally, in the order you need them.
#
#   make up     the backend: Postgres, Redis, the Auth emulator and six services
#   make web    the frontend dev server on http://localhost:5173
#
# They are separate on purpose: `up` is a long-running Docker stack you start
# once and leave alone, `web` is a Vite server you restart constantly. Running
# both from one target would mean stopping the database to restart the UI.
#
# There is a second way to run the same system, on a local Kubernetes cluster:
#
#   make k8s-up     the whole stack on a kind cluster, gateway on :8090
#   make k8s-check  the disruption measurements, against a cluster that is up
#   make k8s-down   delete the cluster
#
# Compose is the one to develop against — it bind-mounts src/ and reloads. The
# cluster runs the production images and exists to show what compose cannot:
# rolling updates and pod failure. They publish different ports (8080 and 8090)
# so both can be up at once.

.PHONY: up web down logs migrate test load k8s-up k8s-check k8s-down

up:
	docker compose up -d --build
	@echo "gateway  http://localhost:8080"
	@echo "next     make web"

web:
	pnpm --filter @deepcs/web dev

down:
	docker compose down

logs:
	docker compose logs -f --tail=50

# `up` already migrates: compose runs a one-shot `migrate` service that every
# other service waits on. This target is for the case that does not cover —
# adding a migration while the stack is already running, when restarting
# everything to pick it up would be the long way round.
migrate:
	DATABASE_URL="postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs" pnpm --filter @deepcs/db migrate

# Needs `make up` first: the suites run against the real Postgres and Redis
# rather than mocks, which is the rule in docs/system/00-overview.md §8.
test:
	pnpm -r test

# The k6 load run. Needs `make up`, and takes about five minutes: it ramps 250
# collab sockets, holds them, and prints k6's client-side latency next to
# Collab's own socket count and memory.
load:
	./load/run.sh

# The same system on a local Kubernetes cluster. Needs `kind` and `kubectl`,
# and does not need `make up` — it is the other way to run the stack, not an
# addition to it. Five to ten minutes the first time (it builds seven images
# and pulls an ingress controller), about a minute after that.
k8s-up:
	./k8s/up.sh

# Counts dropped requests through a rolling update and a pod kill. Needs
# `make k8s-up`, and takes about three minutes. Not part of `make load`: that
# one measures collaboration sockets against compose, this one measures request
# survival against the cluster, and they answer different questions.
k8s-check:
	./k8s/disruption-check.sh

# Deletes the cluster outright. To restart only deepcs and keep the cluster,
# see the note at the top of k8s/down.sh.
k8s-down:
	./k8s/down.sh
