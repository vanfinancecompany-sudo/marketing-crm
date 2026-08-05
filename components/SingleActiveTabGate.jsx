import { useCallback, useEffect, useRef, useState } from "react";

const LOCK_KEY = "marketing-crm-active-tab";
const CHANNEL_NAME = "marketing-crm-active-tab";
const HEARTBEAT_MS = 2000;
const STALE_AFTER_MS = 8000;

function createTabId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readLock() {
  try {
    const value = localStorage.getItem(LOCK_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (!parsed?.tabId || !Number.isFinite(parsed?.updatedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isFresh(lock) {
  return Boolean(lock && Date.now() - lock.updatedAt < STALE_AFTER_MS);
}

function writeLock(tabId) {
  const lock = { tabId, updatedAt: Date.now() };
  localStorage.setItem(LOCK_KEY, JSON.stringify(lock));
  return lock;
}

export default function SingleActiveTabGate({ children }) {
  const tabIdRef = useRef(createTabId());
  const channelRef = useRef(null);
  const [active, setActive] = useState(false);

  const claim = useCallback((force = false) => {
    const current = readLock();
    if (!force && isFresh(current) && current.tabId !== tabIdRef.current) {
      setActive(false);
      return false;
    }

    writeLock(tabIdRef.current);
    const confirmed = readLock()?.tabId === tabIdRef.current;
    setActive(confirmed);
    if (confirmed) {
      channelRef.current?.postMessage({ type: "claimed", tabId: tabIdRef.current });
    }
    return confirmed;
  }, []);

  useEffect(() => {
    const tabId = tabIdRef.current;
    if (typeof BroadcastChannel !== "undefined") {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current.onmessage = (event) => {
        if (event.data?.type === "claimed" && event.data.tabId !== tabId) {
          setActive(false);
        }
      };
    }

    claim(false);

    const heartbeat = window.setInterval(() => {
      const current = readLock();
      if (current?.tabId === tabId) {
        writeLock(tabId);
        setActive(true);
        return;
      }
      if (!isFresh(current)) claim(false);
      else setActive(false);
    }, HEARTBEAT_MS);

    const onStorage = (event) => {
      if (event.key !== LOCK_KEY) return;
      const current = readLock();
      setActive(current?.tabId === tabId);
    };
    window.addEventListener("storage", onStorage);

    const release = () => {
      const current = readLock();
      if (current?.tabId === tabId) localStorage.removeItem(LOCK_KEY);
    };
    window.addEventListener("pagehide", release);
    window.addEventListener("beforeunload", release);

    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", release);
      window.removeEventListener("beforeunload", release);
      release();
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, [claim]);

  if (active) return children;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#eef4ff",
        color: "#13213a",
      }}
    >
      <section
        className="panel"
        style={{ width: "min(560px, 100%)", textAlign: "center", padding: 32 }}
      >
        <div className="eyebrow">Marketing CRM safety lock</div>
        <h1 style={{ marginBottom: 12 }}>Another Marketing CRM tab is active</h1>
        <p style={{ marginBottom: 22 }}>
          This tab is paused so duplicate background requests cannot run. Close this tab,
          or transfer control here.
        </p>
        <button
          className="button button--primary"
          type="button"
          onClick={() => claim(true)}
        >
          Take over in this tab
        </button>
      </section>
    </main>
  );
}

export {
  CHANNEL_NAME,
  HEARTBEAT_MS,
  LOCK_KEY,
  STALE_AFTER_MS,
  isFresh,
  readLock,
  writeLock,
};
