import MagicString from "magic-string";
import { isParseError, parseModule, parseScript, type ESTree } from "meriyah";

export const MAX_REWRITE_LENGTH = 20 * 1024 * 1024;

/** Lets a rewritten script run in workers and frames that never got the runtime; there the helpers pass values through. */
// Indirect eval goes through a local so re-rewriting the shim catches neither a bare nor a global eval (R10).
export const STANDALONE_SHIM =
  'globalThis.__g$||(globalThis.__g$={L:function(v){return v},N:function(t,v){return v},S:function(o,k,v,p){return p==="&&="?o[k]&&(o[k]=v):p==="||="?o[k]||(o[k]=v):p==="??="?(o[k]!=null?o[k]:o[k]=v):o[k]=v},D:function(o){return o},E:function(v){return v},ev:function(c){var e=globalThis["eval"];return e(c)},I:function(v){return v},H:function(v){return v},M:function(v){return v},P:function(v){return v},W:function(v){return v}});';

export interface JsRewriteOptions {
  kind?: "classic" | "module" | "handler";
  standalone?: boolean;
}

/** `assign` is a destructuring or for-in/of target, where `location` gets a setter that converts the URL. */
type Role = "read" | "target" | "assign" | "binding" | "callee";

const PARSE_OPTIONS = { ranges: true, webcompat: true, next: true } as const;
const HELPERS = new Set(["L", "N", "S", "D", "E", "ev", "I", "H", "M", "P", "W"]);
const GLOBAL_NAMES = new Set(["window", "globalThis", "self"]);
const WINDOW_REFS = new Set(["top", "parent", "opener", "frames"]);
const WINDOW_LIKE = new Set([
  "window",
  "self",
  "globalThis",
  "top",
  "parent",
  "opener",
  "frames",
  "contentWindow",
  "defaultView",
]);
const WRAPPED_NAME = /location|top|parent|opener|frames/;
const PLAIN_OR_LOGICAL = new Set(["=", "&&=", "||=", "??="]);
// A setter keeps a local binding named `location` working, while a real Location gets the converted URL.
const LOCATION_SETTER = "({ set v(__g$v) { location = __g$.N(location, __g$v); } }).v";

/** Routes reads and writes of `location` through the runtime's __g$ helpers; unparsable source is returned as is. */
export function rewriteJs(source: string, options: JsRewriteOptions = {}): string {
  if (source.length > MAX_REWRITE_LENGTH) return source;
  if (
    !source.includes("location") &&
    !source.includes("eval") &&
    !source.includes("import") &&
    !source.includes("postMessage") &&
    !WRAPPED_NAME.test(source)
  ) {
    return source;
  }
  const program = parse(source, options.kind ?? "classic");
  if (!program) return source;
  const output = new MagicString(source);
  try {
    new LocationRewriter(source, output).visit(program, "read", false);
  } catch {
    // Pathologically deep code can overflow the stack; serving it unrewritten beats failing the page.
    return source;
  }
  if (!output.hasChanged()) return source;
  if (options.standalone) {
    // The shim goes after any "use strict" prologue, which only counts at the very start.
    let last: ESTree.Statement | undefined;
    for (const statement of program.body) {
      if (statement.type !== "ExpressionStatement" || !("directive" in statement)) break;
      last = statement;
    }
    if (last) output.appendLeft(last.end as number, STANDALONE_SHIM);
    else output.prepend(STANDALONE_SHIM);
  }
  return output.toString();
}

function parse(source: string, kind: NonNullable<JsRewriteOptions["kind"]>): ESTree.Program | null {
  try {
    if (kind === "module") return parseModule(source, PARSE_OPTIONS);
    if (kind === "handler") return parseScript(source, { ...PARSE_OPTIONS, globalReturn: true });
    try {
      return parseScript(source, PARSE_OPTIONS);
    } catch (error) {
      // Module scripts loaded by URL reach the worker without their type attribute.
      if (!isParseError(error)) throw error;
      return parseModule(source, PARSE_OPTIONS);
    }
  } catch {
    return null;
  }
}

/** Without scope analysis every `location` is wrapped; the helpers pass values through unless they are a real Location. */
class LocationRewriter {
  readonly #source: string;
  readonly #output: MagicString;
  #shorthand = false;

  constructor(source: string, output: MagicString) {
    this.#source = source;
    this.#output = output;
  }

  visit(node: ESTree.Node | null | undefined, role: Role, inChain: boolean): void {
    if (!node) return;
    switch (node.type) {
      case "Identifier":
        if (role === "assign" && node.name === "location") {
          const prefix = this.#shorthand ? "location: " : "";
          this.#output.overwrite(start(node), end(node), prefix + LOCATION_SETTER);
        } else if (role === "read" && node.name === "location") this.#wrap(node);
        else if (role === "read" && WINDOW_REFS.has(node.name)) this.#call("__g$.W(", ")", node);
        // A bare `eval` read is indirect eval; the wrapper rewrites the code before running it.
        else if (role === "read" && node.name === "eval") this.#output.overwrite(start(node), end(node), "__g$.ev");
        return;
      case "MemberExpression":
        this.#member(node, role, inChain);
        return;
      case "ChainExpression":
        this.visit(node.expression, role, true);
        return;
      case "BinaryExpression":
      case "LogicalExpression": {
        // Long "a"+"b"+... chains nest leftwards; walking them in a loop keeps deep ones off the call stack.
        const rights: ESTree.Node[] = [];
        let current: ESTree.Node = node;
        while (current.type === "BinaryExpression" || current.type === "LogicalExpression") {
          rights.push(current.right);
          current = current.left;
        }
        this.visit(current, "read", false);
        for (let index = rights.length - 1; index >= 0; index--) this.visit(rights[index], "read", false);
        return;
      }
      case "CallExpression": {
        if (isHelperCall(node)) return;
        const callee = node.callee;
        const directEval = callee.type === "Identifier" && callee.name === "eval";
        // `window.eval`/`window["eval"]` on a global is the global eval; an unrelated `obj.eval` is left alone.
        const globalEval =
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          GLOBAL_NAMES.has(callee.object.name) &&
          (callee.computed
            ? callee.property.type === "Literal" && callee.property.value === "eval"
            : callee.property.type === "Identifier" && callee.property.name === "eval");
        const first = node.arguments[0];
        if ((directEval || globalEval) && first && first.type !== "SpreadElement" && !isHelperCall(first)) {
          this.#call("__g$.E(", ")", first);
        }
        if (isPostMessageCallee(callee) && !isHelperCall(callee.object)) this.#messageTarget(callee, inChain);
        // A direct eval must keep its callee bare, or it would become an indirect eval and lose scope.
        if (!directEval) this.visit(callee, "callee", inChain);
        for (const argument of node.arguments) this.visit(argument, "read", false);
        return;
      }
      case "ImportExpression":
        if (!isHelperCall(node.source)) this.#call("__g$.I(", ")", node.source);
        this.visit(node.source, "read", false);
        if (node.options) this.visit(node.options, "read", false);
        return;
      case "NewExpression":
        // `new __g$.L(x).y()` would construct the helper, so a callee that gets wrapped is parenthesised first.
        if (this.#source.slice(start(node.callee), end(node.callee)).match(WRAPPED_NAME)) {
          this.#output.appendRight(start(node.callee), "(");
          this.#output.appendLeft(end(node.callee), ")");
        }
        this.visit(node.callee, "read", false);
        for (const argument of node.arguments) this.visit(argument, "read", false);
        return;
      case "TaggedTemplateExpression":
        this.visit(node.tag, "callee", false);
        this.visit(node.quasi, "read", false);
        return;
      case "AssignmentExpression":
        this.#assignment(node);
        return;
      case "UpdateExpression":
        this.visit(node.argument, "target", false);
        return;
      case "UnaryExpression":
        // An undeclared name stays safe under typeof only while it is left bare.
        if (node.operator === "typeof" && node.argument.type === "Identifier" && WINDOW_REFS.has(node.argument.name)) {
          return;
        }
        this.visit(node.argument, node.operator === "delete" ? "target" : "read", false);
        return;
      case "ForInStatement":
      case "ForOfStatement":
        this.visit(node.left, node.left.type === "VariableDeclaration" ? "read" : "assign", false);
        this.visit(node.right, "read", false);
        this.visit(node.body, "read", false);
        return;
      case "VariableDeclarator":
        this.visit(node.id, "binding", false);
        if (node.init && node.id.type === "ObjectPattern" && hasWrappedKey(node.id) && !isHelperCall(node.init)) {
          this.#call("__g$.D(", ")", node.init);
        }
        this.visit(node.init, "read", false);
        return;
      case "ObjectExpression":
        for (const property of node.properties) {
          if (property.type === "Property" && property.shorthand && isLocationIdentifier(property.value)) {
            this.#output.overwrite(start(property), end(property), "location: __g$.L(location)");
          } else if (
            property.type === "Property" &&
            property.shorthand &&
            property.value.type === "Identifier" &&
            WINDOW_REFS.has(property.value.name)
          ) {
            const name = property.value.name;
            this.#output.overwrite(start(property), end(property), `${name}: __g$.W(${name})`);
          } else {
            this.visit(property, "read", false);
          }
        }
        return;
      case "Property":
        if (node.computed) this.visit(node.key, "read", false);
        // `{ location } = o` is shorthand, so the key has to be written out before the value changes.
        this.#shorthand = role === "assign" && node.shorthand;
        this.visit(node.value, role, false);
        this.#shorthand = false;
        return;
      case "ObjectPattern":
        for (const property of node.properties) this.visit(property, role, false);
        return;
      case "ArrayPattern":
        for (const element of node.elements) this.visit(element, role, false);
        return;
      case "AssignmentPattern":
        this.visit(node.left, role, false);
        this.visit(node.right, "read", false);
        return;
      case "RestElement":
        this.visit(node.argument, role, false);
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        for (const param of node.params) this.visit(param, "binding", false);
        this.visit(node.body, "read", false);
        return;
      case "ClassDeclaration":
      case "ClassExpression":
        this.visit(node.superClass, "read", false);
        this.visit(node.body, "read", false);
        return;
      case "MethodDefinition":
      case "PropertyDefinition":
      case "AccessorProperty":
        if (node.computed) this.visit(node.key, "read", false);
        this.visit(node.value, "read", false);
        return;
      case "LabeledStatement":
        this.visit(node.body, "read", false);
        return;
      case "CatchClause":
        this.visit(node.param, "binding", false);
        this.visit(node.body, "read", false);
        return;
      case "ExportNamedDeclaration":
        this.visit(node.declaration, "read", false);
        return;
      case "BreakStatement":
      case "ContinueStatement":
      case "ImportDeclaration":
      case "ExportAllDeclaration":
      case "MetaProperty":
        return;
      default:
        this.#children(node);
    }
  }

  #member(node: ESTree.MemberExpression, role: Role, inChain: boolean): void {
    if (role === "assign" && isLocationMember(node)) {
      const operator = this.#source.lastIndexOf(node.computed ? "[" : ".", start(node.property));
      this.#output.appendRight(start(node), "({ set v(__g$v) { __g$.S(");
      this.#output.overwrite(operator, end(node), ', "location", __g$v); } }).v');
      this.visit(node.object, "read", false);
      return;
    }
    if (role === "read" && isImportMetaUrl(node)) {
      this.#call("__g$.M(", ")", node);
      return;
    }
    if (role === "read" && isLocationMember(node)) this.#wrap(node);
    else if (role === "read" && isWindowRefMember(node)) this.#call("__g$.W(", ")", node);
    // A wrapped link would stop an optional chain from short-circuiting, so the next access becomes optional too.
    if (
      inChain &&
      !node.optional &&
      (isLocationMember(node.object) || isWindowRefMember(node.object)) &&
      hasOptionalLink(node.object)
    ) {
      this.#output.appendRight(this.#nextToken(end(node.object)), node.computed ? "?." : "?");
    }
    this.visit(node.object, "read", inChain);
    if (node.computed) this.visit(node.property, "read", false);
  }

  #assignment(node: ESTree.AssignmentExpression): void {
    const { left, right } = node;
    // Logical assignment converts only when it assigns, so the operator stays and only the value goes through N.
    const converts = PLAIN_OR_LOGICAL.has(node.operator);
    if (left.type === "Identifier") {
      if (left.name === "location" && converts && !isHelperCall(right)) {
        this.#call("__g$.N(location, (", "))", right);
      }
    } else if (left.type === "MemberExpression" && converts && isLocationMember(left)) {
      // Only the text between the object and the value changes, so rewrites nested in either survive.
      const operator = this.#source.lastIndexOf(left.computed ? "[" : ".", start(left.property));
      this.#output.appendRight(start(node), "__g$.S(");
      this.#output.overwrite(operator, start(right), ', "location", (');
      this.#output.appendLeft(end(right), node.operator === "=" ? "))" : `), "${node.operator}")`);
      this.visit(left.object, "read", false);
    } else {
      if (left.type === "ObjectPattern" && hasWrappedKey(left) && !isHelperCall(right)) {
        this.#call("__g$.D(", ")", right);
      }
      this.visit(left, left.type === "MemberExpression" ? "target" : "assign", false);
    }
    this.visit(right, "read", false);
  }

  #wrap(node: ESTree.Node): void {
    this.#call("__g$.L(", ")", node);
  }

  /** The receiver's own postMessage would make it the event.source, so the call runs through the caller's __g$. */
  #messageTarget(callee: ESTree.MemberExpression, inChain: boolean): void {
    // Inside the call a comma expression would split into several arguments, so it keeps parentheses of its own.
    if (callee.object.type === "SequenceExpression") this.#call("__g$.P((", "))", callee.object);
    else this.#call("__g$.P(", ")", callee.object);
    if (inChain && !callee.optional && hasOptionalLink(callee.object)) {
      this.#output.appendRight(this.#nextToken(end(callee.object)), callee.computed ? "?." : "?");
    }
  }

  #call(open: string, close: string, node: ESTree.Node): void {
    this.#output.appendRight(start(node), open);
    this.#output.appendLeft(end(node), close);
  }

  #children(node: ESTree.Node): void {
    for (const [key, value] of Object.entries(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "range" || key === "loc") continue;
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) this.visit(item, "read", false);
      } else if (isNode(value)) {
        this.visit(value, "read", false);
      }
    }
  }

  #nextToken(index: number): number {
    const source = this.#source;
    while (index < source.length) {
      const char = source[index];
      if (char === "/" && source[index + 1] === "*") {
        const close = source.indexOf("*/", index + 2);
        index = close < 0 ? source.length : close + 2;
      } else if (char === "/" && source[index + 1] === "/") {
        const newline = source.indexOf("\n", index);
        index = newline < 0 ? source.length : newline + 1;
      } else if (char !== undefined && /\s/.test(char)) {
        index++;
      } else {
        return index;
      }
    }
    return index;
  }
}

function start(node: ESTree.Node): number {
  return node.start as number;
}

function end(node: ESTree.Node): number {
  return node.end as number;
}

function isNode(value: unknown): value is ESTree.Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function isLocationIdentifier(node: ESTree.Node): boolean {
  return node.type === "Identifier" && node.name === "location";
}

function isImportMetaUrl(node: ESTree.MemberExpression): boolean {
  const { object, property } = node;
  return (
    !node.computed &&
    property.type === "Identifier" &&
    property.name === "url" &&
    object.type === "MetaProperty" &&
    object.meta.name === "import" &&
    object.property.name === "meta"
  );
}

function isLocationMember(node: ESTree.Node): node is ESTree.MemberExpression {
  if (node.type !== "MemberExpression") return false;
  const { property } = node;
  return node.computed
    ? property.type === "Literal" && property.value === "location"
    : property.type === "Identifier" && property.name === "location";
}

function isWindowRefMember(node: ESTree.Node): node is ESTree.MemberExpression {
  if (node.type !== "MemberExpression" || node.object.type === "Super") return false;
  const { object, property } = node;
  const name = node.computed
    ? property.type === "Literal" && typeof property.value === "string"
      ? property.value
      : undefined
    : property.type === "Identifier"
      ? property.name
      : undefined;
  if (name === undefined || !WINDOW_REFS.has(name)) return false;
  if (object.type === "Identifier") return WINDOW_LIKE.has(object.name);
  if (object.type === "MemberExpression") return isWindowLikeMember(object);
  return object.type === "CallExpression" && isHelperCall(object) && isWrapperCall(object);
}

function isWindowLikeMember(node: ESTree.MemberExpression): boolean {
  const { property } = node;
  if (node.computed)
    return property.type === "Literal" && typeof property.value === "string" && WINDOW_LIKE.has(property.value);
  return property.type === "Identifier" && WINDOW_LIKE.has(property.name);
}

function isWrapperCall(node: ESTree.CallExpression): boolean {
  const callee = node.callee;
  return callee.type === "MemberExpression" && callee.property.type === "Identifier" && callee.property.name === "W";
}

function isPostMessageCallee(node: ESTree.Node): node is ESTree.MemberExpression {
  if (node.type !== "MemberExpression" || node.object.type === "Super") return false;
  const { property } = node;
  return node.computed
    ? property.type === "Literal" && property.value === "postMessage"
    : property.type === "Identifier" && property.name === "postMessage";
}

function hasWrappedKey(pattern: ESTree.ObjectPattern): boolean {
  return pattern.properties.some(
    (property) =>
      property.type === "Property" &&
      !property.computed &&
      ((property.key.type === "Identifier" && isWrappedKey(property.key.name)) ||
        (property.key.type === "Literal" &&
          typeof property.key.value === "string" &&
          isWrappedKey(property.key.value))),
  );
}

function isWrappedKey(name: string): boolean {
  return name === "location" || WINDOW_REFS.has(name);
}

function hasOptionalLink(node: ESTree.Node): boolean {
  let current: ESTree.Node = node;
  while (current.type === "MemberExpression" || current.type === "CallExpression") {
    if (current.optional) return true;
    current = current.type === "MemberExpression" ? current.object : current.callee;
  }
  return false;
}

function isHelperCall(node: ESTree.Node): boolean {
  if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.computed) return false;
  const { object, property } = node.callee;
  return (
    object.type === "Identifier" &&
    object.name === "__g$" &&
    property.type === "Identifier" &&
    HELPERS.has(property.name)
  );
}
