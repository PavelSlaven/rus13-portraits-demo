"use strict";

const runtime = "https://unpkg.com/pyodide@0.29.5/";
let renderSvgPair;

async function start() {
  importScripts("./runtime/pyodide.js");
  const [python, response] = await Promise.all([
    loadPyodide({ indexURL: runtime }),
    fetch("./engine.zip?v=izyaslav-cut-2"),
  ]);
  if (!response.ok) throw new Error("Архив генератора недоступен.");

  python.unpackArchive(await response.arrayBuffer(), "zip", { extractDir: "/rus13" });
  renderSvgPair = python.runPython(`
import json
import sys

sys.path.insert(0, "/rus13")
from editor import render_payload

def render_json(payload):
    try:
        return json.dumps(render_payload(json.loads(payload)), ensure_ascii=False)
    except ValueError as error:
        return json.dumps({"error": str(error)}, ensure_ascii=False)

render_json
`);
  self.postMessage({ kind: "ready" });
}

self.addEventListener("message", ({ data }) => {
  try {
    const result = JSON.parse(renderSvgPair(JSON.stringify(data.payload)));
    if (result.error) {
      self.postMessage({ kind: "render-error", id: data.id, error: result.error });
      return;
    }
    self.postMessage({ kind: "rendered", id: data.id, result });
  } catch (error) {
    console.error(error);
    self.postMessage({ kind: "render-error", id: data.id });
  }
});

start().catch(error => {
  console.error(error);
  self.postMessage({ kind: "startup-error" });
});
