# Kubernetes locally, and no deployment at all

Context: the original plan
was Cloud Run for production with Kubernetes as a side detour. Decision:
invert it. The system runs on `kind` locally and is not deployed anywhere.
The reasoning is that the two claims worth making — no dropped requests
during a rolling update, no interruption when a pod is killed — need an
orchestrator and do not need a hosted one, while a live URL needs a payment
card the moment trial credits end. Rejected: a hosted cluster, which bills by
the hour whether or not anyone visits. Tradeoff accepted: nobody can look at
this without cloning it, and the demo recording in the README carries that
weight instead.
