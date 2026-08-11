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
#
# The six variables below are why this target is not simply `pnpm -r test`.
# Every integration suite is guarded on one of them with
#   describe.skipIf(!process.env.CI && process.env.X === undefined)
# so that a checkout with nothing running still passes instead of failing with
# connection errors. CI sets CI=true and gets all of them; locally, without
# these, `make test` silently skipped 42 of the 140 tests and reported success
# for the 98 that are left — a green run that had not touched a database.
#
# Values, not just presence: the suites connect to them. These are compose's
# published ports on the host, which is where the tests run.
#
# `?=` inside the shell rather than in make, so an environment that already
# names one of these wins. Pointing the suites at a different database is a
# reasonable thing to want; having them quietly not run is not.
TEST_ENV = \
	DATABASE_URL="$${DATABASE_URL:-postgresql://deepcs:deepcs@127.0.0.1:5432/deepcs}" \
	REDIS_URL="$${REDIS_URL:-redis://127.0.0.1:6379}" \
	USERS_URL="$${USERS_URL:-http://127.0.0.1:8081}" \
	QUESTIONS_URL="$${QUESTIONS_URL:-http://127.0.0.1:8082}" \
	MATCHING_URL="$${MATCHING_URL:-http://127.0.0.1:8083}" \
	VITE_GATEWAY_URL="$${VITE_GATEWAY_URL:-http://127.0.0.1:8080}"

# What the suites actually drive. The last one is the Gateway rather than its
# health endpoint on purpose: `/roadmap` crosses the Gateway, Questions and
# Postgres and returns seeded rows, so it answers "is the chain up and
# migrated", which no single /health/ready can.
TEST_WAIT_URLS = \
	http://127.0.0.1:8081/health/ready \
	http://127.0.0.1:8082/health/ready \
	http://127.0.0.1:8083/health/ready \
	http://127.0.0.1:8084/health/ready \
	http://127.0.0.1:8080/roadmap

# `make up` returns once compose has created the containers, which is several
# seconds before the Node process inside each one is listening. Running the two
# back to back without this wait fails the frontend suites, which drive the
# whole chain and assert on timing. That was invisible until the variables
# above stopped those suites from skipping.
test:
	@for url in $(TEST_WAIT_URLS); do \
		i=0; \
		until curl -fsS --max-time 2 "$$url" >/dev/null 2>&1; do \
			i=$$((i + 1)); \
			if [ $$i -ge 60 ]; then \
				echo "timed out waiting for $$url - is 'make up' running?" >&2; \
				exit 1; \
			fi; \
			sleep 1; \
		done; \
	done
	$(TEST_ENV) pnpm -r test

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
