import { useEffect, useMemo, useState } from "react";
import { clearMarketingAccessKey, getStoredMarketingAccessKey, isMarketingAccessDenied, MARKETING_ACCESS_HEADER, saveMarketingAccessKey, validateMarketingAccessKey } from "../services/marketingAccess.js";

const CHANNEL_LABELS = { ask_me: "Ask Me (websites)", facebook_marketplace: "Facebook Marketplace", facebook_page: "Facebook Page Messenger", whatsapp: "WhatsApp" };
const STATUS_TEXT = {
  healthy: ["Healthy", "notice--success"], degraded: ["Needs attention", "notice--warning"], offline: ["Offline", "notice--error"],
  never_reported: ["Not reporting yet", "notice--warning"], not_configured: ["Monitoring not configured", "notice--warning"],
  not_connected: ["Not connected", ""], unavailable: ["Data unavailable", "notice--warning"],
};
const KIND_TEXT = { received: "Received", answered: "Answered", needs_human: "Needs a person", send_failed: "Send failed", ai_failed: "AI failed" };
const fmt = (value) => (value ? new Date(value).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—");
const num = (value) => (value === null || value === undefined ? "Not available" : Number(value).toLocaleString());

function StatusBadge({ status }) {
  const [text, cls] = STATUS_TEXT[status] || [status, ""];
  return <span className={`notice ${cls}`} style={{ display: "inline-block", padding: "2px 10px", margin: 0 }}>{text}</span>;
}

function Metric({ label, value }) {
  return <div className="competence-metric"><span>{label}</span><strong>{value}</strong></div>;
}

export default function ConversationsAIPage() {
  const [accessStatus, setAccessStatus] = useState(() => (getStoredMarketingAccessKey() ? "checking" : "locked"));
  const [accessKey, setAccessKey] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [days, setDays] = useState(7);

  async function refresh(range = days) {
    setError("");
    try {
      const response = await fetch(`/api/conversations-dashboard?days=${range}`, { headers: { [MARKETING_ACCESS_HEADER]: getStoredMarketingAccessKey() } });
      if (response.status === 401) { clearMarketingAccessKey(); setAccessStatus("locked"); return; }
      if (!response.ok) throw new Error("Dashboard data could not be loaded.");
      setData(await response.json());
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

  if (accessStatus !== "unlocked") return <div className="page-stack"><section className="operations-summary competence-hero"><div><div className="eyebrow">Protected internal tool</div><h2>Conversations &amp; AI</h2><p>Use the established Marketing CRM access key.</p></div></section><form className="panel" onSubmit={unlock}><label className="field"><span className="field__label">Marketing CRM access key</span><input className="field__input" type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} /></label><button className="button button--primary">Unlock</button>{error ? <div className="notice notice--error">{error}</div> : null}</form></div>;

  const ch = data?.channels;
  const fb = ch?.facebook_marketplace;
  const openAlerts = (data?.alerts || []).filter((a) => a.status === "open");
  return <div className="page-stack">
    <section className="operations-summary competence-hero"><div><div className="eyebrow">Monitoring centre</div><h2>Conversations &amp; AI</h2><p>Ask Me website conversations, the Facebook Marketplace assistant and channel health in one place. Real data only; anything not available is labelled.</p></div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}><select className="field__input" value={days} onChange={(e) => { const d = Number(e.target.value); setDays(d); refresh(d); }}><option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select><button className="button" onClick={() => refresh()}>Refresh</button></div></section>
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
      <section className="panel"><div className="panel__header"><div><div className="eyebrow">Recent activity</div><h3>Questions and AI replies</h3></div>
        <select className="field__input" style={{ maxWidth: 240 }} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All channels</option><option value="ask_me">Ask Me</option><option value="facebook_marketplace">Facebook Marketplace</option></select></div>
        {activity.length ? <div className="competence-report-list">{activity.map((e, i) => <div key={i}><strong>{fmt(e.occurred_at)} · {CHANNEL_LABELS[e.channel] || e.channel} · {KIND_TEXT[e.kind] || e.kind}{e.product ? ` · ${e.product === "rent2buy" ? "Rent2Buy" : "Finance"}` : ""}</strong>{e.question_excerpt ? <p><b>Customer:</b> {e.question_excerpt}</p> : null}{e.reply_excerpt ? <p><b>AI reply:</b> {e.reply_excerpt}</p> : null}{e.reason ? <p><b>Note:</b> {e.reason}</p> : null}</div>)}</div> : <div className="notice">No activity in this period.</div>}
      </section>
      <p className="muted">Updated {fmt(data.generatedAt)}. Excerpts are shortened and contact details are removed. Meta Muse and Facebook Page Messenger are future additions.</p>
    </>}
  </div>;
}
