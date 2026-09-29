// Fault injection lives in the test worker, never the production message API.
import { saveJournaledOutput } from "../../src/jobs/output.js";

const fault = new URL(import.meta.url).searchParams.get("fault");
const method = fault === "after-close" ? "close" : "write";
const original = FileSystemWritableFileStream.prototype[method];
if (fault) FileSystemWritableFileStream.prototype[method] = async function (...args) {
  const result = await original.apply(this, args);
  self.postMessage({ stage: fault });
  await new Promise(() => {});
  return result;
};
self.onmessage = async ({ data }) => {
  try { self.postMessage({ result: await saveJournaledOutput(data) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
