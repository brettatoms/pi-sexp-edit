# pi-sexp-edit

A [pi-coding-agent](https://github.com/badlogic/pi-mono) extension for structured editing of s-expression languages. Replaces error-prone text-based find-and-replace with form-level operations backed by a paren-aware parser.

## Supported Languages

- **Clojure** (`.clj`, `.cljc`, `.cljs`)
- **Janet** (`.janet`)
- **Scheme** (`.scm`, `.ss`)
- **Racket** (`.rkt`)

## Installation

```bash
pi install git:github.com/brettatoms/pi-sexp-edit
```

Or for local development:

```bash
pi install /path/to/pi-sexp-edit
```

Or test without installing:

```bash
pi -e /path/to/pi-sexp-edit
```

## What It Does

### `sexp_edit` tool

A single tool with four operations for working with top-level forms (`defn`, `def`, `define`, `ns`, etc.):

- **`list`** — Show top-level forms with names, types, and line ranges
- **`replace`** — Replace a form by name or index. Preserves leading comments, auto-indents to match original position, validates balanced brackets before writing.
- **`insert`** — Add a new form before or after a target form
- **`delete`** — Remove a form and its attached leading comments

The tool activates automatically when a supported file is first touched in a session (zero token cost otherwise).

### Validation hook

Intercepts all `edit` and `write` tool calls on supported files. If the resulting file has unbalanced brackets, warns the LLM with the error location. Always active, zero token cost.

## Example

Instead of the LLM doing fragile text matching:

```
Edit file.clj
oldText: (defn process-data
  [items]
  (let [filtered (filter valid? items)]
    (map transform filtered)))
newText: (defn process-data
  [items opts]
  (let [filtered (filter (:pred opts) items)
        sorted (sort-by :id filtered)]
    (mapv transform sorted)))
```

It does:

```
sexp_edit
operation: replace
file: file.clj
name: process-data
newForm: (defn process-data
  [items opts]
  (let [filtered (filter (:pred opts) items)
        sorted (sort-by :id filtered)]
    (mapv transform sorted)))
```

The tool finds the form by name, validates the replacement, re-indents to match, and writes it. No `oldText` matching needed.

## Development

```bash
npm install
npm test
```
