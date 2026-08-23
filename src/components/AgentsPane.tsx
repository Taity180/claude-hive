import { useEffect, useState } from "react";
import { fetchConnectionInfo, setAgentEnabled } from "../agentApi";
import { useHubStore } from "../stores/hubStore";
import { AppIcon } from "./AppIcon";
import type { ConnectionInfo } from "../types";

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch (err) {
          // A denied clipboard should not look like a broken button.
          console.error("[hive] clipboard write failed:", err);
        }
      }}
      className="shrink-0 text-[10.5px] rounded px-1.5 py-0.5"
      style={{
        background: "var(--hub-surface)",
        border: 0,
        color: "var(--hub-text)",
        cursor: "pointer",
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
      style={{ background: "var(--hub-surface)" }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[10px] font-semibold uppercase tracking-wide px-1"
      style={{ color: "var(--hub-text-dim)" }}
    >
      {children}
    </h2>
  );
}

export function AgentsPane() {
  const agents = useHubStore((s) => s.agents);
  const agentApps = useHubStore((s) => s.agentApps);
  const [connection, setConnection] = useState<ConnectionInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetchConnectionInfo().then((info) => {
      setConnection(info);
      setLoaded(true);
    });
  }, []);

  if (loaded && !connection) {
    return (
      <div className="p-3 text-[11px]" style={{ color: "var(--hub-text-muted)" }}>
        Could not reach Hive to read the connection details.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-3">
      <section className="flex flex-col gap-1.5">
        <SectionTitle>Connect an agent</SectionTitle>

        <Row>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px]" style={{ color: "var(--hub-text)" }}>
              MCP endpoint
            </span>
            <span
              data-testid="agents-endpoint"
              className="block text-[10px] font-mono truncate"
              style={{ color: "var(--hub-text-muted)" }}
            >
              {connection?.endpoint ?? "…"}
            </span>
          </span>
          {connection && <CopyButton label="Copy endpoint" value={connection.endpoint} />}
        </Row>

        {connection?.token && (
          <Row>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px]" style={{ color: "var(--hub-text)" }}>
                Token
              </span>
              <span
                data-testid="agents-token"
                className="block text-[10px] font-mono truncate"
                style={{ color: "var(--hub-text-muted)" }}
              >
                {connection.token}
              </span>
            </span>
            <CopyButton label="Copy token" value={connection.token} />
          </Row>
        )}

        {connection && (
          <div
            className="flex flex-col gap-1 px-2 py-1.5 rounded-lg"
            style={{ background: "var(--hub-surface)" }}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[11px]" style={{ color: "var(--hub-text)" }}>
                  Prompt block
                </span>
                <span className="block text-[10px]" style={{ color: "var(--hub-text-muted)" }}>
                  Paste into the agent&apos;s own instructions. Connecting alone will not
                  make it post &mdash; it gets the tools, not the intent.
                </span>
              </span>
              <CopyButton label="Copy prompt block" value={connection.promptBlock} />
            </span>
            <pre
              data-testid="agents-prompt"
              className="text-[9.5px] leading-snug whitespace-pre-wrap rounded p-2 m-0 max-h-32 overflow-y-auto"
              style={{ background: "rgba(0,0,0,0.24)", color: "var(--hub-text-muted)" }}
            >
              {connection.promptBlock}
            </pre>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <SectionTitle>Connected</SectionTitle>

        {agents.length === 0 && (
          <span className="text-[11px] px-2 py-1" style={{ color: "var(--hub-text-muted)" }}>
            No agents connected yet. They appear here on their first handshake &mdash;
            there is nothing to register.
          </span>
        )}

        {agents.map((agent) => {
          const apps = agentApps.filter((a) => a.agentId === agent.id);
          return (
            <div
              key={agent.id}
              data-testid="agent-row"
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
              style={{ background: "var(--hub-surface)" }}
            >
              <span className="min-w-0 flex-1">
                <span
                  className="block text-[12px] font-semibold"
                  style={{ color: "var(--hub-text)" }}
                >
                  {agent.name}
                </span>
                <span className="block text-[10px]" style={{ color: "var(--hub-text-muted)" }}>
                  {apps.length} app{apps.length === 1 ? "" : "s"}
                  {agent.version ? ` · v${agent.version}` : ""}
                </span>
              </span>

              <span className="flex items-center gap-1 shrink-0">
                {apps.slice(0, 4).map((app) => (
                  <AppIcon key={app.id} slug={app.id} label={app.label} size={12} />
                ))}
              </span>

              <button
                type="button"
                aria-label={`${agent.enabled ? "Mute" : "Unmute"} ${agent.name}`}
                onClick={() => void setAgentEnabled(agent.id, !agent.enabled)}
                className="shrink-0 text-[10.5px] rounded px-1.5 py-0.5"
                style={{
                  background: "var(--hub-surface)",
                  border: 0,
                  color: "var(--hub-text-muted)",
                  cursor: "pointer",
                }}
              >
                {agent.enabled ? "Mute" : "Unmute"}
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}
