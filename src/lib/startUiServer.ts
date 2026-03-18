import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AgentScriptError from "./AgentScriptError.js";

type ProjectRecord = {
  cwd: string;
  cwdHash: string;
  lastActivity: string | null;
};

type SnapshotRecord = {
  file: string;
  path: string;
};

function getStateDir(): string {
  return path.join(os.homedir(), ".agentscript");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function json(response: http.ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function text(response: http.ServerResponse, statusCode: number, body: string, contentType = "text/plain; charset=utf-8"): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentType);
  response.end(body);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  const exists = await pathExists(filePath);
  if (!exists) {
    return [];
  }

  const contents = await fs.readFile(filePath, "utf8");
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function readProjects(): Promise<ProjectRecord[]> {
  const records = await readJsonlFile<ProjectRecord>(path.join(getStateDir(), "projects.jsonl"));
  const deduped = new Map<string, ProjectRecord>();
  for (const record of records) {
    deduped.set(record.cwdHash, {
      cwd: record.cwd,
      cwdHash: record.cwdHash,
      lastActivity: null
    });
  }

  const projects = await Promise.all(
    [...deduped.values()].map(async (project) => {
      const logs = await readLogs(project.cwdHash);
      const lastEvent = logs.length > 0 ? (logs[logs.length - 1] as { ts?: string }) : null;
      return {
        ...project,
        lastActivity: lastEvent?.ts ?? null
      };
    })
  );

  return projects.sort((left, right) => {
    const leftTime = left.lastActivity ?? "";
    const rightTime = right.lastActivity ?? "";
    if (leftTime !== rightTime) {
      return rightTime.localeCompare(leftTime);
    }

    return left.cwd.localeCompare(right.cwd);
  });
}

async function readLogs(cwdHash: string): Promise<unknown[]> {
  return readJsonlFile<unknown>(path.join(getStateDir(), "logs", `${cwdHash}.jsonl`));
}

async function readSnapshots(cwdHash: string): Promise<SnapshotRecord[]> {
  const directory = path.join(getStateDir(), "graphs", cwdHash);
  const exists = await pathExists(directory);
  if (!exists) {
    return [];
  }

  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => ({
      file: entry.name,
      path: path.join(directory, entry.name)
    }))
    .sort((left, right) => right.file.localeCompare(left.file));
}

function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AgentScript UI</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        background: #0b1020;
        color: #e5e7eb;
      }
      header {
        padding: 16px 20px;
        border-bottom: 1px solid #1f2937;
        background: #111827;
      }
      header h1 {
        margin: 0;
        font-size: 18px;
      }
      header p {
        margin: 4px 0 0;
        color: #9ca3af;
        font-size: 13px;
      }
      main {
        display: grid;
        grid-template-columns: 280px 360px 1fr;
        min-height: calc(100vh - 69px);
      }
      section {
        display: flex;
        flex-direction: column;
        border-right: 1px solid #1f2937;
        min-height: 0;
        min-width: 0;
      }
      section:last-child {
        border-right: 0;
      }
      .pane-title {
        padding: 12px 16px;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9ca3af;
        border-bottom: 1px solid #1f2937;
      }
      .list {
        flex: 1;
        overflow: auto;
        min-height: 0;
      }
      .item {
        padding: 12px 16px;
        border-bottom: 1px solid #111827;
        cursor: pointer;
      }
      .item:hover, .item.active {
        background: #111827;
      }
      .item small {
        display: block;
        color: #9ca3af;
        margin-top: 4px;
      }
      .item .timestamp {
        display: block;
        color: #9ca3af;
        font-size: 12px;
        margin-bottom: 6px;
      }
      .item .command-line {
        display: block;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 12px;
        color: #e5e7eb;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .item code {
        color: #93c5fd;
      }
      .item .status-ok {
        color: #86efac;
      }
      .item .status-fail {
        color: #fca5a5;
      }
      .detail {
        padding: 16px;
        flex: 1;
        overflow: auto;
        min-height: 0;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 8px;
        padding: 12px;
        font-size: 12px;
        line-height: 1.5;
        overflow: auto;
      }
      .meta {
        display: grid;
        grid-template-columns: 140px 1fr;
        gap: 8px 12px;
        font-size: 13px;
        margin-bottom: 16px;
      }
      .meta strong {
        color: #9ca3af;
      }
      .empty {
        padding: 16px;
        color: #9ca3af;
      }
      .toolbar {
        padding: 12px 16px;
        border-bottom: 1px solid #1f2937;
        font-size: 13px;
        color: #9ca3af;
      }
      .growth-panel {
        padding: 16px;
        border-bottom: 1px solid #1f2937;
        background: #0f172a;
      }
      .growth-summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 14px;
      }
      .growth-card {
        padding: 10px 12px;
        border: 1px solid #1f2937;
        border-radius: 8px;
        background: #111827;
      }
      .growth-card strong,
      .growth-selection strong {
        display: block;
        margin-bottom: 4px;
        font-size: 12px;
        color: #9ca3af;
      }
      .growth-card span {
        display: block;
        font-size: 18px;
        font-weight: 600;
        color: #f9fafb;
      }
      .growth-selection small {
        display: block;
        margin-top: 4px;
        color: #9ca3af;
        font-size: 12px;
      }
      .growth-legend {
        display: flex;
        gap: 16px;
        margin-top: 10px;
        color: #cbd5e1;
        font-size: 12px;
      }
      .growth-legend span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .growth-swatch {
        width: 10px;
        height: 10px;
        border-radius: 999px;
      }
      .growth-selection {
        margin-top: 12px;
        padding: 10px 12px;
        border: 1px solid #1f2937;
        border-radius: 8px;
        background: #111827;
        font-size: 13px;
      }
      .growth-axis {
        display: flex;
        justify-content: space-between;
        margin-top: 6px;
        color: #9ca3af;
        font-size: 12px;
      }
      .growth-chart {
        display: block;
        width: 100%;
        height: auto;
      }
      .growth-grid {
        stroke: #1f2937;
        stroke-width: 1;
      }
      .growth-line-nodes {
        fill: none;
        stroke: #60a5fa;
        stroke-width: 3;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .growth-line-edges {
        fill: none;
        stroke: #34d399;
        stroke-width: 3;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .growth-active-line {
        stroke: #f59e0b;
        stroke-width: 1.5;
        stroke-dasharray: 4 4;
      }
      .growth-active-node {
        fill: #60a5fa;
        stroke: #dbeafe;
        stroke-width: 2;
      }
      .growth-active-edge {
        fill: #34d399;
        stroke: #d1fae5;
        stroke-width: 2;
      }
      a {
        color: #93c5fd;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>AgentScript UI</h1>
      <p>Browse projects, command logs, and graph snapshots from <code>~/.agentscript</code>.</p>
    </header>
    <main>
      <section>
        <div class="pane-title">Projects</div>
        <div id="projects" class="list"></div>
      </section>
      <section>
        <div class="pane-title">Events</div>
        <div id="eventsToolbar" class="toolbar">Select a project.</div>
        <div id="growth" class="growth-panel">
          <div class="empty">Select a project to see how its graph changes over time.</div>
        </div>
        <div id="events" class="list"></div>
      </section>
      <section>
        <div class="pane-title">Detail</div>
        <div id="detail" class="detail">
          <div class="empty">Select an event to inspect stdin, stdout, stderr, and graph metadata.</div>
        </div>
      </section>
    </main>
    <script>
      const state = {
        activeEventTs: null,
        project: null,
        projects: [],
        events: []
      };

      function formatJson(value) {
        if (value === null || value === undefined || value === "") {
          return "<em>empty</em>";
        }
        if (typeof value === "string") {
          return '<pre>' + escapeHtml(value) + '</pre>';
        }
        return '<pre>' + escapeHtml(JSON.stringify(value, null, 2)) + '</pre>';
      }

      function escapeHtml(value) {
        return value
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      async function fetchJson(url) {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(await response.text());
        }
        return response.json();
      }

      function formatFriendlyTimestamp(value) {
        if (!value) {
          return "unknown time";
        }
        const date = new Date(value);
        return new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short"
        }).format(date);
      }

      function renderCommandLine(event) {
        const parts = ["agentscript", event.command];
        const flags = event.flags || {};

        Object.entries(flags).forEach(([key, value]) => {
          if (value === false || value === undefined || value === null || value === "") {
            return;
          }
          if (value === true) {
            parts.push("--" + key);
            return;
          }
          parts.push("--" + key, String(value));
        });

        (event.argv || []).forEach((arg) => {
          parts.push(String(arg));
        });

        return parts.join(" ");
      }

      function formatDelta(value) {
        if (value > 0) {
          return "+" + value;
        }
        if (value < 0) {
          return String(value);
        }
        return "0";
      }

      function createGrowthPoints(events) {
        return events
          .map((event, index) => {
            const nodeCount = Number(event && event.graph && event.graph.nodeCount);
            const edgeCount = Number(event && event.graph && event.graph.edgeCount);
            if (!Number.isFinite(nodeCount) || !Number.isFinite(edgeCount)) {
              return null;
            }

            const parsedTime = Date.parse(event.ts || "");
            return {
              command: event.command || "",
              edgeCount,
              index,
              nodeCount,
              time: Number.isFinite(parsedTime) ? parsedTime : index,
              ts: event.ts || ""
            };
          })
          .filter((point) => point !== null);
      }

      function renderGrowth() {
        const container = document.getElementById("growth");
        if (!state.project) {
          container.innerHTML = '<div class="empty">Select a project to see how its graph changes over time.</div>';
          return;
        }

        const points = createGrowthPoints(state.events);
        if (points.length === 0) {
          container.innerHTML = '<div class="empty">No graph history has been recorded for this project yet.</div>';
          return;
        }

        const width = 640;
        const height = 190;
        const padding = { top: 12, right: 12, bottom: 20, left: 12 };
        const innerWidth = width - padding.left - padding.right;
        const innerHeight = height - padding.top - padding.bottom;
        const maxValue = Math.max(
          1,
          ...points.map((point) => Math.max(point.nodeCount, point.edgeCount))
        );
        const yFor = (value) => padding.top + innerHeight - (value / maxValue) * innerHeight;
        const xFor = (index) => {
          if (points.length === 1) {
            return padding.left + innerWidth / 2;
          }
          return padding.left + (index / (points.length - 1)) * innerWidth;
        };
        const buildPath = (key) =>
          points
            .map((point, index) => (index === 0 ? "M" : "L") + xFor(index) + " " + yFor(point[key]))
            .join(" ");
        const gridLines = [0, 0.25, 0.5, 0.75, 1]
          .map((step) => {
            const y = padding.top + innerHeight - innerHeight * step;
            return '<line class="growth-grid" x1="' + padding.left + '" y1="' + y + '" x2="' + (width - padding.right) + '" y2="' + y + '"></line>';
          })
          .join("");
        const selectedPoint =
          points.find((point) => point.ts === state.activeEventTs) || points[points.length - 1];
        const selectedIndex = points.findIndex((point) => point.ts === selectedPoint.ts);
        const selectedX = xFor(selectedIndex);
        const firstPoint = points[0];
        const latestPoint = points[points.length - 1];

        container.innerHTML =
          '<div class="growth-summary">' +
            '<div class="growth-card">' +
              '<strong>Calls</strong>' +
              '<span>' + escapeHtml(String(points.length)) + '</span>' +
            '</div>' +
            '<div class="growth-card">' +
              '<strong>Nodes</strong>' +
              '<span>' + escapeHtml(String(latestPoint.nodeCount)) + '</span>' +
            '</div>' +
            '<div class="growth-card">' +
              '<strong>Edges</strong>' +
              '<span>' + escapeHtml(String(latestPoint.edgeCount)) + '</span>' +
            '</div>' +
          '</div>' +
          '<svg class="growth-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Project growth over time">' +
            gridLines +
            '<path class="growth-line-nodes" d="' + buildPath("nodeCount") + '"></path>' +
            '<path class="growth-line-edges" d="' + buildPath("edgeCount") + '"></path>' +
            '<line class="growth-active-line" x1="' + selectedX + '" y1="' + padding.top + '" x2="' + selectedX + '" y2="' + (height - padding.bottom) + '"></line>' +
            '<circle class="growth-active-node" cx="' + selectedX + '" cy="' + yFor(selectedPoint.nodeCount) + '" r="5"></circle>' +
            '<circle class="growth-active-edge" cx="' + selectedX + '" cy="' + yFor(selectedPoint.edgeCount) + '" r="5"></circle>' +
          '</svg>' +
          '<div class="growth-axis">' +
            '<span>' + escapeHtml(formatFriendlyTimestamp(firstPoint.ts)) + '</span>' +
            '<span>' + escapeHtml(formatFriendlyTimestamp(latestPoint.ts)) + '</span>' +
          '</div>' +
          '<div class="growth-legend">' +
            '<span><i class="growth-swatch" style="background:#60a5fa"></i> Nodes</span>' +
            '<span><i class="growth-swatch" style="background:#34d399"></i> Edges</span>' +
          '</div>' +
          '<div class="growth-selection">' +
            '<strong>Selected Event</strong>' +
            '<div>' + escapeHtml(formatFriendlyTimestamp(selectedPoint.ts)) + ' · ' + escapeHtml(selectedPoint.command || "unknown command") + '</div>' +
            '<small>' +
              'Nodes ' + escapeHtml(String(selectedPoint.nodeCount)) +
              ' · Edges ' + escapeHtml(String(selectedPoint.edgeCount)) +
              ' · Event ' + escapeHtml(String(selectedIndex + 1)) + ' of ' + escapeHtml(String(points.length)) +
            '</small>' +
          '</div>';
      }

      function renderProjects() {
        const container = document.getElementById("projects");
        if (state.projects.length === 0) {
          container.innerHTML = '<div class="empty">No projects logged yet.</div>';
          return;
        }

        container.innerHTML = state.projects.map((project) => {
          const active = state.project && state.project.cwdHash === project.cwdHash ? " active" : "";
          return '<div class="item' + active + '" data-project="' + escapeHtml(project.cwdHash) + '">' +
            '<code>' + escapeHtml(project.cwdHash) + '</code>' +
            '<small>' + escapeHtml(project.cwd) + '</small>' +
            '<small>' + escapeHtml(project.lastActivity || "no activity yet") + '</small>' +
          '</div>';
        }).join("");

        container.querySelectorAll("[data-project]").forEach((element) => {
          element.addEventListener("click", () => loadProject(element.getAttribute("data-project")));
        });
      }

      function renderEvents() {
        const toolbar = document.getElementById("eventsToolbar");
        const container = document.getElementById("events");
        if (!state.project) {
          toolbar.textContent = "Select a project.";
          container.innerHTML = '<div class="empty">No project selected.</div>';
          return;
        }

        toolbar.textContent = state.project.cwd;
        if (state.events.length === 0) {
          container.innerHTML = '<div class="empty">No events for this project.</div>';
          return;
        }

        const events = [...state.events];
        container.innerHTML = events.map((event, index) => {
          const active = state.activeEventTs === event.ts ? " active" : "";
          return '<div class="item' + active + '" data-event="' + index + '">' +
            '<span class="timestamp">' + escapeHtml(formatFriendlyTimestamp(event.ts)) + '</span>' +
            '<span class="command-line">' + escapeHtml(renderCommandLine(event)) + '</span>' +
          '</div>';
        }).join("");

        container.querySelectorAll("[data-event]").forEach((element) => {
          element.addEventListener("click", () => {
            const index = Number(element.getAttribute("data-event"));
            const event = events[index];
            state.activeEventTs = event ? event.ts : null;
            setLocationState(state.project ? state.project.cwdHash : null, event ? event.ts : null);
            renderGrowth();
            renderDetail(event);
            container.querySelectorAll(".item").forEach((node) => node.classList.remove("active"));
            element.classList.add("active");
          });
        });
      }

      async function renderDetail(event) {
        const container = document.getElementById("detail");
        const snapshots = await fetchJson('/api/graph-snapshots?cwdHash=' + encodeURIComponent(state.project.cwdHash));
        const latestSnapshot = snapshots[0] || null;

        container.innerHTML =
          '<div class="meta">' +
            '<strong>Command</strong><div>' + escapeHtml(event.command) + '</div>' +
            '<strong>Time</strong><div>' + escapeHtml(event.ts) + '</div>' +
            '<strong>Exit code</strong><div>' + escapeHtml(String(event.exitCode)) + '</div>' +
            '<strong>Duration</strong><div>' + escapeHtml(String(event.durationMs)) + 'ms</div>' +
            '<strong>Touched nodes</strong><div>' + escapeHtml((event.graph && event.graph.touchedNodes || []).join(", ") || "none") + '</div>' +
            '<strong>Graph hash</strong><div>' + escapeHtml(event.graph && event.graph.graphHash || "") + '</div>' +
            '<strong>Snapshot</strong><div>' +
              (latestSnapshot
                ? '<a href="/api/graph-snapshot?cwdHash=' + encodeURIComponent(state.project.cwdHash) + '&file=' + encodeURIComponent(latestSnapshot.file) + '" target="_blank" rel="noreferrer">' + escapeHtml(latestSnapshot.file) + '</a>'
                : 'none') +
            '</div>' +
          '</div>' +
          '<h3>stdin</h3>' + formatJson(event.stdin) +
          '<h3>stdout</h3>' + formatJson(event.stdout) +
          '<h3>stderr</h3>' + formatJson(event.stderr) +
          '<h3>flags</h3>' + formatJson(event.flags);
      }

      function getLocationState() {
        const params = new URLSearchParams(window.location.search);
        return {
          cwdHash: params.get("project"),
          eventTs: params.get("event")
        };
      }

      function setLocationState(cwdHash, eventTs) {
        const params = new URLSearchParams(window.location.search);
        if (cwdHash) {
          params.set("project", cwdHash);
        } else {
          params.delete("project");
        }
        if (eventTs) {
          params.set("event", eventTs);
        } else {
          params.delete("event");
        }
        const next = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
        window.history.replaceState(null, "", next);
      }

      async function loadProject(cwdHash) {
        state.project = state.projects.find((project) => project.cwdHash === cwdHash) || null;
        state.events = await fetchJson('/api/logs?cwdHash=' + encodeURIComponent(cwdHash));
        renderProjects();
        const { eventTs } = getLocationState();
        const defaultEvent = (eventTs && state.events.find((event) => event.ts === eventTs)) || state.events[state.events.length - 1] || null;
        state.activeEventTs = defaultEvent ? defaultEvent.ts : null;
        renderEvents();
        renderGrowth();

        if (defaultEvent) {
          setLocationState(cwdHash, defaultEvent.ts);
          renderDetail(defaultEvent);
          const nodes = [...document.querySelectorAll("#events .item")];
          nodes.forEach((node, index) => {
            node.classList.toggle("active", state.events[index] && state.events[index].ts === defaultEvent.ts);
          });
          const activeNode = nodes.find((node) => node.classList.contains("active"));
          activeNode?.scrollIntoView({ block: "end" });
          document.getElementById("events").scrollTop = document.getElementById("events").scrollHeight;
          return;
        }

        setLocationState(cwdHash, null);
        document.getElementById("detail").innerHTML = '<div class="empty">Select an event to inspect stdin, stdout, stderr, and graph metadata.</div>';
      }

      async function main() {
        state.projects = await fetchJson('/api/projects');
        renderProjects();
        renderEvents();
        renderGrowth();
        if (state.projects.length > 0) {
          const { cwdHash } = getLocationState();
          const selectedProject =
            (cwdHash && state.projects.find((project) => project.cwdHash === cwdHash)) || state.projects[0];
          await loadProject(selectedProject.cwdHash);
        }
      }

      main().catch((error) => {
        document.getElementById("detail").innerHTML = '<pre>' + escapeHtml(String(error.message || error)) + '</pre>';
      });
    </script>
  </body>
</html>`;
}

async function tryListen(server: http.Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE") {
        resolve(-1);
        return;
      }

      reject(error);
    };

    const onListening = (): void => {
      server.off("error", onError);
      resolve(port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export default async function startUiServer(preferredPort: number): Promise<string> {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method !== "GET") {
        text(response, 405, "Method Not Allowed");
        return;
      }

      if (url.pathname === "/") {
        text(response, 200, renderHtml(), "text/html; charset=utf-8");
        return;
      }

      if (url.pathname === "/api/projects") {
        json(response, 200, await readProjects());
        return;
      }

      if (url.pathname === "/api/logs") {
        const cwdHash = url.searchParams.get("cwdHash");
        if (!cwdHash) {
          json(response, 400, { error: "Missing cwdHash query param." });
          return;
        }

        json(response, 200, await readLogs(cwdHash));
        return;
      }

      if (url.pathname === "/api/graph-snapshots") {
        const cwdHash = url.searchParams.get("cwdHash");
        if (!cwdHash) {
          json(response, 400, { error: "Missing cwdHash query param." });
          return;
        }

        json(
          response,
          200,
          (await readSnapshots(cwdHash)).map((snapshot) => ({
            file: snapshot.file
          }))
        );
        return;
      }

      if (url.pathname === "/api/graph-snapshot") {
        const cwdHash = url.searchParams.get("cwdHash");
        const file = url.searchParams.get("file");
        if (!cwdHash || !file) {
          json(response, 400, { error: "Missing cwdHash or file query param." });
          return;
        }

        const safeFile = path.basename(file);
        const snapshotPath = path.join(getStateDir(), "graphs", cwdHash, safeFile);
        const exists = await pathExists(snapshotPath);
        if (!exists) {
          json(response, 404, { error: "Snapshot not found." });
          return;
        }

        text(response, 200, await fs.readFile(snapshotPath, "utf8"), "application/json; charset=utf-8");
        return;
      }

      text(response, 404, "Not Found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(response, 500, { error: message });
    }
  });

  for (let port = preferredPort; port < preferredPort + 20; port += 1) {
    const boundPort = await tryListen(server, port);
    if (boundPort !== -1) {
      return `http://127.0.0.1:${boundPort}`;
    }
  }

  throw new AgentScriptError(
    `Could not start the UI server.\n` +
      `What to do: free up port ${preferredPort} or pass a different port with \`agentscript ui --port <n>\`.`
  );
}
