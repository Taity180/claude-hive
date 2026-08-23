import React, { Component, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Rail } from "./Rail";
import { currentWindowLabel } from "./windowLabel";
import "./index.css";

// Hive and the Rail are two Tauri windows served from this one bundle, so the
// label decides which root mounts.
const windowLabel = currentWindowLabel();
const Root = windowLabel === "rail" ? Rail : App;

// Stylesheets need to know which window they are in: the rail's is transparent
// and must not paint a page-level ground, Hive's is opaque and must.
document.documentElement.dataset.window = windowLabel;

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: "#ef4444", background: "#141414", height: "100vh", fontFamily: "monospace" }}>
          <h2 style={{ color: "#e5e5e5" }}>Something went wrong</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 8 }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 10, color: "#777", marginTop: 8 }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: "8px 16px", background: "#60a5fa", color: "#0a0a0a", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
