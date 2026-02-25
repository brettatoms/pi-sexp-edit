/**
 * Top-level form operations: find, replace, insert, delete.
 */

import { parse, validate, type BracketError, type Language, type TopLevelForm } from "./parser.js";

export interface FormListResult {
  forms: TopLevelForm[];
  errors: BracketError[];
}

export interface FormEditResult {
  /** The new file content after the edit */
  content: string;
  /** The form that was targeted */
  targetForm: TopLevelForm;
}

export interface FormEditError {
  error: string;
  /** Available forms for reference (e.g., when form not found) */
  forms?: TopLevelForm[];
}

/**
 * List all top-level forms in source.
 */
export function listForms(source: string, lang: Language): FormListResult {
  const { forms, errors } = parse(source, lang);
  return { forms, errors };
}

/**
 * Find a form by name or index. Returns the form or an error.
 */
export function findForm(
  source: string,
  lang: Language,
  target: { name?: string; index?: number },
): TopLevelForm | FormEditError {
  const { forms } = parse(source, lang);

  if (target.index !== undefined) {
    if (target.index < 0 || target.index >= forms.length) {
      return { error: `Index ${target.index} out of range. File has ${forms.length} top-level forms (0-${forms.length - 1}).`, forms };
    }
    return forms[target.index];
  }

  if (target.name !== undefined) {
    const matches = forms.filter((f) => f.name === target.name);
    if (matches.length === 0) {
      return { error: `No top-level form named '${target.name}' found.`, forms };
    }
    if (matches.length > 1) {
      const locations = matches.map((f) => `  index ${f.index}: ${f.head} ${f.name} (line ${f.startLine})`).join("\n");
      return {
        error: `Multiple forms named '${target.name}' found. Use index to disambiguate:\n${locations}`,
        forms,
      };
    }
    return matches[0];
  }

  return { error: "Either 'name' or 'index' must be provided." };
}

/**
 * Replace a top-level form. Preserves attached leading comments.
 * The newForm is re-indented to match the original form's column position.
 */
export function replaceForm(
  source: string,
  lang: Language,
  target: { name?: string; index?: number },
  newForm: string,
): FormEditResult | FormEditError {
  // Validate newForm has balanced brackets
  const newFormErrors = validate(newForm, lang);
  if (newFormErrors.length > 0) {
    const err = newFormErrors[0];
    return { error: `newForm has bracket error: ${err.message} (line ${err.line}:${err.column})` };
  }

  const found = findForm(source, lang, target);
  if ("error" in found) return found;

  const indented = reindent(newForm, found.startColumn);

  // Replace just the form text (start to end), keep comments
  const before = source.slice(0, found.start);
  const after = source.slice(found.end);
  const content = before + indented + after;

  return { content, targetForm: found };
}

/**
 * Insert a new top-level form before or after a target form.
 */
export function insertForm(
  source: string,
  lang: Language,
  target: { name?: string; index?: number },
  newForm: string,
  position: "before" | "after" = "after",
): FormEditResult | FormEditError {
  // Validate newForm
  const newFormErrors = validate(newForm, lang);
  if (newFormErrors.length > 0) {
    const err = newFormErrors[0];
    return { error: `newForm has bracket error: ${err.message} (line ${err.line}:${err.column})` };
  }

  const found = findForm(source, lang, target);
  if ("error" in found) return found;

  const indented = reindent(newForm, found.startColumn);

  let content: string;
  if (position === "before") {
    // Insert before the form's comments (or the form itself if no comments)
    const insertPoint = found.commentStart;
    const before = source.slice(0, insertPoint);
    const after = source.slice(insertPoint);
    content = before + indented + "\n\n" + after;
  } else {
    // Insert after the form
    const insertPoint = found.end;
    const before = source.slice(0, insertPoint);
    const after = source.slice(insertPoint);
    content = before + "\n\n" + indented + after;
  }

  return { content, targetForm: found };
}

/**
 * Patch a top-level form by applying an oldText/newText replacement within it.
 * Errors if oldText is not found or matches multiple times within the form.
 */
export function patchForm(
  source: string,
  lang: Language,
  target: { name?: string; index?: number },
  oldText: string,
  newText: string,
): FormEditResult | FormEditError {
  const found = findForm(source, lang, target);
  if ("error" in found) return found;

  const formText = found.text;

  // Check how many times oldText appears in the form
  const firstIdx = formText.indexOf(oldText);
  if (firstIdx === -1) {
    return { error: `oldText not found in form '${found.head} ${found.name ?? "(unnamed)"}' (lines ${found.startLine}-${found.endLine}).` };
  }
  const secondIdx = formText.indexOf(oldText, firstIdx + 1);
  if (secondIdx !== -1) {
    return { error: `oldText matches multiple times (${countOccurrences(formText, oldText)}) in form '${found.head} ${found.name ?? "(unnamed)"}'. Use a longer oldText to disambiguate.` };
  }

  // Apply the patch
  const patchedForm = formText.slice(0, firstIdx) + newText + formText.slice(firstIdx + oldText.length);

  // Validate the patched form
  const errors = validate(patchedForm, lang);
  if (errors.length > 0) {
    const err = errors[0];
    return { error: `Patched form has bracket error: ${err.message} (line ${err.line}:${err.column})` };
  }

  // Write it back
  const before = source.slice(0, found.start);
  const after = source.slice(found.end);
  const content = before + patchedForm + after;

  return { content, targetForm: found };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += 1;
  }
  return count;
}

/**
 * Delete a top-level form and its attached leading comments.
 */
export function deleteForm(
  source: string,
  lang: Language,
  target: { name?: string; index?: number },
): FormEditResult | FormEditError {
  const found = findForm(source, lang, target);
  if ("error" in found) return found;

  // Remove from commentStart to end, plus any trailing blank line
  let deleteStart = found.commentStart;
  let deleteEnd = found.end;

  // Clean up: remove trailing newline(s) to avoid double blank lines
  while (deleteEnd < source.length && (source[deleteEnd] === "\n" || source[deleteEnd] === "\r")) {
    deleteEnd++;
    // Only consume one blank line
    break;
  }

  // If there's a leading newline before the comment block, consume it too
  if (deleteStart > 0 && source[deleteStart - 1] === "\n") {
    deleteStart--;
  }

  const before = source.slice(0, Math.max(0, deleteStart));
  const after = source.slice(deleteEnd);
  const content = before + after;

  return { content, targetForm: found };
}

/**
 * Format a form list for display.
 */
export function formatFormList(forms: TopLevelForm[], errors: BracketError[]): string {
  const lines: string[] = [];

  if (forms.length === 0) {
    lines.push("No top-level forms found.");
  } else {
    for (const form of forms) {
      const nameStr = form.name ? ` ${form.name}` : "";
      const headStr = form.head ? `(${form.head}${nameStr} ...)` : "(...)";
      const lineRange = form.startLine === form.endLine
        ? `line ${form.startLine}`
        : `lines ${form.startLine}-${form.endLine}`;
      const commentNote = form.commentStart < form.start
        ? `  [comments: lines ${form.commentStartLine}-${form.startLine - 1}]`
        : "";
      lines.push(`  ${form.index}: ${headStr}  ${lineRange}${commentNote}`);
    }
  }

  if (errors.length > 0) {
    lines.push("");
    lines.push("Bracket errors:");
    for (const err of errors) {
      lines.push(`  line ${err.line}:${err.column}: ${err.message}`);
    }
  }

  return lines.join("\n");
}

// --- Internal helpers ---

/**
 * Re-indent a form to a target column.
 * Strips existing indentation, then adds targetColumn spaces to each line.
 */
function reindent(form: string, targetColumn: number): string {
  const lines = form.split("\n");
  if (lines.length === 0) return form;

  // Find the minimum indentation across all non-empty lines
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    minIndent = Math.min(minIndent, indent);
  }
  if (!isFinite(minIndent)) minIndent = 0;

  // Re-indent: strip minIndent, add targetColumn
  const prefix = " ".repeat(targetColumn);
  return lines.map((line, i) => {
    if (line.trim() === "") return "";
    const stripped = line.slice(minIndent);
    // First line gets the target indent; subsequent lines also get it
    return prefix + stripped;
  }).join("\n").trimStart();
  // trimStart on the final result because the first line shouldn't have extra leading space
  // when the form is being placed at the exact position in the file
}
