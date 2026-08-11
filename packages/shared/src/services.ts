/**
 * The six deployables (DESIGN.md §3) and the ports they listen on locally.
 *
 * Stats is one image with two entrypoints, which is worth explaining because
 * §3 says flatly that it "can't be a server at all". That argument is about the
 * *trigger*: a timer cannot fire inside a scaled-to-zero service, so draining
 * the event log has to be a job. It does not follow that Stats can have no HTTP
 * surface, and something has to serve `GET /stats` and a session's summary,
 * which §2 and §6 both put in scope. No other service can: those rows live in
 * the `stats` schema and only `stats_svc` may read it (ADR-09).
 *
 * So: `job.ts` drains and exits, `index.ts` serves reads and scales to zero
 * like any other service. That is one image run two ways: as a scheduled job,
 * and as a long-lived server.
 */
export const SERVICES = {
  gateway: { port: 8080 },
  users: { port: 8081 },
  questions: { port: 8082 },
  matching: { port: 8083 },
  collab: { port: 8084 },
  stats: { port: 8085 },
} as const;

export type ServiceName = keyof typeof SERVICES;
