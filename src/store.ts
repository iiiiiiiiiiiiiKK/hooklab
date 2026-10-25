const KEY = "hooklab.sessions.v1";

export interface StoredEndpoint {
  id: string;
  token: string;
  name: string;
  ingestUrl: string;
  createdAt: number;
}

type SessionMap = Record<string, StoredEndpoint>;

function readAll(): SessionMap {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SessionMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map: SessionMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* storage may be unavailable (private mode); the console still works per-tab */
  }
}

export const sessionStore = {
  list(): StoredEndpoint[] {
    return Object.values(readAll()).sort((a, b) => b.createdAt - a.createdAt);
  },
  get(id: string): StoredEndpoint | null {
    return readAll()[id] ?? null;
  },
  save(entry: StoredEndpoint) {
    const map = readAll();
    map[entry.id] = entry;
    writeAll(map);
  },
  update(id: string, patch: Partial<StoredEndpoint>) {
    const map = readAll();
    if (!map[id]) return;
    map[id] = { ...map[id], ...patch };
    writeAll(map);
  },
  remove(id: string) {
    const map = readAll();
    delete map[id];
    writeAll(map);
  },
};

export const PREF_KEYS = {
  pollIntervalMs: 3000,
};
