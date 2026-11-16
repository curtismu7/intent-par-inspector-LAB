import React, { useCallback, useEffect, useMemo, useState } from "react";
import fs from "node:fs";
import ShelfLink from "./components/ShelfLink.jsx";
import VerifyMark from "./components/VerifyMark.jsx";
import TopMenu, { applyFontSize } from "./top-menu/TopMenu.jsx";
import { getCatalog, getInfo, postMode, resetServer, runScenario } from "./lib/api.js";
import { fromRun } from "./lib/session.js";
import { useWorkbench } from "./lib/useWorkbench.js";
import { fill } from "./lib/fill.js";
import RequestTab from "./tabs/RequestTab.jsx";
import ServerTab from "./tabs/ServerTab.jsx";
import TokenTab from "./tabs/TokenTab.jsx";
import DiagramTab, { START_BOXES } from "./tabs/DiagramTab.jsx";
import RawTab from "./tabs/RawTab.jsx";
// Opened from Customer Agent LAB (UC14, UC14b, UC15 and UC-LEARN19 route here): strip + header Back only. No scenario
// or persona is preselected.
import ReturnLink from "./return-link/ReturnLink.jsx";

const LAB_VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version || null; } catch { return null; } })();

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

  if (loadError) return <Frame tab={tab}><p className="alert" role="alert">Could not reach the mock server: {loadError}</p></Frame>;
  if (!catalog) return <Frame tab={tab}><p className="muted" role="status">Loading the mock authorization server...</p></Frame>;
  return <Shell catalog={catalog} setCatalog={setCatalog} tab={tab} theme={theme} setTheme={setTheme} present={present} setPresent={setPresent} />;
}

const go = (id) => { window.location.hash = `#/${id}`; };
const onNavKey = (e) => {
  const i = TABS.findIndex(([id]) => `tab-${id}` === e.target.id);
  if (i < 0) return;
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  const [id] = TABS[(to + TABS.length) % TABS.length];
  go(id); document.getElementById(`tab-${id}`)?.focus();
};

/** The app shell (STANDALONE-UI-PATTERNS sections 1-2), the same in every state, loading included: the shell bar first,
    then <main> with the simulation banner as its first child and the return strip right below it. */
function Frame({ tab, source, menu, children }) {
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">PAR</span>
          <h1>Intent / PAR Inspector</h1>
          {source === "real"
            ? <span className="shell-badge shell-badge--real" data-testid="mode-badge">Real</span>
            : <span className="shell-badge" data-testid="mode-badge">Mock</span>}
        </span>
        <nav className="shell-nav" aria-label="Inspector sections" onKeyDown={onNavKey}>
          {TABS.map(([id, label]) => (
            <a key={id} id={`tab-${id}`} href={`#/${id}`} aria-current={id === tab ? "page" : undefined} onClick={(e) => { e.preventDefault(); go(id); }}>{label}</a>
          ))}
        </nav>
        {menu}
      </header>
      <main className="page" id="main" tabIndex={-1}>
        <div className="banner" role="note" data-testid="banner">
          <strong>Mock only.</strong> This is an in-process mock authorization server: no tenant, no outbound network, every token here is issued by the mock with a throwaway key, and every address is a reserved <code>.invalid</code> name.
        </div>
        <ReturnLink app="intent-par-inspector" />
        {children}
      </main>
    </>
  );
}

function Shell({ catalog, setCatalog, tab, theme, setTheme, present, setPresent }) {
  const wb = useWorkbench(catalog);
  const [fontStep, setFontStep] = useState(() => { const f = read("ipi.font", "M"); return ["S", "M", "L"].includes(f) ? f : "M"; });
  const [run, setRun] = useState(null);
  const [active, setActive] = useState("manual");
  const [scenarioId, setScenarioId] = useState(catalog.scenarios[0].id);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [cursor, setCursor] = useState(-1);
  const [boxes, setBoxes] = useState(START_BOXES);
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

  const setThemePersist = (t) => { setTheme(t); write("ipi.theme", t); };
  useEffect(() => { applyFontSize(fontStep); write("ipi.font", fontStep); }, [fontStep]);
  const togglePresent = () => { write("ipi.present", present ? "0" : "1"); setPresent(!present); };

  const app = { catalog, cast, wb, session, run, active, scenarioId, setScenarioId, doRun, running, runError, resetAll, cursor, setCursor, boxes, setBoxes, present, theme, go };
  const Panel = { request: RequestTab, server: ServerTab, token: TokenTab, diagram: DiagramTab, raw: RawTab }[tab];

  return (
    <Frame tab={tab} source={modeInfo?.source} menu={
        <TopMenu
          mode={{ value: modeInfo?.source === "real" ? "real" : "mock", onChange: pickMode, realAvailable: modeInfo ? modeInfo.realAvailable === true : null, realHint: "This inspector is mock only: it ships its own in-process mock authorization server and has no real side." }}
          vertical={{ value: catalog.vertical, onChange: pickVertical, options: catalog.verticals.map((v) => v.id) }}
          theme={{ value: theme, onChange: setThemePersist }}
          fontSize={{ value: fontStep, onChange: setFontStep }}
          present={{ active: present, onToggle: togglePresent, label: "Present (P)" }}
          help={{ href: "https://github.com/curtismu7/intent-par-inspector-LAB#readme" }}
          version={LAB_VERSION}
          onReset={resetServerState}
        >
          <ReturnLink app="intent-par-inspector" variant="header" />
          <ShelfLink />
          <VerifyMark id="intent-par-inspector" />
        </TopMenu>
    }>
      <p className="muted" role="status" data-testid="reset-note">{resetNote}</p>
      <p className="lede" data-admin-only>{fill("{{agent}} wants to do something for {{user}}. The intent travels in the pushed request, so the browser cannot edit it.", cast)}</p>
      <Panel app={app} />
    </Frame>
  );
}
