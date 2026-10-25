import { useCallback, useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "endpoint"; id: string }
  | { name: "request"; id: string; requestId: string }
  | { name: "replay"; id: string; requestId?: string }
  | { name: "settings"; id: string }
  | { name: "notfound"; path: string };

export function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "home" };
  if (parts[0] === "e" && parts[1]) {
    const id = parts[1];
    if (parts.length === 2) return { name: "endpoint", id };
    if (parts[2] === "r" && parts[3]) return { name: "request", id, requestId: parts[3] };
    if (parts[2] === "replay") return { name: "replay", id, requestId: parts[3] };
    if (parts[2] === "settings") return { name: "settings", id };
  }
  return { name: "notfound", path: pathname };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return route;
}

export function navigate(to: string, replace = false) {
  if (to === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState({}, "", to);
  else window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

export function Link({
  to,
  children,
  className,
  onClick,
  ...rest
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const handle = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      onClick?.();
      navigate(to);
    },
    [to, onClick],
  );
  return (
    <a href={to} className={className} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
