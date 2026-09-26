// Served only by verify-security.mjs. These attempts run as real page/worker
// code, not inside DevTools evaluation (which can bypass eval restrictions).
export async function runCodeProbes(sink) {
  const result = { violations: [] };
  const listener = (event) => result.violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI, disposition: event.disposition });
  globalThis.addEventListener("securitypolicyviolation", listener);
  const blocked = async (name, action) => {
    try { await action(); result[name] = false; } catch { result[name] = true; }
  };
  await blocked("eval", () => eval("globalThis.__evaluated = true"));
  await blocked("function", () => new Function("globalThis.__constructed = true")());
  await blocked("fetch", () => fetch(`${sink}/fetch`, { mode: "cors" }));
  await blocked("post", () => fetch(`${sink}/post`, { method: "POST", body: "synthetic-security-test", mode: "cors" }));
  await blocked("redirect", () => fetch(`/__security/redirect?sink=${encodeURIComponent(sink)}`));
  await blocked("import", () => import(`${sink}/module.js`));
  // A real WASM compilation must still work while string compilation is denied.
  result.wasm = (await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]))) instanceof WebAssembly.Module;
  const blob = URL.createObjectURL(new Blob(["local bytes"]));
  try { result.blob = await (await fetch(blob)).text() === "local bytes"; }
  finally { URL.revokeObjectURL(blob); }
  await new Promise((resolve) => setTimeout(resolve, 100));
  globalThis.removeEventListener("securitypolicyviolation", listener);
  result.executed = Boolean(globalThis.__evaluated || globalThis.__constructed);
  return result;
}

export async function runDocumentProbes(sink) {
  const result = await runCodeProbes(sink);
  const listener = (event) => result.violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI, disposition: event.disposition });
  document.addEventListener("securitypolicyviolation", listener);
  const nodes = [], urls = [];
  const append = (tag, setup, parent = document.body) => {
    const node = document.createElement(tag); setup(node); parent.append(node); nodes.push(node); return node;
  };
  append("script", (node) => { node.textContent = "globalThis.__inlineExecuted = true"; });
  append("script", (node) => { node.src = `${sink}/external.js`; });
  for (const url of ["data:text/javascript,globalThis.__dataExecuted=true", URL.createObjectURL(new Blob(["globalThis.__blobExecuted=true"], { type: "text/javascript" }))]) {
    if (url.startsWith("blob:")) urls.push(url);
    append("script", (node) => { node.src = url; });
  }
  const eventButton = append("button", (node) => { node.setAttribute("onclick", "globalThis.__handlerExecuted=true"); });
  eventButton.click();
  const styleTarget = append("div", (node) => { node.id = "security-style-probe"; node.textContent = "Synthetic CSP test"; });
  const initialColor = getComputedStyle(styleTarget).color;
  append("style", (node) => { node.textContent = "#security-style-probe {color: rgb(1, 2, 3) !important}"; });
  styleTarget.setAttribute("style", "color: rgb(4, 5, 6) !important");
  result.inlineStyleBlocked = getComputedStyle(styleTarget).color === initialColor;
  styleTarget.style.width = "137px";
  result.styleProperty = getComputedStyle(styleTarget).width === "137px";
  append("link", (node) => { node.rel = "stylesheet"; node.href = `${sink}/external.css`; }, document.head);
  append("img", (node) => { node.src = `${sink}/image.png`; });
  append("iframe", (node) => { node.src = `${sink}/frame`; });
  append("object", (node) => { node.type = "text/html"; node.data = `${sink}/object`; });
  const base = document.baseURI;
  append("base", (node) => { node.href = `${sink}/base/`; }, document.head);
  result.baseUnchanged = document.baseURI === base;
  const form = append("form", (node) => { node.action = `${sink}/form`; node.method = "post"; });
  form.submit();
  // A successful queueing return value is not proof of network delivery.
  // Observe enforcement and separately assert zero traffic at the receiver.
  result.beaconBlocked = await new Promise((resolve) => {
    const timeout = setTimeout(() => { document.removeEventListener("securitypolicyviolation", observe); resolve(false); }, 5000);
    function observe(event) {
      if (event.effectiveDirective !== "connect-src") return;
      clearTimeout(timeout); document.removeEventListener("securitypolicyviolation", observe); resolve(true);
    }
    document.addEventListener("securitypolicyviolation", observe);
    result.beaconQueued = navigator.sendBeacon(`${sink}/beacon`, "synthetic-security-test");
  });
  try { await new FontFace("ForbiddenExternalFont", `url(${sink}/font.ttf)`).load(); result.font = false; } catch { result.font = true; }
  const workerUrl = URL.createObjectURL(new Blob(["postMessage('ran')"], { type: "text/javascript" })); urls.push(workerUrl);
  result.blobWorker = await new Promise((resolve) => {
    let worker;
    try { worker = new Worker(workerUrl); }
    catch { resolve(true); return; }
    const timeout = setTimeout(() => { worker.terminate(); resolve(false); }, 5000);
    worker.onmessage = () => { clearTimeout(timeout); worker.terminate(); resolve(false); };
    worker.onerror = (event) => { event.preventDefault(); clearTimeout(timeout); worker.terminate(); resolve(true); };
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  result.executed ||= Boolean(globalThis.__inlineExecuted || globalThis.__dataExecuted || globalThis.__blobExecuted || globalThis.__handlerExecuted || globalThis.__externalExecuted);
  document.removeEventListener("securitypolicyviolation", listener);
  for (const node of nodes) node.remove();
  for (const url of urls) URL.revokeObjectURL(url);
  return result;
}
