import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import SingleActiveTabGate from "./components/SingleActiveTabGate.jsx";
import "./styles.css";
import "./utils/overnightAutoRefreshPause.js";
import "./utils/postingVisibilityStateAutoSync.js";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SingleActiveTabGate>
      <App />
    </SingleActiveTabGate>
  </React.StrictMode>
);
