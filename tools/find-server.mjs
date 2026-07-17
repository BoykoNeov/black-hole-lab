/**
 * Find a dev server already serving this lab, if there is one.
 *
 * The port is not proof of identity, which is the whole reason this exists:
 * vite takes the next free port when its default is busy, so whichever project
 * started first owns 5173 and this lab lands wherever it lands. On a machine
 * running several vite projects, asking each port what it is *serving* is the
 * only reliable way to tell ours from theirs — and the only way to be sure we
 * neither hijack someone else's server nor start a redundant one of our own.
 *
 * Dependency-free on purpose: the launcher calls this before `npm install` is
 * guaranteed to have run, so it must work with nothing but node.
 *
 * As a CLI (`node tools/find-server.mjs`): prints the URL and exits 0, or
 * prints nothing and exits 1. Nothing but the URL ever goes to stdout — the
 * launcher reads it straight into a variable.
 */

/** Vite's default, and the fifteen it climbs through when the default is busy. */
export const PORTS = Array.from({ length: 16 }, (_, i) => 5173 + i);

export const TITLE = "Black Hole Lab";

/**
 * The lowest port serving this lab, or null if none is.
 *
 * Any match will do, and an old one is as good as a fresh one: vite transforms
 * from disk per request, so a server left running for days still serves the
 * code as it is now. That is what makes reusing one safe rather than a bet on
 * how stale it might be.
 */
export async function findServer() {
  const hits = await Promise.all(
    PORTS.map(async (port) => {
      // An owned controller rather than AbortSignal.timeout, so the timer can
      // be cleared: 16 of them left armed keep the loop alive after the answer
      // is known, and exiting out from under them trips a libuv assertion on
      // Windows (UV_HANDLE_CLOSING) instead of exiting.
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 2000);
      try {
        const res = await fetch(`http://localhost:${port}/`, { signal: ac.signal });
        return new RegExp(`<title>${TITLE}</title>`).test(await res.text()) ? port : null;
      } catch {
        return null; // nothing listening, or not http — either way, not us
      } finally {
        clearTimeout(timer);
      }
    })
  );
  const port = hits.find((p) => p !== null);
  return port === undefined ? null : `http://localhost:${port}`;
}

if (import.meta.main) {
  const url = await findServer();
  // exitCode rather than exit(): let the loop drain on its own. Killing it
  // mid-teardown is what the assertion above is about.
  if (url) console.log(url);
  else process.exitCode = 1;
}
