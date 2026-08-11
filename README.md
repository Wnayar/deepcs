# deepcs

Learn CS fundamentals from a roadmap, then check yourself against the
questions. Nine topics laid out by what makes what easier to read; each one
opens into three steps, and a step is a lesson plus the questions it prepares
you for. Answer them alone, or get matched with someone and work through them
in a shared editor.

See [DESIGN.md](DESIGN.md) for the architecture and the reasoning behind it.

## There is no live URL, and that is a decision

It runs locally: `make up` for the backend, `make web` for the frontend, and
from phase 8 on Kubernetes with `kubectl`. It is not deployed anywhere.

The Cloud Run deployment is specified in DESIGN.md §7 and priced line by line in
[docs/cost.md](docs/cost.md) — verified rates, how the free tier is actually
applied, and why an open WebSocket rather than a page view is the thing that
spends the budget. The conclusion was that keeping a demo online past the free
trial means attaching a payment card to it, which is a poor trade for something
`kubectl` can run on any laptop at no cost. Knowing what it would cost is the
deliverable; the URL is not.
