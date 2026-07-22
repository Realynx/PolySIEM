export const NAVIGATION_START_EVENT = "polysiem:navigation-start";

/**
 * Announces a programmatic route change to the global navigation indicator.
 * Ordinary links are detected automatically by NavigationProgress.
 */
export interface NavigationStartDetail {
  pathname: string;
}

export function startNavigationFeedback(href?: string): void {
  if (typeof window === "undefined") return;
  const pathname = href ? new URL(href, window.location.href).pathname : window.location.pathname;
  window.dispatchEvent(
    new CustomEvent<NavigationStartDetail>(NAVIGATION_START_EVENT, { detail: { pathname } }),
  );
}

type NavigationOptions = { scroll?: boolean };

export function pushWithNavigationFeedback(
  router: { push: (href: string) => void },
  href: string,
): void {
  startNavigationFeedback(href);
  router.push(href);
}

export function replaceWithNavigationFeedback(
  router: { replace: (href: string, options?: NavigationOptions) => void },
  href: string,
  options?: NavigationOptions,
): void {
  startNavigationFeedback(href);
  router.replace(href, options);
}
