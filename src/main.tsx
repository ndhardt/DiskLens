import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { inTauri, installApi, type Api } from "./lib/api";
import "./styles/app.css";

async function start() {
  // Dev-only, and dynamically imported so the harness and its fixture data are
  // dropped from a production build rather than shipped inside the app.
  if (import.meta.env.DEV && !inTauri) {
    const { mockApi } = await import("./lib/mock");
    installApi(mockApi as unknown as Partial<Api>);
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void start();
