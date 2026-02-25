import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";

import { parse, validate, detectLanguage } from "../src/core/parser.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

describe("detectLanguage", () => {
  it("detects Clojure files", () => {
    assert.equal(detectLanguage("foo.clj"), "clojure");
    assert.equal(detectLanguage("foo.cljc"), "clojure");
    assert.equal(detectLanguage("foo.cljs"), "clojure");
  });

  it("detects Janet files", () => {
    assert.equal(detectLanguage("foo.janet"), "janet");
  });

  it("detects Scheme files", () => {
    assert.equal(detectLanguage("foo.scm"), "scheme");
    assert.equal(detectLanguage("foo.ss"), "scheme");
  });

  it("detects Racket files", () => {
    assert.equal(detectLanguage("foo.rkt"), "racket");
  });

  it("returns null for unknown extensions", () => {
    assert.equal(detectLanguage("foo.py"), null);
    assert.equal(detectLanguage("foo.js"), null);
  });
});

describe("parse — Clojure", () => {
  it("parses simple.clj", () => {
    const source = readFixture("simple.clj");
    const { forms, errors } = parse(source, "clojure");

    assert.equal(errors.length, 0);
    assert.equal(forms.length, 6);

    assert.equal(forms[0].head, "ns");
    assert.equal(forms[0].name, "myapp.core");

    assert.equal(forms[1].head, "def");
    assert.equal(forms[1].name, "config");

    assert.equal(forms[2].head, "defn");
    assert.equal(forms[2].name, "process-data");
    // Should have attached comment
    assert.ok(forms[2].commentStart < forms[2].start, "process-data should have attached comment");

    assert.equal(forms[3].head, "defn-");
    assert.equal(forms[3].name, "helper");

    assert.equal(forms[4].head, "defmethod");
    assert.equal(forms[4].name, "handle-event");

    assert.equal(forms[5].head, "defmethod");
    assert.equal(forms[5].name, "handle-event");
  });

  it("parses reader conditionals", () => {
    const source = readFixture("reader-conditionals.clj");
    const { forms, errors } = parse(source, "clojure");

    assert.equal(errors.length, 0);
    assert.equal(forms.length, 4);

    assert.equal(forms[0].head, "ns");
    assert.equal(forms[1].head, "def");
    assert.equal(forms[1].name, "platform");
    assert.equal(forms[2].head, "defn");
    assert.equal(forms[2].name, "read-input");
    assert.equal(forms[3].head, "defn");
    assert.equal(forms[3].name, "complex-fn");
  });

  it("handles strings with parens inside", () => {
    const source = `(def x "(not a paren)")`;
    const { forms, errors } = parse(source, "clojure");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
    assert.equal(forms[0].name, "x");
  });

  it("handles regex with parens inside", () => {
    const source = `(def r #"(\\d+)")`;
    const { forms, errors } = parse(source, "clojure");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
  });

  it("handles #_ discard", () => {
    const source = `#_(def unused 1)\n(def used 2)`;
    const { forms, errors } = parse(source, "clojure");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
    assert.equal(forms[0].name, "used");
  });

  it("handles set literal #{}", () => {
    const source = `(def s #{1 2 3})`;
    const { forms, errors } = parse(source, "clojure");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
  });

  it("handles anonymous function #()", () => {
    const source = `(def f #(+ % 1))`;
    const { forms, errors } = parse(source, "clojure");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
  });

  it("handles metadata", () => {
    const source = `(defn ^:private ^{:doc "secret"} my-fn [x] x)`;
    const { forms, errors } = parse(source, "clojure");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
    assert.equal(forms[0].name, "my-fn");
  });
});

describe("parse — Janet", () => {
  it("parses simple.janet", () => {
    const source = readFixture("simple.janet");
    const { forms, errors } = parse(source, "janet");

    assert.equal(errors.length, 0);
    assert.equal(forms.length, 4);

    assert.equal(forms[0].head, "def");
    assert.equal(forms[0].name, "greeting");

    assert.equal(forms[1].head, "defn");
    assert.equal(forms[1].name, "greet");

    assert.equal(forms[2].head, "defn-");
    assert.equal(forms[2].name, "internal-helper");

    assert.equal(forms[3].head, "varfn");
    assert.equal(forms[3].name, "extensible-fn");
  });

  it("handles Janet long strings", () => {
    const source = '(def s ``hello (world) [bracket] {brace}``)\n(def x 1)';
    const { forms, errors } = parse(source, "janet");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 2);
  });

  it("handles # line comments", () => {
    const source = "# comment\n(def x 1)";
    const { forms, errors } = parse(source, "janet");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
  });
});

describe("parse — Scheme", () => {
  it("parses simple.scm", () => {
    const source = readFixture("simple.scm");
    const { forms, errors } = parse(source, "scheme");

    assert.equal(errors.length, 0);

    // define pi, define circle-area, define greet, define-record-type <point>, define-syntax my-when
    assert.equal(forms.length, 5);

    assert.equal(forms[0].head, "define");
    assert.equal(forms[0].name, "pi");

    assert.equal(forms[1].head, "define");
    assert.equal(forms[1].name, "circle-area");

    assert.equal(forms[2].head, "define");
    assert.equal(forms[2].name, "greet");

    assert.equal(forms[3].head, "define-record-type");
    assert.equal(forms[3].name, "<point>");

    assert.equal(forms[4].head, "define-syntax");
    assert.equal(forms[4].name, "my-when");
  });

  it("handles nested block comments", () => {
    const source = "#| outer #| inner |# still comment |#\n(define x 1)";
    const { forms, errors } = parse(source, "scheme");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
    assert.equal(forms[0].name, "x");
  });

  it("handles #; datum comment", () => {
    const source = "#;(define unused 1)\n(define used 2)";
    const { forms, errors } = parse(source, "scheme");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
    assert.equal(forms[0].name, "used");
  });

  it("handles (define (name args) body) form", () => {
    const source = "(define (factorial n)\n  (if (<= n 1) 1 (* n (factorial (- n 1)))))";
    const { forms, errors } = parse(source, "scheme");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
    assert.equal(forms[0].head, "define");
    assert.equal(forms[0].name, "factorial");
  });
});

describe("parse — Racket", () => {
  it("parses simple.rkt", () => {
    const source = readFixture("simple.rkt");
    const { forms, errors } = parse(source, "racket");

    assert.equal(errors.length, 0);

    // #lang is a token, require, define greeting, define add, define process,
    // define space-char, define paren-char
    const defines = forms.filter(f => f.head === "define" || f.head === "require");
    assert.ok(defines.length >= 5);
  });

  it("handles #rx regex", () => {
    const source = '(define r #rx"(\\\\d+)")';
    const { forms, errors } = parse(source, "racket");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
  });

  it("handles character literals including #\\(", () => {
    const source = "(define c #\\()";
    const { forms, errors } = parse(source, "racket");
    assert.equal(errors.length, 0);
    assert.equal(forms.length, 1);
    assert.equal(forms[0].name, "c");
  });
});

describe("validate", () => {
  it("returns no errors for balanced code", () => {
    const errors = validate("(defn foo [x] (+ x 1))", "clojure");
    assert.equal(errors.length, 0);
  });

  it("detects unclosed paren", () => {
    const errors = validate("(defn foo [x] (+ x 1)", "clojure");
    assert.ok(errors.length > 0);
    assert.ok(errors[0].message.includes("Unclosed"));
  });

  it("detects mismatched brackets", () => {
    const errors = validate("(defn foo [x] (+ x 1])", "clojure");
    assert.ok(errors.length > 0);
    assert.ok(errors[0].message.includes("Mismatched"));
  });

  it("detects extra closing bracket", () => {
    const errors = validate("(defn foo [x] (+ x 1)))", "clojure");
    assert.ok(errors.length > 0);
  });
});
