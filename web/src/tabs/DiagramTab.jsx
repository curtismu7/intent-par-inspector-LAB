import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Inert } from "../lib/Inert.jsx";
import { fill } from "../lib/fill.js";
import { ACTOR_NODE, OPS } from "../lib/session.js";
import { StoryPlayer, ScenarioBar } from "./Scenarios.jsx";

// Client -> mock AS -> user consent -> resource. Boxes are draggable; Simulate walks the steps on screen (or a built-in happy path when
// there are none), Reset puts everything back, the speed control sets the pace. The caption says in words what the picture shows.
export const START_BOXES = [
  { id: "client", position: { x: 0, y: 0 }, data: { title: "Client", sub: "The agent app. Pushes the request, redeems the code." } },
  { id: "as", position: { x: 420, y: 0 }, data: { title: "Mock authorization server", sub: "Holds the request_uri and the bound intent." } },
  { id: "user", position: { x: 420, y: 230 }, data: { title: "User consent", sub: "Sees the exact intent and approves it." } },
  { id: "rs", position: { x: 0, y: 230 }, data: { title: "Resource", sub: "Runs only what equals the bound intent, once." } },
];
const EDGES = [
  { id: "par", source: "client", target: "as", sourceHandle: "r", targetHandle: "l", label: "1 PAR push (intent inside)" },
  { id: "authorize", source: "user", target: "as", sourceHandle: "t", targetHandle: "b", label: "2 /authorize?request_uri" },
  { id: "consent", source: "user", target: "as", sourceHandle: "t2", targetHandle: "b2", label: "3 approve exact intent" },
  { id: "token", source: "client", target: "as", sourceHandle: "r2", targetHandle: "l2", label: "4 code to token" },
  { id: "execute", source: "client", target: "rs", sourceHandle: "b", targetHandle: "t", label: "5 use the token" },
];
export const DEMO_STEPS = [
  { op: "par", say: "{{agent}} pushes the request, intent included, to the authorization server's back channel." },
  { op: "authorize", say: "The browser opens /authorize with only the request_uri. The server resolves and burns it." },
  { op: "consent", say: "{{user}} sees the exact intent and approves it by its hash." },
  { op: "token", say: "{{agent}} redeems the code. The token carries the bound intent." },
  { op: "execute", say: "The resource server finds the request equal to the bound intent and runs it once." },
];
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const BASE_MS = 1600;
const POS = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom, l2: Position.Left, r2: Position.Right, t2: Position.Top, b2: Position.Bottom };
const OFFSET = { l: "35%", r: "35%", l2: "72%", r2: "72%", t: "20%", b: "20%", t2: "80%", b2: "80%" };

function Box({ data }) {
  return (
    <div className={`fbox${data.on ? " on" : ""}${data.dim ? " dim" : ""}${data.deny ? " deny" : ""}`}>
      {Object.entries(POS).map(([id, pos]) => (
        <React.Fragment key={id}>
          <Handle id={id} type="source" position={pos} style={OFFSET[id] ? (pos === Position.Left || pos === Position.Right ? { top: OFFSET[id] } : { left: OFFSET[id] }) : undefined} />
          <Handle id={id} type="target" position={pos} style={OFFSET[id] ? (pos === Position.Left || pos === Position.Right ? { top: OFFSET[id] } : { left: OFFSET[id] }) : undefined} />
        </React.Fragment>
      ))}
      <strong>{data.title}</strong>
      <span>{data.sub}</span>
    </div>
  );
}
const nodeTypes = { box: Box };

export default function DiagramTab({ app }) {
  const { session, cast, cursor, setCursor, boxes, setBoxes, theme } = app;
  const [speed, setSpeed] = useState("1");
  const [running, setRunning] = useState(false);
  const steps = session?.steps ?? DEMO_STEPS;

  useEffect(() => { setRunning(false); }, [session]);
  useEffect(() => {
    if (!running) return undefined;
    if (cursor >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setCursor(cursor + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, cursor, steps.length, speed, setCursor]);

  const simulate = () => { setCursor(0); setRunning(true); };
  const reset = () => { setRunning(false); setCursor(-1); setBoxes(START_BOXES); };
  const onNodesChange = useCallback((changes) => setBoxes((n) => applyNodeChanges(changes, n)), [setBoxes]);

  const cur = cursor >= 0 ? steps[Math.min(cursor, steps.length - 1)] : null;
  const curMsg = cur && session && cur.messageSeq ? session.messages[cur.messageSeq - 1] : null;
  const refused = cur?.status >= 400;
  const lit = cur && OPS[cur.op] ? [ACTOR_NODE[OPS[cur.op].from], ACTOR_NODE[OPS[cur.op].to]] : [];
  const nodes = useMemo(() => boxes.map((n) => ({ ...n, type: "box", data: { ...n.data, on: lit.includes(n.id) && !refused, deny: refused && lit[1] === n.id, dim: !!cur && !lit.includes(n.id) } })), [boxes, cur, refused]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = useMemo(() => EDGES.map((e) => ({
    ...e, animated: cur?.op === e.id, className: cur?.op === e.id ? (refused ? "edge-deny" : "edge-on") : "", markerEnd: { type: MarkerType.ArrowClosed },
  })), [cur, refused]);

  const caption = cur
    ? `Step ${cursor + 1} of ${steps.length}: ${fill(cur.say || "Time passes on the mock clock.", cast)}${cur.status != null ? (refused ? ` REFUSED ${cur.status} ${cur.reason || ""}.` : ` Accepted (${cur.status}).`) : ""}`
    : "Press Simulate to walk the steps through the diagram. Drag any box to rearrange it.";

  return (
    <>
      <h2>How the intent travels</h2>
      <p className="lede" data-admin-only>Drag any box. Simulate walks the scenario or request on screen; with nothing on screen it plays the happy path. Refused steps turn red and say so.</p>
      <div className="card controls">
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value)}>{SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </label>
        <button type="button" className="btn primary" onClick={simulate} disabled={running}>Simulate</button>
        <button type="button" className="btn" onClick={reset}>Reset</button>
      </div>
      <div className="flow-wrap" role="group" aria-label="Sequence diagram: client, mock authorization server, user consent and resource. Boxes can be dragged.">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={theme}
          fitView fitViewOptions={{ padding: 0.12 }} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className={`caption${refused ? " caption--deny" : ""}`} role="status" aria-live="polite" data-testid="caption"><Inert text={caption} /></p>
      {curMsg && <p className="muted small">Message {curMsg.seq ?? cur.messageSeq}: <code>{curMsg.request.method} {curMsg.request.path}</code> (full text on the Raw tab)</p>}
      <ScenarioBar app={app} />
      <StoryPlayer app={app} />
    </>
  );
}
