# The two commands you need to run deepcs locally, in the order you need them.
#
#   make up     the backend: Postgres, Redis, the Auth emulator and six services
#   make web    the frontend dev server on http://localhost:5173
#
# They are separate on purpose: `up` is a long-running Docker stack you start
# once and leave alone, `web` is a Vite server you restart constantly. Running
# both from one target would mean stopping the database to restart the UI.

.PHONY: up web down logs migrate test

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
# rather than mocks, which is DESIGN.md §8's rule.
test:
	pnpm -r test
