# The Firebase Auth emulator ships as a Java jar wrapped by the Node CLI, so
# this image needs both runtimes. Google publishes no official emulator image.
#
# Why run it at all when Firebase Auth is free (D4 in the phase-0 pre-brief):
# it keeps local dev and CI offline, it can mint tokens for arbitrary test
# users (which the real thing will not), and it preserves the property that one
# command runs the whole system (DESIGN.md §7).
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
CMD ["firebase", "emulators:start", "--only", "auth", "--project", "demo-deepcs"]
