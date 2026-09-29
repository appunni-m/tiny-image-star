import { action } from "./view.js";
import { prepareStagedFiles } from "../jobs/staged-export.js";

export function mountStagedExportPanel(content, message) {
  const panel = document.createElement("section"); panel.className = "story-staged-exports";
  const heading = document.createElement("h3"); heading.textContent = "Download or share ready files";
  const note = document.createElement("p"); note.className = "story-note";
  note.textContent = "Files stay in this browser until you download or share them. Prepare up to 8 files or about 32 MiB at a time; a larger file gets its own group. Closing pauses work. Browser storage can be cleared or evicted; screen locking can suspend processing.";
  const status = document.createElement("p"); status.className = "story-note"; status.setAttribute("role", "status");
  const links = document.createElement("ol"); links.className = "story-batch-outputs";
  let id = null, ready = null, preparing = null, disposed = false, sharing = false, busy = false;
  const clear = () => { ready?.dispose(); ready = null; links.replaceChildren(); };
  const refresh = () => {
    first.disabled = next.disabled = busy || Boolean(preparing) || sharing;
    next.hidden = !ready?.hasMore;
    let supported = false; try { supported = Boolean(ready && navigator.share && navigator.canShare?.({ files: ready.files })); } catch { /* Individual downloads remain available. */ }
    share.hidden = !supported; share.disabled = busy || sharing || Boolean(preparing);
    share.textContent = `Share ${ready?.files.length ?? 0} ready files`;
  };
  async function prepare(start) {
    if (!id || preparing || sharing || busy) return;
    const selected = id, controller = new AbortController(); preparing = controller; clear(); refresh(); status.textContent = "Preparing a small group from browser storage…";
    try {
      const group = await prepareStagedFiles(selected, start, { signal: controller.signal });
      if (disposed || selected !== id || controller.signal.aborted) { group.dispose(); return; }
      ready = group;
      for (let i = 0; i < group.files.length; i++) {
        const row = document.createElement("li"), link = document.createElement("a"); link.className = "button secondary";
        link.href = group.urls[i]; link.download = group.files[i].name; link.textContent = `Download ${group.files[i].name}`;
        link.addEventListener("click", () => { status.textContent = "Download requested. Check your browser's downloads; the staged copy is kept."; }); row.append(link); links.append(row);
      }
      status.textContent = `${group.files.length} files ready · ${(group.files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(1)} MiB. Download individually or use Share when available.`;
    } catch (error) { if (!disposed && selected === id && !controller.signal.aborted) status.textContent = error.message; }
    finally { if (preparing === controller) preparing = null; if (!disposed) refresh(); }
  }
  const first = action("Prepare from beginning", () => void prepare(0));
  const next = action("Prepare next group", () => void prepare(ready?.next ?? 0));
  const share = action("Share ready files", async () => {
    if (!ready || sharing || preparing || busy) return;
    const group = ready, release = group.retain(); sharing = true; refresh();
    // Files are already prepared. Call share in this click, before any await.
    try { await navigator.share({ files: group.files, title: "Photo stories" }); if (!disposed) status.textContent = "Share sheet closed. Staged copies are kept; check the destination before removing them."; }
    catch (error) { if (!disposed) status.textContent = error.name === "AbortError" ? "Sharing cancelled. The ready files are still available." : error.message; }
    finally { release(); sharing = false; if (!disposed) refresh(); }
  }, true);
  const persist = action("Request persistent storage", async () => {
    try { const granted = await navigator.storage?.persist?.(); if (!disposed) status.textContent = granted ? "The browser granted persistent storage. Keep downloaded backups; clearing site data still removes these files." : "Persistent storage was not granted. Download or share your files before clearing browser data."; }
    catch (error) { if (!disposed) message(error.message); }
  });
  panel.append(heading, note, first, next, share, persist, status, links); content.append(panel); panel.hidden = true; refresh();
  return {
    element: panel,
    update(job, active) { const selected = job?.outputMode === "browser" ? job.id : null;
      if (selected !== id) { preparing?.abort(); clear(); id = selected; status.textContent = ""; }
      busy = active; panel.hidden = !selected; first.hidden = !job?.completed; refresh();
    },
    dispose() { disposed = true; preparing?.abort(); clear(); panel.remove(); },
  };
}
