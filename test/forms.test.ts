import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";

import { listForms, findForm, replaceForm, insertForm, deleteForm, patchForm, formatFormList } from "../src/core/forms.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

describe("listForms", () => {
  it("lists forms in a Clojure file", () => {
    const source = readFixture("simple.clj");
    const { forms, errors } = listForms(source, "clojure");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 6);
  });

  it("lists forms in a Scheme file", () => {
    const source = readFixture("simple.scm");
    const { forms, errors } = listForms(source, "scheme");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 5);
  });
});

describe("findForm", () => {
  it("finds by name", () => {
    const source = readFixture("simple.clj");
    const result = findForm(source, "clojure", { name: "process-data" });
    assert.ok(!("error" in result));
    assert.equal(result.name, "process-data");
    assert.equal(result.head, "defn");
  });

  it("finds by index", () => {
    const source = readFixture("simple.clj");
    const result = findForm(source, "clojure", { index: 0 });
    assert.ok(!("error" in result));
    assert.equal(result.head, "ns");
  });

  it("errors on missing name", () => {
    const source = readFixture("simple.clj");
    const result = findForm(source, "clojure", { name: "nonexistent" });
    assert.ok("error" in result);
    assert.ok(result.error.includes("No top-level form"));
  });

  it("errors on out-of-range index", () => {
    const source = readFixture("simple.clj");
    const result = findForm(source, "clojure", { index: 99 });
    assert.ok("error" in result);
    assert.ok(result.error.includes("out of range"));
  });

  it("errors on ambiguous name with disambiguation hint", () => {
    const source = readFixture("simple.clj");
    const result = findForm(source, "clojure", { name: "handle-event" });
    assert.ok("error" in result);
    assert.ok(result.error.includes("Multiple forms"));
    assert.ok(result.error.includes("index"));
  });
});

describe("replaceForm", () => {
  it("replaces a form by name", () => {
    const source = readFixture("simple.clj");
    const newForm = `(defn process-data
  [items opts]
  (let [filtered (filter (:pred opts) items)
        sorted (sort-by :id filtered)]
    (mapv transform sorted)))`;

    const result = replaceForm(source, "clojure", { name: "process-data" }, newForm);
    assert.ok(!("error" in result));
    assert.ok(result.content.includes("mapv transform sorted"));
    assert.ok(result.content.includes(";; Process incoming data"), "should preserve attached comment");
    // Original form should be gone
    assert.ok(!result.content.includes("(map transform filtered)"));
  });

  it("replaces a form by index", () => {
    const source = readFixture("simple.clj");
    const newForm = `(def config {:port 8080 :host "0.0.0.0"})`;

    const result = replaceForm(source, "clojure", { index: 1 }, newForm);
    assert.ok(!("error" in result));
    assert.ok(result.content.includes("8080"));
    assert.ok(!result.content.includes("3000"));
  });

  it("rejects unbalanced newForm", () => {
    const source = readFixture("simple.clj");
    const result = replaceForm(source, "clojure", { name: "process-data" }, "(defn process-data [x] (+ x 1)");
    assert.ok("error" in result);
    assert.ok(result.error.includes("bracket error"));
  });

  it("preserves rest of file", () => {
    const source = readFixture("simple.clj");
    const newForm = `(def config {:port 9999})`;
    const result = replaceForm(source, "clojure", { index: 1 }, newForm);
    assert.ok(!("error" in result));
    // ns and later forms should still be there
    assert.ok(result.content.includes("(ns myapp.core"));
    assert.ok(result.content.includes("(defn process-data"));
    assert.ok(result.content.includes("(defn- helper"));
  });

  it("re-indents to match original column", () => {
    // Form indented at column 2
    const source = "  (defn foo [x] x)";
    const newForm = "(defn foo [x y] (+ x y))";
    const result = replaceForm(source, "clojure", { index: 0 }, newForm);
    assert.ok(!("error" in result));
    assert.ok(result.content.startsWith("  (defn foo"), `expected leading spaces, got: "${result.content.slice(0, 20)}"`);
  });
});

describe("insertForm", () => {
  it("inserts after a named form", () => {
    const source = readFixture("simple.clj");
    const newForm = `(defn new-fn [x] (* x 2))`;
    const result = insertForm(source, "clojure", { name: "config" }, newForm, "after");
    assert.ok(!("error" in result));
    // New form should appear between config and process-data
    const configIdx = result.content.indexOf("(def config");
    const newFnIdx = result.content.indexOf("(defn new-fn");
    const processIdx = result.content.indexOf("(defn process-data");
    assert.ok(configIdx < newFnIdx, "new form should be after config");
    assert.ok(newFnIdx < processIdx, "new form should be before process-data");
  });

  it("inserts before a named form", () => {
    const source = readFixture("simple.clj");
    const newForm = `(defn new-fn [x] (* x 2))`;
    const result = insertForm(source, "clojure", { name: "process-data" }, newForm, "before");
    assert.ok(!("error" in result));
    const newFnIdx = result.content.indexOf("(defn new-fn");
    const processIdx = result.content.indexOf("(defn process-data");
    assert.ok(newFnIdx < processIdx, "new form should be before process-data");
  });

  it("rejects unbalanced newForm", () => {
    const source = readFixture("simple.clj");
    const result = insertForm(source, "clojure", { index: 0 }, "(defn broken [x", "after");
    assert.ok("error" in result);
    assert.ok(result.error.includes("bracket error"));
  });
});

describe("deleteForm", () => {
  it("deletes a form by name", () => {
    const source = readFixture("simple.clj");
    const result = deleteForm(source, "clojure", { name: "helper" });
    assert.ok(!("error" in result));
    assert.ok(!result.content.includes("defn- helper"));
    assert.ok(!result.content.includes("A private helper function"));
    // Other forms should remain
    assert.ok(result.content.includes("(ns myapp.core"));
    assert.ok(result.content.includes("(defn process-data"));
  });

  it("deletes a form with attached comments", () => {
    const source = readFixture("simple.clj");
    const result = deleteForm(source, "clojure", { name: "process-data" });
    assert.ok(!("error" in result));
    assert.ok(!result.content.includes("Process incoming data"), "attached comment should be removed");
    assert.ok(!result.content.includes("defn process-data"));
  });

  it("deletes by index", () => {
    const source = readFixture("simple.clj");
    const result = deleteForm(source, "clojure", { index: 0 });
    assert.ok(!("error" in result));
    assert.ok(!result.content.includes("(ns myapp.core"));
  });
});

describe("patchForm", () => {
  it("patches text within a named form", () => {
    const source = readFixture("simple.clj");
    const result = patchForm(source, "clojure", { name: "process-data" }, "map transform", "mapv transform");
    assert.ok(!("error" in result));
    assert.ok(result.content.includes("mapv transform"));
    assert.ok(!result.content.includes("(map transform"));
    // Rest of file untouched
    assert.ok(result.content.includes("(def config"));
    assert.ok(result.content.includes("(defn- helper"));
  });

  it("patches text within a form by index", () => {
    const source = readFixture("simple.clj");
    const result = patchForm(source, "clojure", { index: 1 }, "3000", "8080");
    assert.ok(!("error" in result));
    assert.ok(result.content.includes("8080"));
    assert.ok(!result.content.includes("3000"));
  });

  it("errors when oldText not found in form", () => {
    const source = readFixture("simple.clj");
    const result = patchForm(source, "clojure", { name: "process-data" }, "nonexistent text", "replacement");
    assert.ok("error" in result);
    assert.ok(result.error.includes("oldText not found"));
  });

  it("errors when oldText matches multiple times in form", () => {
    const source = `(defn foo [x]\n  (+ x x))`;
    const result = patchForm(source, "clojure", { index: 0 }, "x", "y");
    assert.ok("error" in result);
    assert.ok(result.error.includes("multiple times"));
  });

  it("rejects patch that creates unbalanced brackets", () => {
    const source = readFixture("simple.clj");
    const result = patchForm(source, "clojure", { name: "process-data" }, "(map transform filtered)", "map transform filtered)");
    assert.ok("error" in result);
    assert.ok(result.error.includes("bracket error"));
  });

  it("allows patch that replaces with empty string (deletion)", () => {
    const source = readFixture("simple.clj");
    const result = patchForm(source, "clojure", { name: "config" }, "\n   :host \"localhost\"", "");
    assert.ok(!("error" in result));
    assert.ok(!result.content.includes("localhost"));
    assert.ok(result.content.includes(":port 3000"));
  });
});

describe("formatFormList", () => {
  it("formats a form list", () => {
    const source = readFixture("simple.clj");
    const { forms, errors } = listForms(source, "clojure");
    const output = formatFormList(forms, errors);
    assert.ok(output.includes("(ns myapp.core ...)"));
    assert.ok(output.includes("(def config ...)"));
    assert.ok(output.includes("(defn process-data ...)"));
    assert.ok(output.includes("[comments:"));
  });

  it("formats empty file", () => {
    const { forms, errors } = listForms("", "clojure");
    const output = formatFormList(forms, errors);
    assert.ok(output.includes("No top-level forms"));
  });
});
