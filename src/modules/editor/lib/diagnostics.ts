import { syntaxTree } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";
import { usePreferencesStore } from "@/modules/settings/preferences";

const MAX_DIAGNOSTIC_DOC = 1_000_000;
const MAX_DIAGNOSTICS = 200;
const C_LIKE_EXTS = new Set([
  "c",
  "h",
  "cpp",
  "cc",
  "cxx",
  "hpp",
  "hxx",
  "cs",
  "java",
]);
const CSS_EXTS = new Set(["css", "scss", "sass", "less"]);
const JS_EXTS = new Set(["js", "jsx", "mjs", "cjs", "ts", "tsx"]);

type Options = {
  getPath: () => string;
};

export function localDiagnostics({ getPath }: Options): Extension {
  return linter((view) => {
    if (!usePreferencesStore.getState().editorDiagnosticsEnabled) return [];
    if (view.state.doc.length > MAX_DIAGNOSTIC_DOC) return [];
    const path = getPath();
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const diagnostics = parserDiagnostics(view.state);
    diagnostics.push(...delimiterDiagnostics(view.state));
    diagnostics.push(...semicolonDiagnostics(view.state, ext));
    return diagnostics.slice(0, MAX_DIAGNOSTICS);
  });
}

function parserDiagnostics(state: EditorState): Diagnostic[] {
  const out: Diagnostic[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (!node.type.isError || out.length >= MAX_DIAGNOSTICS) return;
      out.push({
        from: node.from,
        to: Math.max(node.to, node.from + 1),
        severity: "error",
        message: "Syntax error",
      });
    },
  });
  return out;
}

function delimiterDiagnostics(state: EditorState): Diagnostic[] {
  const text = state.doc.toString();
  const out: Diagnostic[] = [];
  const stack: { ch: string; pos: number }[] = [];
  let quote: { ch: string; pos: number } | null = null;
  let lineComment = false;
  let blockComment = false;

  const open = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]);
  const close = new Set(open.values());

  for (let i = 0; i < text.length && out.length < MAX_DIAGNOSTICS; i += 1) {
    const ch = text[i]!;
    const next = text[i + 1];
    const prev = text[i - 1];

    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote) {
      if (ch === "\n" && quote.ch !== "`") {
        out.push({
          from: quote.pos,
          to: quote.pos + 1,
          severity: "warning",
          message: "Unclosed string",
        });
        quote = null;
        continue;
      }
      if (ch === quote.ch && prev !== "\\") quote = null;
      continue;
    }

    if (ch === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = { ch, pos: i };
      continue;
    }
    if (open.has(ch)) {
      stack.push({ ch, pos: i });
      continue;
    }
    if (close.has(ch)) {
      const last = stack.pop();
      if (!last || open.get(last.ch) !== ch) {
        out.push({
          from: i,
          to: i + 1,
          severity: "warning",
          message: `Unmatched '${ch}'`,
        });
      }
    }
  }

  if (quote && out.length < MAX_DIAGNOSTICS) {
    out.push({
      from: quote.pos,
      to: quote.pos + 1,
      severity: "warning",
      message: "Unclosed string",
    });
  }
  while (stack.length && out.length < MAX_DIAGNOSTICS) {
    const item = stack.pop()!;
    out.push({
      from: item.pos,
      to: item.pos + 1,
      severity: "warning",
      message: `Unclosed '${item.ch}'`,
    });
  }
  return out;
}

function semicolonDiagnostics(state: EditorState, ext: string): Diagnostic[] {
  if (!C_LIKE_EXTS.has(ext) && !CSS_EXTS.has(ext) && !JS_EXTS.has(ext)) {
    return [];
  }
  const out: Diagnostic[] = [];
  for (let n = 1; n <= state.doc.lines && out.length < 80; n += 1) {
    const line = state.doc.line(n);
    const text = line.text.trim();
    if (
      !text ||
      text.startsWith("//") ||
      text.startsWith("/*") ||
      text.startsWith("*")
    ) {
      continue;
    }
    if (CSS_EXTS.has(ext)) {
      if (looksLikeCssDeclaration(text)) {
        out.push(warnAtLineEnd(line.to, "Missing semicolon"));
      }
      continue;
    }
    if (JS_EXTS.has(ext)) {
      if (looksLikeJsStatement(text)) {
        out.push(warnAtLineEnd(line.to, "Possible missing semicolon"));
      }
      continue;
    }
    if (looksLikeCLikeStatement(text)) {
      out.push(warnAtLineEnd(line.to, "Missing semicolon"));
    }
  }
  return out;
}

function warnAtLineEnd(pos: number, message: string): Diagnostic {
  return {
    from: Math.max(0, pos - 1),
    to: pos,
    severity: "info",
    message,
  };
}

function looksLikeCssDeclaration(text: string): boolean {
  return (
    text.includes(":") &&
    !/[;{}]$/.test(text) &&
    !text.startsWith("@") &&
    !text.endsWith(",")
  );
}

function looksLikeCLikeStatement(text: string): boolean {
  if (/[;{}:,]$/.test(text)) return false;
  if (text.startsWith("#")) return false;
  if (
    /^(if|for|while|switch|catch|else|do|try|class|struct|enum|namespace)\b/.test(
      text,
    )
  ) {
    return false;
  }
  return (
    /^(return|throw|break|continue)\b/.test(text) ||
    /=|\+\+|--|\bnew\b|\bdelete\b/.test(text)
  );
}

function looksLikeJsStatement(text: string): boolean {
  if (/[;{}:,]$/.test(text)) return false;
  if (
    /^(if|for|while|switch|catch|else|do|try|class|function|interface|type)\b/.test(
      text,
    )
  ) {
    return false;
  }
  return (
    /^(const|let|var|return|throw|break|continue|import|export)\b/.test(text) ||
    /=|\+\+|--|\bawait\b/.test(text)
  );
}
