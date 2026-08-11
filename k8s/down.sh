#!/usr/bin/env bash
#
# Deletes the kind cluster. Run it with `make k8s-down`.
#
# The whole cluster, not just the namespace, because the cluster is the thing
# `make k8s-up` creates: it takes the ingress controller, the loaded images and
# the node container with it, and leaves nothing running.
#
# To keep the cluster and restart only DeepCS — much faster, since the images
# stay loaded and the ingress controller stays up:
#
#   kubectl --context kind-deepcs delete namespace deepcs
#   make k8s-up
set -euo pipefail

CLUSTER=deepcs

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  kind delete cluster --name "$CLUSTER"
else
  echo "no cluster named '$CLUSTER'"
fi
