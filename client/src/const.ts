export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Password-based auth: redirect to internal /login page instead of Manus OAuth.
// The returnPath parameter is kept for API compatibility but not used.
export const getLoginUrl = (_returnPath?: string): string => {
  return '/login';
};
