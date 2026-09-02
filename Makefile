# Shortcuts for the commands in package.json and CLAUDE.md. Nothing here is
# required: every target below is a pnpm script or a wrangler call you can run
# directly. There is deliberately no deploy target; see the note at the bottom.

.DEFAULT_GOAL := help

## List every target with what it does.
help:
	@awk '/^## / { desc = substr($$0, 4); next } /^[a-z][a-z0-9-]*:/ { if (desc != "") { split($$0, t, ":"); printf "  %-12s %s\n", t[1], desc; desc = "" } }' $(MAKEFILE_LIST)

## Install dependencies. Once per fresh checkout.
install:
	pnpm install

## Create the local D1 tables. Once per fresh checkout, and after a new migration.
migrate:
	npx wrangler d1 migrations apply deepcs --local

## Frontend only on :5173, hot reload, content ungated. The fast loop for UI work.
dev:
	pnpm dev

## The whole stack on :8787: real Worker, real local D1, the gate enforced.
run: build
	npx wrangler dev

## Build the SPA and the sample fixtures into dist/client.
build:
	pnpm build

## Build against the private content repo. Read back the topic count it prints.
build-real:
	CONTENT_DIR=../deepcs-content pnpm build

## Typecheck all four TypeScript projects.
types:
	pnpm typecheck

## Unit tests: pure logic, no runtime, milliseconds.
test:
	pnpm test

## Integration tests: the real Worker inside workerd, against a real local D1.
test-int:
	pnpm test:integration

## End-to-end tests: Chromium against a running wrangler dev.
test-e2e:
	pnpm test:e2e

## Everything CI runs, in CI's order. Green here means green there.
check: types test test-int test-e2e

## Unit coverage. No threshold is set; ADR-010 says why the number misleads.
coverage:
	pnpm test:coverage

## Delete build output, coverage, and Playwright artifacts.
clean:
	rm -rf dist coverage test-results playwright-report

## Fresh checkout to running: install, create tables, build.
setup: install migrate build

# No deploy target, on purpose. `wrangler deploy` from a local tree uploads
# whatever dist/ holds, which is the sample fixtures unless the build named
# CONTENT_DIR, and deploying that would replace every real lesson and lock out
# paying customers. The only deploy path is deploy.yml in the private
# deepcs-content repo (CLAUDE.md, Deploying).

.PHONY: help install migrate dev run build build-real types test test-int test-e2e check coverage clean setup
