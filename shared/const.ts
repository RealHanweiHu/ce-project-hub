export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

// ─────────────────────────────────────────────────────────────────────────────
// Changelog enums — single source of truth, shared between frontend and backend.
// Backend uses these via drizzle/schema.ts (which defines the same arrays).
// Frontend imports from here to avoid duplicating enum values in data.ts.
// ─────────────────────────────────────────────────────────────────────────────
export { CHANGE_TYPES, CHANGE_STATUSES } from "../drizzle/schema";
export type { ChangeType, ChangeStatus } from "../drizzle/schema";
