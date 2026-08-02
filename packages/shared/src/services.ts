/**
 * The six deployables (DESIGN.md §3) and the ports they listen on locally.
 *
 * Stats has no port: it is a job, not a server (DESIGN.md §5). Cloud Scheduler
 * starts it, it drains the event log, it exits — there is nothing for a port to
 * be attached to. It is in this list because CI and compose still need to know
 * it exists.
 */
export const SERVICES = {
  gateway: { port: 8080 },
  users: { port: 8081 },
  questions: { port: 8082 },
  matching: { port: 8083 },
  collab: { port: 8084 },
  stats: { port: null },
} as const;

export type ServiceName = keyof typeof SERVICES;
