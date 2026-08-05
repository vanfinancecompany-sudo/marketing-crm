import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACTIVE_TAB_CHANNEL_NAME,
  ACTIVE_TAB_HEARTBEAT_MS,
  ACTIVE_TAB_LOCK_KEY,
  getTabId,
  isActiveTabLockFresh,
  readActiveTabLock,
  writeActiveTabLock,
} from "../utils/activeTabLock.js";

export default function SingleActiveTabGate({ children }) {
  const tabIdRef = useRef(getTabId());
  const channelRef = useRef(null);
  const [active, setActive] = useState(false);

  const claim = useCallback((force = false) => {
    const current = readActiveTabLock();
    if (!force && isActiveTabLockFresh(current) && current.tabId !== tabIdRef.current) {
      setActive(false);
      return false;
    }

    writeActiveTabLock(tabIdRef.current);
    const confirmed = readActiveTabLock()?.tabId === tabIdRef.current;
    setActive(confirmed);
    if (confirmed) {
      channelRef.current?.postMessage({ type: "claimed", tabId: tabIdRef.current });
    }
    return confirmed;
  }, []);

  useEffect(() => {
    const tabId = tabIdRef.current;
    let stopped = false;
    let heartbeatTimer = null;

    if (typeof BroadcastChannel !== "undefined") {
      channelRef.current = new BroadcastChannel(ACTIVE_TAB_CHANNEL_NAME);
      channelRef.current.onmessage = (event) => {
        if (event.data?.type === "claimed" && event.data.tabId !== tabId) {
          setActive(false);
        }
      };
    }

    claim(false);

    const heartbeat = () => {
      if (stopped) return;
      const current = readActiveTabLock();
      if (current?.tabId === tabId) {
        writeActiveTabLock(tabId);
        setActive(true);
      } else if (!isActiveTabLockFresh(current)) {
        claim(false);
      } else {
        setActive(false);
      }
      heartbeatTimer = window.setTimeout(heartbeat, ACTIVE_TAB_HEARTBEAT_MS);
    };
    heartbeatTimer = window.setTimeout(heartbeat, ACTIVE_TAB_HEARTBEAT_MS);

    const onStorage = (event) => {
      if (event.key !== ACTIVE_TAB_LOCK_KEY) return;
      const current = readActiveTabLock();
      if (!isActiveTabLockFresh(current)) claim(false);
      else setActive(current?.tabId === tabId);
    };
    window.addEventListener("storage", onStorage);

    const release = () => {
      const current = readActiveTabLock();
      if (current?.tabId === tabId) localStorage.removeItem(ACTIVE_TAB_LOCK_KEY);
    };
    window.addEventListener("pagehide", release);
    window.addEventListener("beforeunload", release);

    return () => {
      stopped = true;
      if (heartbeatTimer) window.clearTimeout(heartbeatTimer);
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
