export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Password-based auth: redirect to internal /login page instead of Manus OAuth.
// The returnPath parameter is kept for API compatibility but not used.
export const getLoginUrl = (_returnPath?: string): string => {
  return '/login';
};

// Manus OAuth URL - for users who prefer to sign in with their Manus account.
// Note: Manus OAuth may not be accessible in mainland China.
export const getManusOAuthUrl = (): string => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set('appId', appId);
  url.searchParams.set('redirectUri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('type', 'signIn');

  return url.toString();
};
