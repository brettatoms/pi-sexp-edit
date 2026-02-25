/**
 * Paren-aware scanner for s-expression languages.
 * Tracks bracket nesting while skipping strings, comments, and regex literals.
 * Parameterized by language for dialect differences.
 *
 * Supported: Clojure (.clj, .cljc, .cljs), Janet (.janet),
 *            Scheme (.scm, .ss), Racket (.rkt)
 */

export type Language = "clojure" | "janet" | "scheme" | "racket";

export interface BracketError {
  line: number;
  column: number;
  message: string;
}

export interface TopLevelForm {
  /** 0-based index among top-level forms */
  index: number;
  /** Start byte offset (inclusive) of the form's opening bracket */
  start: number;
  /** End byte offset (exclusive) — one past the closing bracket */
  end: number;
  /** 1-based start line */
  startLine: number;
  /** 1-based end line */
  endLine: number;
  /** 0-based column of the opening bracket */
  startColumn: number;
  /** First symbol in the form (e.g., "defn", "ns", "define") */
  head: string | null;
  /** Second symbol in the form (e.g., the function name) */
  name: string | null;
  /** Start byte offset of attached leading comments, or same as `start` if none */
  commentStart: number;
  /** 1-based start line of attached leading comments */
  commentStartLine: number;
  /** The raw text of the form (excluding comments) */
  text: string;
}

const OPEN_BRACKETS = new Set(["(", "[", "{"]);
const CLOSE_BRACKETS = new Set([")", "]", "}"]);
const MATCHING: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/** Languages that use ; for line comments */
const SEMICOLON_COMMENT_LANGS = new Set<Language>(["clojure", "janet", "scheme", "racket"]);
/** Languages that use #| |# block comments (nested) */
const BLOCK_COMMENT_LANGS = new Set<Language>(["scheme", "racket"]);
/** Languages that use #; datum comments */
const DATUM_COMMENT_LANGS = new Set<Language>(["scheme", "racket"]);
/** Languages that use #_ discard */
const DISCARD_LANGS = new Set<Language>(["clojure"]);
/** Languages that have #"regex" */
const HASH_REGEX_LANGS = new Set<Language>(["clojure"]);
/** Languages that have #rx"..." and #px"..." */
const RACKET_REGEX_LANGS = new Set<Language>(["racket"]);
/** Languages with Janet-style # line comments */
const HASH_LINE_COMMENT_LANGS = new Set<Language>(["janet"]);
/** Languages with Janet long strings (backtick) */
const LONG_STRING_LANGS = new Set<Language>(["janet"]);
/** Languages with #\char character literals */
const CHAR_LITERAL_LANGS = new Set<Language>(["scheme", "racket"]);

export function detectLanguage(filePath: string): Language | null {
  if (/\.cljc?$/.test(filePath) || /\.cljs$/.test(filePath)) return "clojure";
  if (/\.janet$/.test(filePath)) return "janet";
  if (/\.scm$/.test(filePath) || /\.ss$/.test(filePath)) return "scheme";
  if (/\.rkt$/.test(filePath)) return "racket";
  return null;
}

/**
 * Parse source into top-level forms.
 * Returns the forms found, plus any bracket errors.
 */
export function parse(source: string, lang: Language): { forms: TopLevelForm[]; errors: BracketError[] } {
  const forms: TopLevelForm[] = [];
  const errors: BracketError[] = [];
  const len = source.length;

  let i = 0;
  let line = 1;
  let col = 0;
  let formIndex = 0;

  // Track comment lines before a form
  let pendingCommentStart = -1;
  let pendingCommentStartLine = -1;
  let lastBlankOrFormEndLine = 0;

  while (i < len) {
    const ch = source[i];

    // Newline
    if (ch === "\n") {
      line++;
      col = 0;
      i++;
      continue;
    }

    // Whitespace (comma is whitespace in Clojure, not in others — but harmless to treat it so)
    if (ch === " " || ch === "\t" || ch === "\r" || ch === ",") {
      col++;
      i++;
      continue;
    }

    // Line comments: ;
    if (ch === ";" && SEMICOLON_COMMENT_LANGS.has(lang)) {
      if (pendingCommentStart === -1 || pendingCommentStartLine < lastBlankOrFormEndLine) {
        pendingCommentStart = i;
        pendingCommentStartLine = line;
      }
      while (i < len && source[i] !== "\n") { i++; col++; }
      continue;
    }

    // Hash-prefixed constructs
    if (ch === "#") {
      const next = i + 1 < len ? source[i + 1] : "";

      // Janet # line comments
      if (HASH_LINE_COMMENT_LANGS.has(lang)) {
        if (pendingCommentStart === -1 || pendingCommentStartLine < lastBlankOrFormEndLine) {
          pendingCommentStart = i;
          pendingCommentStartLine = line;
        }
        while (i < len && source[i] !== "\n") { i++; col++; }
        continue;
      }

      // Block comments #|...|# (Scheme/Racket)
      if (next === "|" && BLOCK_COMMENT_LANGS.has(lang)) {
        if (pendingCommentStart === -1 || pendingCommentStartLine < lastBlankOrFormEndLine) {
          pendingCommentStart = i;
          pendingCommentStartLine = line;
        }
        const result = skipBlockComment(source, i, line, col);
        i = result.end;
        line = result.line;
        col = result.col;
        continue;
      }

      // #; datum comment (Scheme/Racket) — discard next form
      if (next === ";" && DATUM_COMMENT_LANGS.has(lang)) {
        i += 2;
        col += 2;
        skipWhitespaceAndUpdate();
        if (i < len && OPEN_BRACKETS.has(source[i])) {
          const result = scanForm(source, i, line, col, lang);
          if (!result.error) {
            line = result.endLine;
            col = countLastLineCol(source, i, result.end);
            i = result.end;
          } else {
            errors.push(result.error);
            i++; col++;
          }
        } else {
          skipToken();
        }
        continue;
      }

      // #_ discard (Clojure) — discard next form
      if (next === "_" && DISCARD_LANGS.has(lang)) {
        i += 2;
        col += 2;
        skipWhitespaceAndUpdate();
        if (i < len && OPEN_BRACKETS.has(source[i])) {
          const result = scanForm(source, i, line, col, lang);
          if (!result.error) {
            line = result.endLine;
            col = countLastLineCol(source, i, result.end);
            i = result.end;
          } else {
            errors.push(result.error);
            i++; col++;
          }
        } else {
          skipToken();
        }
        continue;
      }

      // #"regex" (Clojure)
      if (next === '"' && HASH_REGEX_LANGS.has(lang)) {
        i++; col++; // skip #
        const result = skipString(source, i, line, col);
        i = result.end; line = result.line; col = result.col;
        lastBlankOrFormEndLine = line;
        continue;
      }

      // #rx"..." #px"..." (Racket)
      if (RACKET_REGEX_LANGS.has(lang) && (next === "r" || next === "p")) {
        const rest = source.slice(i, i + 4);
        if (rest.startsWith("#rx\"") || rest.startsWith("#px\"")) {
          i += 3; col += 3; // skip #rx or #px, land on "
          const result = skipString(source, i, line, col);
          i = result.end; line = result.line; col = result.col;
          lastBlankOrFormEndLine = line;
          continue;
        }
      }

      // #\char character literals (Scheme/Racket) — e.g., #\( #\space #\newline
      if (next === "\\" && CHAR_LITERAL_LANGS.has(lang)) {
        i += 2; col += 2; // skip #\
        // Must consume at least one char (the literal character, even if it's a bracket)
        if (i < len) { i++; col++; }
        // Then consume rest of character name (e.g., #\space, #\newline)
        while (i < len && !isWhitespace(source[i]) && !OPEN_BRACKETS.has(source[i]) && !CLOSE_BRACKETS.has(source[i])) {
          i++; col++;
        }
        lastBlankOrFormEndLine = line;
        continue;
      }

      // #{set} #(anon-fn) #?(reader-conditional) — bracket caught next iteration
      // Just skip the # prefix
      i++;
      col++;
      continue;
    }

    // Opening bracket — start of a top-level form
    if (OPEN_BRACKETS.has(ch)) {
      const formStart = i;
      const formStartLine = line;
      const formStartCol = col;

      const result = scanForm(source, i, line, col, lang);
      if (result.error) {
        errors.push(result.error);
        i++; col++;
        continue;
      }

      const endOffset = result.end;
      const endLine = result.endLine;
      const formText = source.slice(formStart, endOffset);

      // Determine if pending comments are attached (no blank line gap)
      let commentStart = formStart;
      let commentStartLine = formStartLine;
      if (pendingCommentStart !== -1 && isCommentAttached(source, pendingCommentStart, formStart)) {
        commentStart = pendingCommentStart;
        commentStartLine = pendingCommentStartLine;
      }

      const { head, name } = extractHeadAndName(formText);

      forms.push({
        index: formIndex++,
        start: formStart,
        end: endOffset,
        startLine: formStartLine,
        endLine,
        startColumn: formStartCol,
        head,
        name,
        commentStart,
        commentStartLine,
        text: formText,
      });

      i = endOffset;
      line = endLine;
      col = countLastLineCol(source, formStart, endOffset);
      lastBlankOrFormEndLine = endLine;
      pendingCommentStart = -1;
      pendingCommentStartLine = -1;
      continue;
    }

    // Quote/deref/syntax-quote prefixes at top level — skip
    if (ch === "'" || ch === "`" || ch === "~" || ch === "@" || ch === "^") {
      // Backtick in Janet is a long string, not a quote prefix — handled above
      if (ch === "`" && LONG_STRING_LANGS.has(lang)) {
        const result = skipJanetLongString(source, i, line, col);
        i = result.end; line = result.line; col = result.col;
        lastBlankOrFormEndLine = line;
        continue;
      }
      i++;
      col++;
      continue;
    }

    // String at top level
    if (ch === '"') {
      const result = skipString(source, i, line, col);
      i = result.end; line = result.line; col = result.col;
      lastBlankOrFormEndLine = line;
      continue;
    }

    // Unmatched closing bracket at top level
    if (CLOSE_BRACKETS.has(ch)) {
      errors.push({ line, column: col, message: `Unexpected closing '${ch}' at top level` });
      i++;
      col++;
      continue;
    }

    // Any other character (symbol, number, keyword at top level) — skip token
    pendingCommentStart = -1;
    pendingCommentStartLine = -1;
    skipToken();
    lastBlankOrFormEndLine = line;
    continue;
  }

  return { forms, errors };

  // --- Closures over scanner state ---

  function skipWhitespaceAndUpdate() {
    while (i < len && (source[i] === " " || source[i] === "\t" || source[i] === "\n" || source[i] === "\r" || source[i] === ",")) {
      if (source[i] === "\n") { line++; col = 0; } else { col++; }
      i++;
    }
  }

  function skipToken() {
    while (i < len && !isWhitespace(source[i]) && !OPEN_BRACKETS.has(source[i]) && !CLOSE_BRACKETS.has(source[i])) {
      if (source[i] === "\n") { line++; col = 0; } else { col++; }
      i++;
    }
  }
}

/**
 * Validate that source has balanced brackets.
 * Returns errors if any brackets are unbalanced.
 */
export function validate(source: string, lang: Language): BracketError[] {
  const { errors } = parse(source, lang);
  return errors;
}

// --- Internal helpers ---

interface ScanResult {
  end: number;
  endLine: number;
  error: BracketError | null;
}

/**
 * Scan a balanced form starting at source[start], which must be an open bracket.
 * Returns the byte offset one past the closing bracket.
 */
function scanForm(source: string, start: number, startLine: number, startCol: number, lang: Language): ScanResult {
  const len = source.length;
  const stack: { char: string; line: number; col: number }[] = [];
  let i = start;
  let line = startLine;
  let col = startCol;

  while (i < len) {
    const ch = source[i];

    if (ch === "\n") {
      line++;
      col = 0;
      i++;
      continue;
    }

    // Line comments: ;
    if (ch === ";" && SEMICOLON_COMMENT_LANGS.has(lang)) {
      while (i < len && source[i] !== "\n") { i++; col++; }
      continue;
    }

    // Hash constructs inside forms
    if (ch === "#") {
      const next = i + 1 < len ? source[i + 1] : "";

      // Janet # line comment inside forms
      if (HASH_LINE_COMMENT_LANGS.has(lang)) {
        while (i < len && source[i] !== "\n") { i++; col++; }
        continue;
      }

      // Block comments #|...|#
      if (next === "|" && BLOCK_COMMENT_LANGS.has(lang)) {
        const result = skipBlockComment(source, i, line, col);
        i = result.end; line = result.line; col = result.col;
        continue;
      }

      // #; datum comment
      if (next === ";" && DATUM_COMMENT_LANGS.has(lang)) {
        i += 2; col += 2;
        // The discarded form's brackets still get scanned (they must balance)
        continue;
      }

      // #_ discard
      if (next === "_" && DISCARD_LANGS.has(lang)) {
        i += 2; col += 2;
        continue;
      }

      // #"regex" (Clojure)
      if (next === '"' && HASH_REGEX_LANGS.has(lang)) {
        i++; col++;
        const result = skipString(source, i, line, col);
        i = result.end; line = result.line; col = result.col;
        continue;
      }

      // #rx"..." #px"..." (Racket)
      if (RACKET_REGEX_LANGS.has(lang) && (next === "r" || next === "p")) {
        const rest = source.slice(i, i + 4);
        if (rest.startsWith("#rx\"") || rest.startsWith("#px\"")) {
          i += 3; col += 3;
          const result = skipString(source, i, line, col);
          i = result.end; line = result.line; col = result.col;
          continue;
        }
      }

      // #\char character literals
      if (next === "\\" && CHAR_LITERAL_LANGS.has(lang)) {
        i += 2; col += 2;
        // Must consume at least one char (the literal character, even if it's a bracket)
        if (i < len) { i++; col++; }
        while (i < len && !isWhitespace(source[i]) && !OPEN_BRACKETS.has(source[i]) && !CLOSE_BRACKETS.has(source[i])) {
          i++; col++;
        }
        continue;
      }

      // Other # prefixes — skip the #
      i++; col++;
      continue;
    }

    // Strings
    if (ch === '"') {
      const result = skipString(source, i, line, col);
      i = result.end; line = result.line; col = result.col;
      continue;
    }

    // Janet long strings
    if (ch === "`" && LONG_STRING_LANGS.has(lang)) {
      const result = skipJanetLongString(source, i, line, col);
      i = result.end; line = result.line; col = result.col;
      continue;
    }

    // Open bracket
    if (OPEN_BRACKETS.has(ch)) {
      stack.push({ char: ch, line, col });
      i++; col++;
      continue;
    }

    // Close bracket
    if (CLOSE_BRACKETS.has(ch)) {
      if (stack.length === 0) {
        return { end: i + 1, endLine: line, error: { line, column: col, message: `Unexpected '${ch}'` } };
      }
      const open = stack.pop()!;
      const expected = MATCHING[open.char];
      if (ch !== expected) {
        return {
          end: i + 1,
          endLine: line,
          error: {
            line, column: col,
            message: `Mismatched bracket: expected '${expected}' to close '${open.char}' at line ${open.line}:${open.col}, but found '${ch}'`,
          },
        };
      }
      if (stack.length === 0) {
        return { end: i + 1, endLine: line, error: null };
      }
      i++; col++;
      continue;
    }

    // Everything else
    col++;
    i++;
  }

  // Unclosed brackets
  if (stack.length > 0) {
    const open = stack[stack.length - 1];
    return {
      end: len, endLine: line,
      error: { line: open.line, column: open.col, message: `Unclosed '${open.char}' opened at line ${open.line}:${open.col}` },
    };
  }

  return { end: len, endLine: line, error: null };
}

interface SkipResult {
  end: number;
  line: number;
  col: number;
}

/** Skip a double-quoted string starting at the opening `"`. */
function skipString(source: string, start: number, startLine: number, startCol: number): SkipResult {
  let i = start + 1;
  let line = startLine;
  let col = startCol + 1;

  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2; col += 2;
      continue;
    }
    if (ch === '"') {
      return { end: i + 1, line, col: col + 1 };
    }
    if (ch === "\n") {
      line++; col = 0;
    } else {
      col++;
    }
    i++;
  }
  return { end: source.length, line, col };
}

/** Skip a Janet long string starting at the opening backtick(s). */
function skipJanetLongString(source: string, start: number, startLine: number, startCol: number): SkipResult {
  let ticks = 0;
  let i = start;
  while (i < source.length && source[i] === "`") { ticks++; i++; }

  let line = startLine;
  let col = startCol + ticks;

  while (i < source.length) {
    if (source[i] === "`") {
      let count = 0;
      const tickStart = i;
      while (i < source.length && source[i] === "`") { count++; i++; }
      if (count === ticks) {
        return { end: i, line, col: col + (i - tickStart) };
      }
      col += count;
      continue;
    }
    if (source[i] === "\n") {
      line++; col = 0;
    } else {
      col++;
    }
    i++;
  }
  return { end: source.length, line, col };
}

/** Skip a nested block comment #|...|# */
function skipBlockComment(source: string, start: number, startLine: number, startCol: number): SkipResult {
  let i = start + 2; // skip #|
  let line = startLine;
  let col = startCol + 2;
  let depth = 1;

  while (i < source.length && depth > 0) {
    if (source[i] === "#" && i + 1 < source.length && source[i + 1] === "|") {
      depth++;
      i += 2; col += 2;
      continue;
    }
    if (source[i] === "|" && i + 1 < source.length && source[i + 1] === "#") {
      depth--;
      i += 2; col += 2;
      continue;
    }
    if (source[i] === "\n") {
      line++; col = 0;
    } else {
      col++;
    }
    i++;
  }
  return { end: i, line, col };
}

/** Check if comment block is attached to form (no blank line gap between them). */
function isCommentAttached(source: string, commentStart: number, formStart: number): boolean {
  const between = source.slice(commentStart, formStart);
  const lines = between.split("\n");
  let pastComment = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      if (pastComment) return false;
    } else if (trimmed.startsWith(";") || trimmed.startsWith("#")) {
      pastComment = true;
    }
  }
  return true;
}

/** Extract head (first symbol) and name (second symbol) from a form's text. */
function extractHeadAndName(formText: string): { head: string | null; name: string | null } {
  let i = 1;
  const len = formText.length;

  // Skip whitespace
  while (i < len && isWhitespace(formText[i])) i++;

  // Read head symbol
  const headStart = i;
  while (i < len && !isWhitespace(formText[i]) && !OPEN_BRACKETS.has(formText[i]) && !CLOSE_BRACKETS.has(formText[i])) i++;
  const head = i > headStart ? formText.slice(headStart, i) : null;
  if (!head) return { head: null, name: null };

  // Skip whitespace
  while (i < len && isWhitespace(formText[i])) i++;

  // Skip metadata (^:keyword or ^{...}) — Clojure
  while (i < len && formText[i] === "^") {
    i++;
    if (i < len && formText[i] === "{") {
      let depth = 1;
      i++;
      while (i < len && depth > 0) {
        if (formText[i] === "{") depth++;
        else if (formText[i] === "}") depth--;
        i++;
      }
    } else {
      while (i < len && !isWhitespace(formText[i]) && !OPEN_BRACKETS.has(formText[i]) && !CLOSE_BRACKETS.has(formText[i])) i++;
    }
    while (i < len && isWhitespace(formText[i])) i++;
  }

  // For Scheme/Racket `(define (name args) body)` — name is inside a nested list
  if (i < len && formText[i] === "(" && (head === "define" || head === "define-syntax" || head === "define-record-type")) {
    // Read the first symbol inside the parens
    i++; // skip (
    while (i < len && isWhitespace(formText[i])) i++;
    const nameStart = i;
    while (i < len && !isWhitespace(formText[i]) && !OPEN_BRACKETS.has(formText[i]) && !CLOSE_BRACKETS.has(formText[i])) i++;
    const name = i > nameStart ? formText.slice(nameStart, i) : null;
    return { head, name };
  }

  // Read name symbol
  const nameStart = i;
  while (i < len && !isWhitespace(formText[i]) && !OPEN_BRACKETS.has(formText[i]) && !CLOSE_BRACKETS.has(formText[i])) i++;
  const name = i > nameStart ? formText.slice(nameStart, i) : null;

  return { head, name };
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ",";
}

/** Count the column at the end of a range in source. */
function countLastLineCol(source: string, _start: number, end: number): number {
  let col = 0;
  let i = end - 1;
  while (i >= 0 && source[i] !== "\n") {
    col++;
    i--;
  }
  return col;
}
