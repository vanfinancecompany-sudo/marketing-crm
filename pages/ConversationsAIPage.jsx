import { useEffect, useMemo, useState } from "react";
import { clearMarketingAccessKey, getStoredMarketingAccessKey, isMarketingAccessDenied, MARKETING_ACCESS_HEADER, saveMarketingAccessKey, validateMarketingAccessKey } from "../services/marketingAccess.js";

const CHANNEL_LABELS = { ask_me: "Ask Me (websites)", facebook_marketplace: "Facebook Marketplace", facebook_page: "Facebook Page Messenger", whatsapp: "WhatsApp" };
const STATUS_TEXT = {
  healthy: ["Healthy", "notice--success"], degraded: ["Needs attention", "notice--warning"], offline: ["Offline", "notice--error"],
  never_reported: ["Not reporting yet", "notice--warning"], not_configured: ["Monitoring not configured", "notice--warning"],
  not_connected: ["Not connected", ""], unavailable: ["Data unavailable", "notice--warning"],
};
const KIND_TEXT = { received: "Received", answered: "Answered", manual_answered: "Manual reply observed", needs_human: "Needs a person", send_failed: "Send failed", ai_failed: "AI failed" };
const fmt = (value) => (value ? new Date(value).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—");
const num = (value) => (value === null || value === undefined ? "Not available" : Number(value).toLocaleString());

function StatusBadge({ status }) {
  const [text, cls] = STATUS_TEXT[status] || [status, ""];
  return <span className={`notice ${cls}`} style={{ display: "inline-block", padding: "2px 10px", margin: 0 }}>{text}</span>;
}

function Metric({ label, value }) {
  return <div className="competence-metric"><span>{label}</span><strong>{value}</strong></div>;
}

const RENEWAL_STATUS = {
  queued: "Queued: open, check and prepare", preparing: "Browser draft or result pending", submitted: "Submission confirmed (awaiting acceptance check)", accepted: "Accepted on Facebook",
  awaiting_approval: "Awaiting admin approval", declined: "Declined by the group", skipped: "Skipped", failed: "Failed", needs_attention: "Needs manual attention", stopped: "Stopped (account problem)",
};

const RENEWAL_HEALTH = {
  healthy: "Healthy", processing: "Processing", paused: "Paused", disabled: "Disabled",
  waiting: "Waiting for first heartbeat", disconnected: "Browser disconnected", stalled: "Stalled",
  missed_run: "Daily run missed", publication_failures: "Repeated publication failures", restricted: "Account restriction",
};
const renewalTime = (value) => value ? new Date(value).toLocaleString("en-GB", {
  timeZone: "Europe/London", dateStyle: "short", timeStyle: "short",
}) : "—";

function RenewalAdvertHistory({ entries }) {
  if (!entries?.length) return null;
  return <details>
    <summary>Advert history ({entries.length} records in the last 14 days)</summary>
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead><tr><th>Group</th><th>Vehicle</th><th>Mode</th><th>Posted (UK time)</th><th>Outcome</th><th>Outcome recorded (UK time)</th><th>Reason</th></tr></thead>
        <tbody>{entries.map((entry) => <tr key={entry.id}>
          <td><a href={entry.url} target="_blank" rel="noreferrer">{entry.name}</a></td>
          <td>{entry.registration || "—"}</td>
          <td>{entry.mode === "automatic" ? "Automatic" : "Manual"}</td>
          <td>{renewalTime(entry.postedAt)}</td>
          <td>{RENEWAL_STATUS[entry.status] || entry.status}</td>
          <td>{renewalTime(entry.outcomeAt)}</td>
          <td>{entry.reason || "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}
function RenewalsPanel({ data, error, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [maxDaily, setMaxDaily] = useState("");
  async function post(body, confirmText) {
    if (busy || (confirmText && !window.confirm(confirmText))) return;
    setBusy(true);
    try {
      const response = await fetch("/api/rent2buy-group-renewals", { method: "POST", headers: { "Content-Type": "application/json", [MARKETING_ACCESS_HEADER]: getStoredMarketingAccessKey() }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) window.alert(result.error || "Not saved.");
      onChanged();
    } finally { setBusy(false); }
  }
  const latest = data?.latest;
  const isToday = latest && latest.date === data.today;
  return (
    <section className="panel"><div className="panel__header"><div><div className="eyebrow">Rent2Buy · Facebook Groups</div><h3>Rent2Buy Group Renewal Agent</h3>
      <p>Daily 07:00 GMT renewal queue for previously accepted Rent2Buy group adverts.</p></div></div>
      {error ? <div className="notice notice--warning">{error}</div> : null}
      {!data ? (!error ? <p>Loading renewal status…</p> : null) : <>
        <div className="competence-metrics">
          <Metric label="Agent health" value={RENEWAL_HEALTH[data.agent?.health] || "Unavailable"} />
          <Metric label="Last heartbeat (UK time)" value={renewalTime(data.agent?.lastHeartbeatAt)} />
          <Metric label="Last daily run (UK time)" value={renewalTime(latest?.checkedAt)} />
          <Metric label="Next scheduled run (UK time)" value={renewalTime(data.nextRunAt)} />
        </div>
        {data.agent?.restriction ? <p className="notice notice--warning">{data.agent.restriction}</p> : null}
        <p>
          <label><input type="checkbox" checked={data.settings.enabled} disabled={busy} onChange={(e) => post({ action: "settings", enabled: e.target.checked }, e.target.checked ? "Enable the daily renewal queue?" : "Disable the daily renewal queue?")} /> Daily renewals enabled</label>
          {" · "}Max per day{" "}
          <input type="number" min="1" max="30" style={{ width: 60 }} value={maxDaily || data.settings.maxDaily} disabled={busy} onChange={(e) => setMaxDaily(e.target.value)} onBlur={() => maxDaily && Number(maxDaily) !== data.settings.maxDaily && post({ action: "settings", maxDaily: Number(maxDaily) }).then(() => setMaxDaily(""))} />
        </p>
        {latest ? <>
          <div className="competence-metrics">
            <Metric label="Groups due" value={latest.due} /><Metric label="In queue" value={latest.queued} /><Metric label="Processed" value={latest.processed} />
            <Metric label="Confirmed submissions" value={latest.confirmedSubmissions} /><Metric label="Accepted" value={latest.accepted} />
            <Metric label="Pending approvals" value={latest.awaitingApproval} /><Metric label="Failures" value={latest.failures} /><Metric label="Groups requiring attention" value={latest.needsAttention} />
          </div>
          {latest.stopped ? <div className="notice notice--warning">Stopped {fmt(latest.stopped.at)}: {latest.stopped.reason}</div> : null}
          <details><summary>Queue for {latest.date} ({latest.queued})</summary><div className="competence-report-list">{latest.groups.map((g) => (
            <div key={g.groupKey}><strong><a href={g.url} target="_blank" rel="noreferrer">{g.name}</a></strong> · {RENEWAL_STATUS[g.status] || g.status}{g.reason ? ` (${g.reason})` : ""}
              {g.status === "queued" && g.issues.length ? <p>Check first: {g.issues.join(" · ")}</p> : null}
              {isToday && g.status === "queued" && !latest.stopped ? <p>
                <button type="button" className="button button--small" disabled={busy} onClick={() => post({ action: "outcome", groupUrl: g.url, status: "skipped", reason: window.prompt("Reason for skipping (e.g. group unavailable, membership required)?") || "" })}>Skip</button>{" "}
                <button type="button" className="button button--small" disabled={busy} onClick={() => post({ action: "outcome", groupUrl: g.url, status: "needs_attention", reason: window.prompt("What needs attention (e.g. publication not confirmed)?") || "" })}>Needs attention</button>
              </p> : null}
            </div>))}</div></details>
          {isToday && !latest.stopped ? <p><button type="button" className="button button--small" disabled={busy} onClick={() => post({ action: "stop", reason: window.prompt("Account restriction or security challenge details?") || "Account problem" }, "Stop all remaining renewals today?")}>Stop today (account problem)</button></p> : null}
          <details><summary>Daily renewal history</summary>{data.history.map((h) => <p key={h.date}>{h.date}: {h.confirmedSubmissions} confirmed / {h.queued} queued · {h.accepted} accepted · {h.awaitingApproval} awaiting · {h.skippedOrFailed} skipped/failed · {h.needsAttention} attention{h.stopped ? " · stopped" : ""}</p>)}</details>
        </> : <p>No daily run recorded yet.</p>}
        <RenewalAdvertHistory entries={data.advertHistory} />
      </>}
    </section>
  );
}

export default function ConversationsAIPage() {
  const [accessStatus, setAccessStatus] = useState(() => (getStoredMarketingAccessKey() ? "checking" : "locked"));
  const [accessKey, setAccessKey] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [days, setDays] = useState(7);
  const [viewAll, setViewAll] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [activityPage, setActivityPage] = useState(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [renewalData, setRenewalData] = useState(null);
  const [renewalError, setRenewalError] = useState("");

  async function refresh(range = days) {
    setError("");
    try {
      const response = await fetch(`/api/conversations-dashboard?days=${range}`, { headers: { [MARKETING_ACCESS_HEADER]: getStoredMarketingAccessKey() } });
      if (response.status === 401) { clearMarketingAccessKey(); setAccessStatus("locked"); return; }
      if (!response.ok) throw new Error("Dashboard data could not be loaded.");
      setData(await response.json());
      try {
        const renewal = await fetch("/api/rent2buy-group-renewals", { headers: { [MARKETING_ACCESS_HEADER]: getStoredMarketingAccessKey() } });
        if (!renewal.ok) throw new Error("Renewal reporting not available");
        setRenewalData(await renewal.json()); setRenewalError("");
      } catch (caught) { setRenewalError(caught.message); }
    } catch (caught) { setError(caught.message); }
  }

  useEffect(() => {
    const key = getStoredMarketingAccessKey();
    if (!key) { setAccessStatus("locked"); return undefined; }
    validateMarketingAccessKey(key).then(() => { setAccessStatus("unlocked"); refresh(); }).catch(() => { clearMarketingAccessKey(); setAccessStatus("locked"); });
    return undefined;
  }, []);
  useEffect(() => {
    if (accessStatus !== "unlocked") return undefined;
    const timer = setInterval(() => refresh(), 60_000);
    return () => clearInterval(timer);
  }, [accessStatus, days]);

  async function unlock(event) {
    event.preventDefault();
    try { await validateMarketingAccessKey(accessKey.trim()); saveMarketingAccessKey(accessKey.trim()); setAccessStatus("unlocked"); await refresh(); }
    catch (caught) { setError(isMarketingAccessDenied(caught) ? "Access key not recognised." : caught.message); setAccessStatus("locked"); }
  }

  const activity = useMemo(() => {
    if (!data) return [];
    const facebook = (data.activity || []).map((e) => ({ ...e, channel: e.channel }));
    const askMe = (data.channels.ask_me.recent || []).map((r) => ({ channel: "ask_me", kind: "answered", occurred_at: r.at, product: r.product, question_excerpt: r.question, reply_excerpt: r.reply }));
    return [...facebook, ...askMe].filter((e) => filter === "all" || e.channel === filter).sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at))).slice(0, 80);
  }, [data, filter]);

  // Detailed history is loaded only when requested. Search and paging run on
  // the server across retained Ask Me turns and Facebook events, not the
  // dashboard's short recent-activity preview.
  useEffect(() => {
    if (!viewAll || accessStatus !== "unlocked") return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setActivityLoading(true);
      setActivityError("");
      try {
        const params = new URLSearchParams({ days: String(days), page: String(page), channel: filter, search });
        const response = await fetch(`/api/conversations-activity?${params}`, {
          headers: { [MARKETING_ACCESS_HEADER]: getStoredMarketingAccessKey() },
          signal: controller.signal,
        });
        if (response.status === 401) { clearMarketingAccessKey(); setAccessStatus("locked"); return; }
        if (!response.ok) throw new Error("Conversation history could not be loaded.");
        if (!controller.signal.aborted) setActivityPage(await response.json());
      } catch (caught) {
        if (!controller.signal.aborted) setActivityError(caught.message);
      } finally {
        if (!controller.signal.aborted) setActivityLoading(false);
      }
    }, search ? 300 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [viewAll, accessStatus, filter, days, page, search, data?.generatedAt]);

  function collapseActivity() {
    setViewAll(false);
    setSearch("");
    setPage(1);
    setActivityPage(null);
  }

  if (accessStatus !== "unlocked") return <div className="page-stack"><section className="operations-summary competence-hero"><div><div className="eyebrow">Protected internal tool</div><h2>Conversations &amp; AI</h2><p>Use the established Marketing CRM access key.</p></div></section><form className="panel" onSubmit={unlock}><label className="field"><span className="field__label">Marketing CRM access key</span><input className="field__input" type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} /></label><button className="button button--primary">Unlock</button>{error ? <div className="notice notice--error">{error}</div> : null}</form></div>;

  const ch = data?.channels;
  const fb = ch?.facebook_marketplace;
  const openAlerts = (data?.alerts || []).filter((a) => a.status === "open");
  return <div className="page-stack">
    <section className="operations-summary competence-hero"><div><div className="eyebrow">Monitoring centre</div><h2>Conversations &amp; AI</h2><p>Ask Me website conversations, the Facebook Marketplace assistant and channel health in one place. Real data only; anything not available is labelled.</p></div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}><select className="field__input" value={days} onChange={(e) => { const d = Number(e.target.value); setDays(d); refresh(d); }}><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select><button className="button" onClick={() => refresh()}>Refresh</button><button className="button" onClick={async () => { await fetch("/api/conversations-monitor", { headers: { [MARKETING_ACCESS_HEADER]: getStoredMarketingAccessKey() } }); refresh(); }}>Run checks now</button></div></section>
    {error ? <div className="notice notice--error">{error}</div> : null}
    {!data ? <div className="panel">Loading…</div> : <>
      {!data.monitoringReady ? <div className="notice notice--warning">Monitoring storage is not set up yet (database migration pending). Ask Me data below is live; Facebook data appears once the migration is applied and the assistant reports.</div> : null}
      <section className="panel"><div className="panel__header"><div><div className="eyebrow">Alerts</div><h3>{openAlerts.length ? `${openAlerts.length} open alert${openAlerts.length === 1 ? "" : "s"}` : "No open alerts"}</h3></div></div>
        {openAlerts.map((a) => <div key={a.fingerprint} className={`notice ${a.severity === "critical" ? "notice--error" : a.severity === "warning" ? "notice--warning" : ""}`}><strong>{a.title}</strong>{a.detail ? <div>{a.detail}</div> : null}<small>Since {fmt(a.first_seen_at)} · last checked {fmt(a.last_seen_at)}{a.emailed_at ? " · emailed" : ""}</small></div>)}
        {(data.alerts || []).filter((a) => a.status === "resolved").slice(0, 5).map((a) => <div key={a.fingerprint} className="notice notice--success"><strong>Recovered: {a.title}</strong><small> {fmt(a.first_seen_at)} – {fmt(a.resolved_at)}</small></div>)}
      </section>
      <section className="panel"><div className="panel__header"><div><div className="eyebrow">Channels</div><h3>Service status</h3></div></div>
        <div className="competence-metrics">{Object.entries(CHANNEL_LABELS).map(([key, label]) => <div key={key} className="competence-metric"><span>{label}</span><strong><StatusBadge status={ch[key].status} /></strong><small>{key === "facebook_marketplace" ? `Last heartbeat: ${fmt(fb.lastHeartbeatAt)}` : ch[key].note || ""}</small></div>)}</div>
        {fb.detail ? <p className="muted">Facebook assistant: mode {fb.detail.mode || "—"} · list {fb.detail.list || "—"} · extension {fb.detail.extension || "—"} · account {fb.detail.accountLocked ? "locked to seller account" : "not locked"}{fb.detail.reasons?.length ? ` · ${fb.detail.reasons.join(" ")}` : ""}</p> : null}
      </section>
      <section className="panel"><div className="panel__header"><div><div className="eyebrow">Ask Me · websites</div><h3>Van Finance Company and Rent2Buy</h3></div></div>
        <div className="competence-metrics"><Metric label="Conversations" value={num(ch.ask_me.conversations)} /><Metric label="Questions" value={num(ch.ask_me.questions)} /><Metric label="AI replies" value={num(ch.ask_me.answers)} /><Metric label="Finance / Rent2Buy" value={ch.ask_me.byProduct ? `${ch.ask_me.byProduct.finance} / ${ch.ask_me.byProduct.rent2buy}` : "Not available"} /><Metric label="AI failures recorded" value={num(ch.ask_me.failures)} /><Metric label="Needing a person" value="Not recorded by Ask Me" /></div>
      </section>
      <section className="panel"><div className="panel__header"><div><div className="eyebrow">Facebook · Marketplace assistant</div><h3>Automatic replies</h3></div></div>
        <div className="competence-metrics"><Metric label="Received" value={num(fb.counts.received)} /><Metric label="Answered (delivery confirmed)" value={num(fb.counts.answered)} /><Metric label="Needing a person" value={num(fb.counts.needs_human)} /><Metric label="Send / confirmation failures" value={num(fb.counts.send_failed)} /><Metric label="Ask Me failures" value={num(fb.counts.ai_failed)} /><Metric label="Auto replies today (assistant)" value={num(fb.detail?.autoRepliesToday)} /></div>
      </section>
      <section className="panel"><div className="panel__header"><div><div className="eyebrow">Marketplace · reply tracking</div><h3>Finance and Rent2Buy</h3><p>Received and confirmed replies in the selected period; outstanding conversations across retained reporting history, including hand-offs. A reply outside the assistant may not yet be reported.</p></div></div>
      {fb.byProduct ? ["finance","rent2buy","unknown"].map(product => { const c=fb.byProduct[product]; return <div key={product}><h4>{product === "finance" ? "Van Finance Company" : product === "rent2buy" ? "Rent2Buy" : "Unclassified"}</h4><div className="competence-metrics"><Metric label="Received" value={num(c.received)} /><Metric label="AI replies confirmed" value={num(c.answered)} /><Metric label="Manual replies observed" value={num(c.manual_answered)} /><Metric label="Hand-offs" value={num(c.needs_human)} /><Metric label="Outstanding · all retained history" value={fb.outstanding === null ? "Not available" : num(c.outstanding)} /></div></div>; }) : <p>Product counts unavailable.</p>}
      {fb.outstanding === null ? <p className="notice notice--warning">Outstanding data unavailable; do not assume the inbox is clear.</p> : <details open={Boolean(fb.outstanding?.length)}><summary>Outstanding conversations ({fb.outstanding?.length || 0})</summary>{(fb.outstanding || []).map((e,i) => <p key={i}><strong>{e.product === "finance" ? "Finance" : e.product === "rent2buy" ? "Rent2Buy" : "Unclassified"} · {fmt(e.at)}</strong> · {KIND_TEXT[e.kind] || e.kind} · Ref {e.reference || "—"}{e.reason ? " · "+e.reason : ""}</p>)}</details>}
      </section>
      <RenewalsPanel data={renewalData} error={renewalError} onChanged={() => refresh(days)} />
      <section className="panel">
        <div className="panel__header">
          <div><div className="eyebrow">Recent activity</div><h3>Questions and AI replies</h3></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input className="field__input" aria-label="Search conversation questions and replies"
              style={{ width: 240, maxWidth: "100%" }} placeholder="Search questions or replies"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); setViewAll(true); }} />
            <select className="field__input" style={{ maxWidth: 220 }} value={filter}
              onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
              <option value="all">All channels</option>
              <option value="ask_me">Ask Me</option>
              <option value="facebook_marketplace">Facebook Marketplace</option>
            </select>
          </div>
        </div>
        {viewAll && activityError ? <div className="notice notice--error">{activityError}</div> : null}
        {viewAll && activityLoading && !activityPage ? <div className="notice">Loading conversation history…</div> : null}
        {(() => {
          const visible = viewAll ? (activityPage?.entries || []) : activity.filter(e => e.kind !== 'received').slice(0, 5);
          return visible.length ?
            <div className="competence-report-list">{visible.map((e, i) =>
              <div key={`${e.channel}-${e.occurred_at}-${e.sequence || 0}-${i}`}>
                <strong>{fmt(e.occurred_at)} · {CHANNEL_LABELS[e.channel] || e.channel} · {KIND_TEXT[e.kind] || e.kind}{e.product ? ` · ${e.product === "rent2buy" ? "Rent2Buy" : "Finance"}` : ""}</strong>
                {e.question_excerpt ? <p><b>Customer:</b> {e.question_excerpt}</p> : null}
                {e.reply_excerpt ? <p><b>AI reply:</b> {e.reply_excerpt}</p> : null}
                {e.reason ? <p><b>Note:</b> {e.reason}</p> : null}
              </div>
            )}</div> :
            <div className="notice">{viewAll && activityLoading ? "Loading…" : "No matching activity in this period."}</div>;
        })()}
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
          {!viewAll ? <button type="button" className="button" onClick={() => { setPage(1); setViewAll(true); }}>View all conversations</button> : <>
            <button type="button" className="button" onClick={collapseActivity}>Show less (latest 5)</button>
            {activityPage ? <>
              <span className="muted">{activityPage.total.toLocaleString()} matching entries · 20 per page</span>
              <button type="button" className="button" disabled={page <= 1 || activityLoading}
                onClick={() => setPage(Math.max(1, page - 1))}>Previous</button>
              {Array.from({ length: Math.min(5, activityPage.totalPages) }, (_, i) => {
                const first = Math.max(1, Math.min(activityPage.totalPages - 4, page - 2));
                const number = first + i;
                return <button type="button" key={number} className={number === page ? "button button--primary" : "button"}
                  aria-label={`Page ${number}`} disabled={activityLoading}
                  onClick={() => setPage(number)}>{number}</button>;
              })}
              <button type="button" className="button" disabled={page >= activityPage.totalPages || activityLoading}
                onClick={() => setPage(Math.min(activityPage.totalPages, page + 1))}>Next</button>
              <span className="muted">Page {activityPage.page} of {activityPage.totalPages}</span>
              {activityPage.truncated ? <span className="notice notice--warning">History limit reached. Narrow the date range to see older entries.</span> : null}
            </> : null}
          </>}
        </div>
      </section>
      <p className="muted">Updated {fmt(data.generatedAt)}. Excerpts are shortened and contact details are removed. Meta Muse and Facebook Page Messenger are future additions.</p>
    </>}
  </div>;
}
