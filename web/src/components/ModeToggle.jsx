// Mock/Real toggle (rule 19). This inspector is mock only: the server always reports source "mock" with
// realAvailable false, so Real stays disabled with the reason. It still renders on every page, in the header.
const REAL_WHY = "This inspector is mock only: it ships its own in-process mock authorization server and has no real side.";

export default function ModeToggle({ info, onSelect }) {
  const loading = !info;
  const source = info?.source;
  const realOff = loading || info?.realAvailable !== true;
  const pick = (next) => { if (next !== source) onSelect?.(next); };
  return (
    <div className="mode-toggle" role="group" aria-label="Mode" data-testid="mode">
      <button type="button" aria-pressed={source === "mock"} disabled={loading} onClick={() => pick("mock")} data-testid="mode-mock">Mock</button>
      <button type="button" aria-pressed={source === "real"} disabled={realOff} title={realOff && !loading ? REAL_WHY : undefined} onClick={() => pick("real")} data-testid="mode-real">Real</button>
    </div>
  );
}
