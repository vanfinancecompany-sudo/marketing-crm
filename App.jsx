export default function App() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f172a",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "Inter, sans-serif"
    }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "32px", marginBottom: "10px" }}>
          Control Centre
        </h1>

        <p style={{ opacity: 0.7, marginBottom: "30px" }}>
          Choose a system to open
        </p>

        <div style={{ display: "flex", gap: "20px", justifyContent: "center" }}>
          <a href="https://crm-roan-rho.vercel.app">
            <button style={btnStyle}>
              Main CRM
            </button>
          </a>

          <a href="https://marketing-crm-six.vercel.app">
            <button style={btnStyle}>
              Marketing CRM
            </button>
          </a>
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  padding: "14px 24px",
  borderRadius: "10px",
  border: "none",
  background: "#2563eb",
  color: "#fff",
  fontSize: "16px",
  cursor: "pointer"
};
