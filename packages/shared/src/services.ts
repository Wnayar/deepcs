/**
 * The six deployables and the ports they listen on locally.
 *
 * Stats is one image run two ways: `index.ts` drains the event log and exits,
 * `server.ts` serves `GET /stats` and a session's summary. Only Stats can serve
 * those reads, because the rows live in the `stats` schema and only `stats_svc`
 * may read it. See docs/system/06-events-and-stats.md §5.
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
