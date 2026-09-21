import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { RequireSession } from "./auth.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RequireSession>
      <App />
    </RequireSession>
  </React.StrictMode>
);

// PWA: registra el service worker para que la app abra sin wifi tras la 1ª vez
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("SW no registrado:", e));
  });
}
