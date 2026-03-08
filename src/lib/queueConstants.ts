/** Max users allowed in the buy flow simultaneously */
export const MAX_CONCURRENT = 50;

/** Active buyers threshold to activate the queue */
export const QUEUE_THRESHOLD = 3;

/** How long a waiting entry lives without heartbeat (10 min) */
export const WAITING_TTL = 10 * 60 * 1000;

/** How long an admitted user has to start buying (5 min) */
export const ADMITTED_TTL = 5 * 60 * 1000;

/** Client heartbeat frequency (60s) */
export const HEARTBEAT_INTERVAL = 60_000;
