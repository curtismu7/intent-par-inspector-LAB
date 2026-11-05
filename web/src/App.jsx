import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ShelfLink from "./components/ShelfLink.jsx";
import { getCatalog, getInfo, postMode, resetServer, runScenario } from "./lib/api.js";
import { fromRun } from "./lib/session.js";
import { useWorkbench } from "./lib/useWorkbench.js";
import { fill } from "./lib/fill.js";
import RequestTab from "./tabs/RequestTab.jsx";
import ServerTab from "./tabs/ServerTab.jsx";
import TokenTab from "./tabs/TokenTab.jsx";
import DiagramTab, { START_BOXES } from "./tabs/DiagramTab.jsx";
import RawTab from "./tabs/RawTab.jsx";
import ModeToggle from "./components/ModeToggle.jsx";

export const TABS = [["request", "Request"], ["server", "Server"], ["token", "Token"], ["diagram", "Diagram"], ["raw", "Raw"]];
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const tabFromHash = () => { const id = window.location.hash.replace(/^#\/?/, "").split("?")[0]; return TABS.some(([t]) => t === id) ? id : "request"; };

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState(tabFromHash);
  const [theme, setTheme] = useState(() => (["light", "dark"].includes(read("ipi.theme", "")) ? read("ipi.theme", "") : "system"));
  const [present, setPresent] = useState(() => read("ipi.present", "0") === "1");

  useEffect(() => {
    getCatalog().then(setCatalog).catch((e) => setLoadError(e.message));
  }, []);
  useEffect(() => { const on = () => setTab(tabFromHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  useEffect(() => { if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (present) document.documentElement.dataset.present = "1"; else delete document.documentElement.dataset.present; }, [present]);

  const shell = (body) => (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      {body}
    </>
  );
  if (loadError) return shell(<main className="page" id="main" tabIndex={-1}><p className="alert" role="alert">Could not reach the mock server: {loadError}</p></main>);
  if (!catalog) return shell(<main className="page" id="main" tabIndex={-1}><p className="muted" role="status">Loading the mock authorization server...</p></main>);
  return shell(<Shell catalog={catalog} setCatalog={setCatalog} tab={tab} theme={theme} setTheme={setTheme} present={present} setPresent={setPresent} />);
}

function Shell({ catalog, setCatalog, tab, theme, setTheme, present, setPresent }) {
  const wb = useWorkbench(catalog);
  const [run, setRun] = useState(null);
  const [active, setActive] = useState("manual");
  const [scenarioId, setScenarioId] = useState(catalog.scenarios[0].id);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [cursor, setCursor] = useState(-1);
  const [boxes, setBoxes] = useState(START_BOXES);
  const tabRefs = useRef({});
  const [modeInfo, setModeInfo] = useState(null);

  const pickMode = useCallback(async (source) => {
    try { setModeInfo(await postMode(source)); } catch { /* server refused; refetch the truth */ getInfo().then(setModeInfo).catch(() => {}); }
  }, []);

  useEffect(() => { getInfo().then(setModeInfo).catch(() => {}); }, []);

  const cast = useMemo(() => catalog.verticals.find((v) => v.id === catalog.vertical)?.cast || {}, [catalog]);
  const session = active === "scenario" ? run : wb.session;

  // A hand-driven call becomes the session on screen, with its last step highlighted.
  const manual = wb.session;
  useEffect(() => { if (manual) { setActive("manual"); setCursor(manual.steps.length - 1); } }, [manual]);

  const pickVertical = useCallback(async (id) => {
    const next = await getCatalog(id);
    setCatalog(next); setRun(null); setActive("manual"); setCursor(-1); wb.reset(next);
  }, [setCatalog, wb]);

  const doRun = useCallback(async () => {
    setRunning(true); setRunError(null);
    try { const r = await runScenario(scenarioId, catalog.vertical); setRun(fromRun(r)); setActive("scenario"); setCursor(-1); }
    catch (e) { setRunError(e.message); } finally { setRunning(false); }
  }, [scenarioId, catalog.vertical]);

  const resetAll = useCallback(() => { setRun(null); setActive("manual"); setCursor(-1); setBoxes(START_BOXES); wb.reset(); }, [wb]);

  const [resetNote, setResetNote] = useState("");
  const resetServerState = useCallback(async () => {
    try { await resetServer(); resetAll(); setResetNote("Mock server reset: pushed requests, codes and spent tokens are gone."); }
    catch (e) { setResetNote(`Reset failed: ${e.message}`); }
  }, [resetAll]);

  const cycle = () => { const next = { system: "light", light: "dark", dark: "system" }[theme]; setTheme(next); write("ipi.theme", next); };
  const togglePresent = () => { write("ipi.present", present ? "0" : "1"); setPresent(!present); };
  const go = (id) => { window.location.hash = `#/${id}`; };
  const onTabKey = (e) => {
    const i = TABS.findIndex(([id]) => id === tab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const [id] = TABS[(to + TABS.length) % TABS.length];
    go(id); tabRefs.current[id]?.focus();
  };

  const app = { catalog, cast, wb, session, run, active, scenarioId, setScenarioId, doRun, running, runError, resetAll, cursor, setCursor, boxes, setBoxes, present, theme, go };
  const Panel = { request: RequestTab, server: ServerTab, token: TokenTab, diagram: DiagramTab, raw: RawTab }[tab];

  return (
    <>
      <div className="banner" role="note" data-testid="banner">
        <strong>Mock only.</strong> This is an in-process mock authorization server: no tenant, no outbound network, every token here is issued by the mock with a throwaway key, and every address is a reserved <code>.invalid</code> name.
      </div>
      <header className="top">
        <h1><span className="mark" aria-hidden="true">PAR</span> Intent / PAR Inspector</h1>
        <div className="tools-right">
            <ShelfLink />
          <ModeToggle info={modeInfo} onSelect={pickMode} />
          <label className="inline">Persona
            <select value={catalog.vertical} onChange={(e) => pickVertical(e.target.value)} aria-label="Persona and vertical">
              {catalog.verticals.map((v) => <option key={v.id} value={v.id}>{v.name}: {v.cast.user} and {v.cast.agent}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={resetServerState}>Reset server</button>
          <button type="button" className="btn" aria-pressed={present} onClick={togglePresent}>Present</button>
          <button type="button" className="btn" onClick={cycle} title="Theme: system, light, dark">Theme: {theme}</button>
        </div>
      </header>
      <p className="muted" role="status" data-testid="reset-note">{resetNote}</p>
      <div className="tabbar" role="tablist" aria-label="Inspector sections" onKeyDown={onTabKey}>
        {TABS.map(([id, label]) => (
          <button key={id} id={`tab-${id}`} ref={(el) => { tabRefs.current[id] = el; }} type="button" role="tab" aria-selected={id === tab} aria-controls="main" tabIndex={id === tab ? 0 : -1} className="tab" onClick={() => go(id)}>{label}</button>
        ))}
      </div>
      <main className="page" id="main" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        <p className="lede" data-admin-only>{fill("{{agent}} wants to do something for {{user}}. The intent travels in the pushed request, so the browser cannot edit it.", cast)}</p>
        <Panel app={app} />
      </main>
    </>
  );
}
