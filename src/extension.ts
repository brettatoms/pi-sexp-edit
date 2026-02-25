/**
 * sexp-edit: Pi extension for structured editing of s-expression languages.
 *
 * Provides:
 * 1. `sexp_edit` tool — form-level operations (list, replace, insert, delete)
 * 2. Validation hook — intercepts edit/write on sexp files, warns on unbalanced brackets
 * 3. Conditional activation — tool activates when sexp files are first touched
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

import { detectLanguage, validate, type Language } from "./core/parser.js";
import { listForms, replaceForm, insertForm, deleteForm, patchForm, formatFormList } from "./core/forms.js";

const SEXP_EXTENSIONS = /\.(clj|cljc|cljs|janet|scm|ss|rkt)$/;

export default function sexpEditExtension(pi: ExtensionAPI) {
  let toolActivated = false;

  // --- Tool registration ---

  const tool = {
    name: "sexp_edit",
    label: "S-Expression Edit",
    description:
      "Structural editing for s-expression files (Clojure, Janet, Scheme, Racket). " +
      "Operates on top-level forms (defn, def, define, ns, etc.) by name or index. " +
      "Use `list` to see form structure, `replace` to swap a form (preserves leading comments, " +
      "auto-indents to match original position), `insert` to add a form, `delete` to remove one, " +
      "`patch` to make a small edit within a form (oldText/newText scoped to the target form). " +
      "Replacement code is validated for balanced brackets before writing. " +
      "Prefer this over `edit` for .clj/.cljc/.cljs/.janet/.scm/.ss/.rkt files.",
    parameters: Type.Object({
      operation: StringEnum(["list", "replace", "insert", "delete", "patch"] as const, {
        description: "Operation to perform",
      }),
      file: Type.String({ description: "Path to the file (relative or absolute)" }),
      name: Type.Optional(Type.String({
        description: "Target form by name (e.g., 'process-data'). For replace/insert/delete.",
      })),
      index: Type.Optional(Type.Number({
        description: "Target form by 0-based index. Alternative to name. For replace/insert/delete.",
      })),
      newForm: Type.Optional(Type.String({
        description: "New form code. For replace and insert. Validated for balanced brackets before writing.",
      })),
      oldText: Type.Optional(Type.String({
        description: "Text to find within the target form. For patch operation.",
      })),
      newText: Type.Optional(Type.String({
        description: "Replacement text. For patch operation.",
      })),
      position: Type.Optional(StringEnum(["before", "after"] as const, {
        description: "Insert position relative to target form. Default: 'after'.",
      })),
    }),

    async execute(
      _toolCallId: string,
      params: {
        operation: "list" | "replace" | "insert" | "delete" | "patch";
        file: string;
        name?: string;
        index?: number;
        newForm?: string;
        oldText?: string;
        newText?: string;
        position?: "before" | "after";
      },
      _signal: AbortSignal | undefined,
      _onUpdate: any,
      ctx: any,
    ) {
      const filePath = resolve(ctx.cwd, params.file.replace(/^@/, ""));
      const lang = detectLanguage(filePath);

      if (!lang) {
        return {
          content: [{ type: "text" as const, text: `Not a supported s-expression file: ${filePath}\nSupported: .clj, .cljc, .cljs, .janet, .scm, .ss, .rkt` }],
          isError: true,
          details: {},
        };
      }

      let source: string;
      try {
        source = readFileSync(filePath, "utf-8");
      } catch (err: any) {
        if (params.operation === "insert" && err.code === "ENOENT") {
          // For insert on a new file, start with empty content
          source = "";
        } else {
          return {
            content: [{ type: "text" as const, text: `Error reading file: ${err.message}` }],
            isError: true,
            details: {},
          };
        }
      }

      switch (params.operation) {
        case "list": {
          const { forms, errors } = listForms(source, lang);
          const output = formatFormList(forms, errors);
          return {
            content: [{ type: "text" as const, text: output }],
            details: { formCount: forms.length, errorCount: errors.length },
          };
        }

        case "replace": {
          if (!params.newForm) {
            return {
              content: [{ type: "text" as const, text: "newForm is required for replace operation." }],
              isError: true,
              details: {},
            };
          }
          const target = buildTarget(params);
          if ("error" in target) return target;

          const result = replaceForm(source, lang, target, params.newForm);
          if ("error" in result) {
            return {
              content: [{ type: "text" as const, text: result.error + (result.forms ? "\n\nAvailable forms:\n" + formatFormList(result.forms, []) : "") }],
              isError: true,
              details: {},
            };
          }

          writeFileSync(filePath, result.content, "utf-8");
          return {
            content: [{ type: "text" as const, text: `Replaced form '${result.targetForm.head} ${result.targetForm.name ?? "(unnamed)"}' at line ${result.targetForm.startLine}.` }],
            details: { targetForm: result.targetForm.name, line: result.targetForm.startLine },
          };
        }

        case "insert": {
          if (!params.newForm) {
            return {
              content: [{ type: "text" as const, text: "newForm is required for insert operation." }],
              isError: true,
              details: {},
            };
          }

          // Handle empty/new file: just write the form
          if (source.trim() === "") {
            const errors = validate(params.newForm, lang);
            if (errors.length > 0) {
              const err = errors[0];
              return {
                content: [{ type: "text" as const, text: `newForm has bracket error: ${err.message} (line ${err.line}:${err.column})` }],
                isError: true,
                details: {},
              };
            }
            writeFileSync(filePath, params.newForm + "\n", "utf-8");
            return {
              content: [{ type: "text" as const, text: `Inserted form into empty file.` }],
              details: {},
            };
          }

          const target = buildTarget(params);
          if ("error" in target) return target;

          const result = insertForm(source, lang, target, params.newForm, params.position ?? "after");
          if ("error" in result) {
            return {
              content: [{ type: "text" as const, text: result.error + (result.forms ? "\n\nAvailable forms:\n" + formatFormList(result.forms, []) : "") }],
              isError: true,
              details: {},
            };
          }

          writeFileSync(filePath, result.content, "utf-8");
          return {
            content: [{ type: "text" as const, text: `Inserted form ${params.position ?? "after"} '${result.targetForm.head} ${result.targetForm.name ?? "(unnamed)"}' at line ${result.targetForm.startLine}.` }],
            details: { targetForm: result.targetForm.name, line: result.targetForm.startLine },
          };
        }

        case "delete": {
          const target = buildTarget(params);
          if ("error" in target) return target;

          const result = deleteForm(source, lang, target);
          if ("error" in result) {
            return {
              content: [{ type: "text" as const, text: result.error + (result.forms ? "\n\nAvailable forms:\n" + formatFormList(result.forms, []) : "") }],
              isError: true,
              details: {},
            };
          }

          writeFileSync(filePath, result.content, "utf-8");
          return {
            content: [{ type: "text" as const, text: `Deleted form '${result.targetForm.head} ${result.targetForm.name ?? "(unnamed)"}' at line ${result.targetForm.startLine}.` }],
            details: { targetForm: result.targetForm.name, line: result.targetForm.startLine },
          };
        }

        case "patch": {
          if (!params.oldText || params.newText === undefined) {
            return {
              content: [{ type: "text" as const, text: "oldText and newText are required for patch operation." }],
              isError: true,
              details: {},
            };
          }
          const target = buildTarget(params);
          if ("error" in target) return target;

          const result = patchForm(source, lang, target, params.oldText, params.newText);
          if ("error" in result) {
            return {
              content: [{ type: "text" as const, text: result.error + (result.forms ? "\n\nAvailable forms:\n" + formatFormList(result.forms, []) : "") }],
              isError: true,
              details: {},
            };
          }

          writeFileSync(filePath, result.content, "utf-8");
          return {
            content: [{ type: "text" as const, text: `Patched form '${result.targetForm.head} ${result.targetForm.name ?? "(unnamed)"}' at line ${result.targetForm.startLine}.` }],
            details: { targetForm: result.targetForm.name, line: result.targetForm.startLine },
          };
        }
      }
    },
  };

  // Start with tool inactive
  // It will be activated when a sexp file is first touched

  // --- Conditional activation ---

  function activateTool() {
    if (toolActivated) return;
    toolActivated = true;
    const currentTools = pi.getActiveTools();
    pi.setActiveTools([...currentTools, "sexp_edit"]);
  }

  function checkForSexpFile(filePath: string | undefined) {
    if (!filePath || toolActivated) return;
    if (SEXP_EXTENSIONS.test(filePath)) {
      activateTool();
    }
  }

  // Register the tool (it exists but is not active until a sexp file is touched)
  pi.registerTool(tool);

  // Remove it from active tools initially
  pi.on("session_start", async () => {
    const active = pi.getActiveTools();
    if (!toolActivated) {
      pi.setActiveTools(active.filter((t) => t !== "sexp_edit"));
    }
  });

  // Watch for sexp files being touched
  pi.on("tool_result", async (event) => {
    if (toolActivated) return;

    // Check file paths in tool results
    if (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") {
      const input = event.input as any;
      checkForSexpFile(input?.path);
    }

    // Check bash output for sexp file references
    if (event.toolName === "bash") {
      const content = event.content;
      if (content && Array.isArray(content)) {
        for (const item of content) {
          if (item.type === "text" && SEXP_EXTENSIONS.test(item.text)) {
            activateTool();
            break;
          }
        }
      }
    }
  });

  // Also check tool_call for edit/write targeting sexp files
  pi.on("tool_call", async (event) => {
    if (!toolActivated) {
      const input = event.input as any;
      if (event.toolName === "edit" || event.toolName === "write" || event.toolName === "read") {
        checkForSexpFile(input?.path);
      }
    }
  });

  // --- Validation hook ---
  // Intercepts edit/write tool results for sexp files and warns on unbalanced brackets

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    if (event.isError) return;

    const input = event.input as any;
    const filePath = input?.path;
    if (!filePath) return;

    const resolvedPath = resolve(ctx.cwd, filePath.replace(/^@/, ""));
    const lang = detectLanguage(resolvedPath);
    if (!lang) return;

    // Read the file after the edit/write and validate
    let source: string;
    try {
      source = readFileSync(resolvedPath, "utf-8");
    } catch {
      return; // Can't read, skip validation
    }

    const errors = validate(source, lang);
    if (errors.length === 0) return;

    // Inject warning into the tool result
    const warnings = errors.map((e) => `  line ${e.line}:${e.column}: ${e.message}`).join("\n");
    const warningText =
      `\n\n⚠️ Bracket imbalance detected in ${filePath}:\n${warnings}\n` +
      `Use \`sexp_edit list\` to see the file structure, or \`sexp_edit replace\` to replace the affected form.`;

    // Append warning to existing content
    const existingContent = event.content ?? [];
    return {
      content: [
        ...existingContent,
        { type: "text" as const, text: warningText },
      ],
    };
  });
}

// --- Helpers ---

function buildTarget(params: { name?: string; index?: number }) {
  if (params.name === undefined && params.index === undefined) {
    return {
      content: [{ type: "text" as const, text: "Either 'name' or 'index' must be provided for this operation." }],
      isError: true,
      details: {},
    };
  }
  return { name: params.name, index: params.index };
}
