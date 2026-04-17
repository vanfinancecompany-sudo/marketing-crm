export default function App() {
  return (
    <div style={{ padding: 24, fontFamily: "Inter, sans-serif" }}>
      <h1>Control Centre</h1>
      <p>This is the Control Centre app.</p>

      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <a
          href="https://crm-b5po.vercel.app"
          target="_blank"
          rel="noopener noreferrer"
        >
          Main CRM
        </a>

        <a
          href="https://marketing-crm-six.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Marketing CRM
        </a>
      </div>
    </div>
  );
}
