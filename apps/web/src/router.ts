export const APP_ROUTES = {
  "/": { title: "Menu", label: "Main menu" },
  "/play": { title: "Play Cloud Hop", label: "Play" },
  "/dashboard": { title: "Dashboard", label: "Dashboard" },
  "/tournaments": { title: "Tournaments", label: "Tournaments" },
  "/leaderboard": { title: "Leaderboard", label: "Leaderboard" },
  "/profile": { title: "Player profile", label: "Profile" },
  "/how-it-works": { title: "How it works", label: "How it works" },
  "/settings": { title: "Settings", label: "Settings" },
} as const;

export type AppRoute = keyof typeof APP_ROUTES;
export type NavigationKind = "initial" | "push" | "replace" | "pop";

export interface RouteChange {
  readonly route: AppRoute;
  readonly kind: NavigationKind;
}

const routeSet = new Set<string>(Object.keys(APP_ROUTES));

export const normalizePathname = (pathname: string): string => {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
};

export const parseAppRoute = (pathname: string): AppRoute | null => {
  const normalized = normalizePathname(pathname);
  return routeSet.has(normalized) ? (normalized as AppRoute) : null;
};

export class AppRouter {
  readonly #onChange: (change: RouteChange) => void;
  #route: AppRoute = "/";
  #started = false;

  constructor(onChange: (change: RouteChange) => void) {
    this.#onChange = onChange;
  }

  get route(): AppRoute {
    return this.#route;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    window.addEventListener("popstate", this.#handlePopState);
    const requestedRoute = parseAppRoute(window.location.pathname);
    if (requestedRoute === null) {
      this.#route = "/";
      window.history.replaceState({ route: this.#route }, "", this.#route);
      this.#emit("replace");
      return;
    }
    this.#route = requestedRoute;
    window.history.replaceState({ route: this.#route }, "", window.location.href);
    this.#emit("initial");
  }

  navigate(route: AppRoute, options: { readonly replace?: boolean } = {}): void {
    if (!this.#started) this.start();
    if (route === this.#route && !options.replace) return;
    this.#route = route;
    if (options.replace) {
      window.history.replaceState({ route }, "", route);
      this.#emit("replace");
    } else {
      window.history.pushState({ route }, "", route);
      this.#emit("push");
    }
  }

  refresh(kind: NavigationKind = "replace"): void {
    this.#emit(kind);
  }

  destroy(): void {
    if (!this.#started) return;
    window.removeEventListener("popstate", this.#handlePopState);
    this.#started = false;
  }

  readonly #handlePopState = (): void => {
    const route = parseAppRoute(window.location.pathname) ?? "/";
    this.#route = route;
    this.#emit("pop");
  };

  #emit(kind: NavigationKind): void {
    this.#onChange({ route: this.#route, kind });
  }
}
