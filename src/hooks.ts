import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type EndpointLimits, type EndpointView } from "./api";
import { sessionStore, type StoredEndpoint } from "./store";

export interface EndpointState {
  session: StoredEndpoint | null;
  endpoint: EndpointView | null;
  limits: EndpointLimits | null;
  stats: { storedRequests: number; replays: number; storedBytes: number; quotaBytes: number } | null;
  loading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
  setEndpoint: (e: EndpointView) => void;
  needsToken: boolean;
  attachToken: (token: string) => Promise<boolean>;
}

/**
 * Resolves the local session for an endpoint id and keeps the server view in sync.
 * A missing token is a first-class state (not an error page) so users can paste
 * a token they saved elsewhere.
 */
export function useEndpoint(id: string | undefined): EndpointState {
  const [session, setSession] = useState<StoredEndpoint | null>(id ? sessionStore.get(id) : null);
  const [endpoint, setEndpointView] = useState<EndpointView | null>(null);
  const [limits, setLimits] = useState<EndpointLimits | null>(null);
  const [stats, setStats] = useState<EndpointState["stats"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [tokenCheckDone, setTokenCheckDone] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    setSession(id ? sessionStore.get(id) : null);
    setTokenCheckDone(false);
  }, [id]);

  const load = useCallback(
    async (current: StoredEndpoint | null) => {
      if (!current) {
        setLoading(false);
        setTokenCheckDone(true);
        return;
      }
      try {
        const res = await api.getEndpoint(current.id, current.token);
        if (!aliveRef.current) return;
        setEndpointView(res.endpoint);
        setLimits(res.limits);
        setStats(res.stats);
        setError(null);
        sessionStore.update(current.id, { name: res.endpoint.name, ingestUrl: `${window.location.origin}${res.endpoint.ingestPath}` });
      } catch (err) {
        if (!aliveRef.current) return;
        if (err instanceof ApiError) {
          if (err.status === 401) {
            // Token no longer valid (endpoint deleted or rotated): drop the stale local session.
            setSession(null);
            setError(null);
            return;
          }
          setError(err);
        } else {
          setError(new ApiError("unknown", "Unexpected error.", 0));
        }
      } finally {
        if (aliveRef.current) {
          setLoading(false);
          setTokenCheckDone(true);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void load(session);
  }, [session, load]);

  const refresh = useCallback(async () => {
    await load(session);
  }, [load, session]);

  const attachToken = useCallback(
    async (token: string) => {
      if (!id) return false;
      const trimmed = token.trim();
      if (!trimmed) return false;
      try {
        const res = await api.getEndpoint(id, trimmed);
        sessionStore.save({
          id,
          token: trimmed,
          name: res.endpoint.name,
          ingestUrl: `${window.location.origin}${res.endpoint.ingestPath}`,
          createdAt: Date.now(),
        });
        setSession(sessionStore.get(id));
        setEndpointView(res.endpoint);
        setLimits(res.limits);
        setStats(res.stats);
        setError(null);
        setLoading(false);
        setTokenCheckDone(true);
        return true;
      } catch (err) {
        if (err instanceof ApiError) setError(err);
        return false;
      }
    },
    [id],
  );

  const needsToken = Boolean(id) && tokenCheckDone && !session;

  return {
    session,
    endpoint,
    limits,
    stats,
    loading,
    error,
    refresh,
    setEndpoint: setEndpointView,
    needsToken,
    attachToken,
  };
}

/** Poll a function on an interval, pausing while the tab is hidden. */
export function usePolling(fn: () => void, intervalMs: number, enabled = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      if (!document.hidden) fnRef.current();
      timer = window.setTimeout(tick, intervalMs);
    };
    timer = window.setTimeout(tick, intervalMs);

    const onVisible = () => {
      if (!document.hidden) fnRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, enabled]);
}
