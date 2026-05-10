import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { hydratePostingHiddenState, installPostingStateLocalStorageSync } from "./services/postingStateSync.js";

installPostingStateLocalStorageSync();
void hydratePostingHiddenState();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
