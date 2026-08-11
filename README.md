# deepcs

Learn CS fundamentals from a roadmap, then check yourself against the
questions. Nine topics laid out by what makes what easier to read; each one
opens into three steps, and a step is a lesson plus the questions it prepares
you for. Answer them alone, or get matched with someone and work through them
in a shared editor.

See [the overview](docs/system/00-overview.md) for the architecture and the reasoning behind it.

## How to run it

```bash
make up      # the backend: Postgres, Redis, the Auth emulator, six services
make web     # the frontend on http://localhost:5173
make test    # the suites, against the real Postgres and Redis
make load    # the k6 load run against the running stack
```

From phase 8 there is also a local Kubernetes cluster (`make k8s-up`), which is
where rolling updates and pod failure are demonstrated.

## There is no deployed version, and that is a decision

This runs on your machine and nowhere else. The deployment was designed (§7 of
The overview) and priced line by line ([docs/cost.md](docs/cost.md)) before being
declined: keeping a demo online past a free trial means attaching a payment card
to it, and the behaviours worth showing — a rolling update that drops no
requests, a killed pod that interrupts nobody — need an orchestrator rather than
a hosted one. Knowing what it would cost, and why, is the deliverable.
