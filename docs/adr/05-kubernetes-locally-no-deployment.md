# Kubernetes locally, and no deployment at all

Context: the original plan
was Cloud Run for production with Kubernetes as a side detour. Decision:
invert it. The system runs on `kind` locally and is not deployed anywhere.
The reasoning is that the two claims worth making — no dropped requests
during a rolling update, and a killed pod costing a reconnect rather than any
edits — need an orchestrator and do not need a hosted one, while a live URL
needs a payment card the moment trial credits end. Rejected: a hosted cluster,
which bills by the hour whether or not anyone visits. Tradeoff accepted: nobody
can look at this without cloning it and running `make k8s-up`, and the measured
results in [../system/09-running-it.md](../system/09-running-it.md) carry that
weight instead.
