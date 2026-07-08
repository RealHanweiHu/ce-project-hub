export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Password-based auth: redirect to internal /login page.
export const getLoginUrl = (returnPath?: string): string => {
  if (!returnPath || !returnPath.startsWith("/") || returnPath.startsWith("//")) {
    return "/login";
  }
  const params = new URLSearchParams();
  params.set("redirect", returnPath);
  return `/login?${params.toString()}`;
};
