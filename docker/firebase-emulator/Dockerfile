# The Firebase Auth emulator ships as a Java jar wrapped by the Node CLI, so
# this image needs both runtimes. Google publishes no official emulator image.
#
# Why run it at all when Firebase Auth is free: it keeps local dev and CI
# offline, it can mint tokens for arbitrary test users (which the real thing
# will not), and it preserves the property that one command runs the whole
# system (docs/system/09-running-it.md).
FROM node:24-alpine

RUN apk add --no-cache openjdk21-jre-headless \
    && npm install -g firebase-tools@14

# Bake the emulator UI into the image. Without this the CLI downloads a ~10 MB
# zip on first start, which makes container startup depend on the network — and
# the reason for running an emulator at all is that local dev and CI do not.
RUN firebase setup:emulators:ui

WORKDIR /srv
COPY firebase.json ./

EXPOSE 9099 4000

# "demo-" is a magic prefix: the emulators refuse to contact production Google
# services for a project id starting with it, which is what makes this safe to
# run with no credentials present.
# Accounts survive a restart, which took three separate fixes to be true.
#
# The emulator keeps everything in memory and drops it on exit, so before this
# a `docker compose up --build` of anything that depends on it — the Gateway,
# usually — silently deleted every test account, and the next sign-in failed
# with `auth/user-not-found` for no visible reason.
#
# 1. `exec`, so the emulator is PID 1. Without it the shell holds the signal
#    Docker sends and the emulator is killed without ever being asked to stop.
# 2. STOPSIGNAL SIGINT, because `--export-on-exit` runs only on a SIGINT clean
#    exit. On SIGTERM the emulator shuts down tidily and writes nothing, which
#    looks identical from the outside.
# 3. Exporting into a *subdirectory* of the volume. The emulator clears its
#    export directory before writing, and a mount point cannot be unlinked —
#    aimed straight at the volume it fails with "Resource busy".
#
# `--import` is added only when an export exists: pointed at an empty directory
# the emulator refuses to start, which would break the very first run.
STOPSIGNAL SIGINT

CMD ["sh", "-c", "IMPORT=''; [ -f /srv/state/data/firebase-export-metadata.json ] && IMPORT=--import=/srv/state/data; exec firebase emulators:start --only auth --project demo-deepcs --export-on-exit=/srv/state/data $IMPORT"]
