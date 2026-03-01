import assert from "node:assert/strict";
import vm from "node:vm";
import { appScript } from "./load-app.mjs";

class ElementStub {
  constructor(tagName, id = "") {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.dataset = {};
    this.textContent = "";
    this.listeners = {};
    this._innerHTML = "";
    this.classList = { toggle() {} };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes) {
    for (const node of nodes) node.parentNode = this;
    this.children = [...nodes];
  }

  addEventListener(type, fn) {
    this.listeners[type] = [...(this.listeners[type] || []), fn];
  }

  set innerHTML(v) {
    this._innerHTML = v;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector() {
    return new ElementStub("td");
  }
}

const nodeById = new Map();
const getNode = id => nodeById.get(id) || (nodeById.set(id, new ElementStub("div", id)), nodeById.get(id));
const documentStub = {
  getElementById: getNode,
  createElement: tag => new ElementStub(tag),
};

const ctx = vm.createContext({
  console,
  Math,
  document: documentStub,
});
vm.runInContext(appScript, ctx, { filename: "crashla.js" });

vm.runInContext(`
incidents = [{
  reportId: "R1",
  company: "Waymo",
  date: "JUN-2025",
  city: "X",
  state: "CA",
  crashWith: "Car",
  speed: 0,
  severity: "Property Damage. No Injured Reported",
  narrativeCbi: "N",
  narrative: "x"
}];
vmtRows = [
  {company: "Waymo", month: "2025-06", vmtMin: 1, vmtBest: 1, vmtMax: 1},
];
faultData = {
  R1: {
    claude: 0,
    codex: 1,
    gemini: 0,
    rclaude: "a",
    rcodex: "b",
    rgemini: "c",
  },
};
buildBrowser();
`, ctx);

const headers = getNode("incidents-head").children[0].children.map(node => node.textContent);
assert.equal(
  headers.includes("Fault variance"),
  true,
  `Replicata: render the incident browser header row.
Expectata: columns include the new "Fault variance" header.
Resultata: headers were ${JSON.stringify(headers)}.`,
);

const bodyRows = getNode("incidents-body").children;
assert.equal(
  bodyRows.length,
  1,
  `Replicata: render one incident row in the incident browser.
Expectata: browser body has exactly one rendered row.
Resultata: row count was ${bodyRows.length}.`,
);

const bodyHtml = bodyRows[0].innerHTML;
assert.equal(
  bodyHtml.includes('<td class="fault-var-cell">0.222</td>'),
  true,
  `Replicata: render one incident with fault values Claude=0, Codex=1, Gemini=0 and equal model weights.
Expectata: weighted fault variance renders as 0.222 in the incident browser row.
Resultata: row HTML was ${JSON.stringify(bodyHtml)}.`,
);

console.log("qual pass: incident browser renders fault variance column");
