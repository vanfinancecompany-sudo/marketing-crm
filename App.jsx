import Sidebar from "./components/Sidebar";

export default function App() {
  return (
    <div style={{ display: "flex" }}>
      <Sidebar />
      <div style={{ padding: 20 }}>
        <h1>Control Centre</h1>
        <p>This is the Control Centre app</p>

        <a href="https://crm-b5po.vercel.app">
          Go to Main CRM
        </a>

        <br /><br />

        <a href="https://crm-b5po.vercel.app">
          Go to Marketing CRM
        </a>
      </div>
    </div>
  );
}
