import MagicString from "magic-string";
import { isParseError, parseModule, parseScript, type ESTree } from "meriyah";

export const MAX_REWRITE_LENGTH = 20 * 1024 * 1024;

export interface JsRewriteOptions {
  kind?: "classic" | "module" | "handler";
}

type Role = "read" | "target" | "binding" | "callee";

const PARSE_OPTIONS = { ranges: true, webcompat: true, next: true } as const;
const HELPERS = new Set(["L", "N", "S", "D"]);

/** Routes reads and writes of `location` through the runtime's __g$ helpers; unparsable source is returned as is. */
export function rewriteJs(source: string, options: JsRewriteOptions = {}): string {
  if (source.length > MAX_REWRITE_LENGTH || !source.includes("location")) return source;
  const program = parse(source, options.kind ?? "classic");
  if (!program) return source;
  const output = new MagicString(source);
  try {
    new LocationRewriter(source, output).visit(program, "read", false);
  } catch {
    // Pathologically deep code can overflow the stack; serving it unrewritten beats failing the page.
    return source;
  }
  return output.hasChanged() ? output.toString() : source;
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

  constructor(source: string, output: MagicString) {
    this.#source = source;
    this.#output = output;
  }

  visit(node: ESTree.Node | null | undefined, role: Role, inChain: boolean): void {
    if (!node) return;
    switch (node.type) {
      case "Identifier":
        if (role === "read" && node.name === "location") this.#wrap(node);
        return;
      case "MemberExpression":
        this.#member(node, role, inChain);
        return;
      case "ChainExpression":
        this.visit(node.expression, role, true);
        return;
      case "CallExpression":
        if (isHelperCall(node)) return;
        this.visit(node.callee, "callee", inChain);
        for (const argument of node.arguments) this.visit(argument, "read", false);
        return;
      case "NewExpression":
        // `new __g$.L(x).y()` would construct the helper, so a callee that gets wrapped is parenthesised first.
        if (this.#source.slice(start(node.callee), end(node.callee)).includes("location")) {
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
        this.visit(node.argument, node.operator === "delete" ? "target" : "read", false);
        return;
      case "ForInStatement":
      case "ForOfStatement":
        this.visit(node.left, node.left.type === "VariableDeclaration" ? "read" : "target", false);
        this.visit(node.right, "read", false);
        this.visit(node.body, "read", false);
        return;
      case "VariableDeclarator":
        this.visit(node.id, "binding", false);
        if (node.init && node.id.type === "ObjectPattern" && hasLocationKey(node.id) && !isHelperCall(node.init)) {
          this.#call("__g$.D(", ")", node.init);
        }
        this.visit(node.init, "read", false);
        return;
      case "ObjectExpression":
        for (const property of node.properties) {
          if (property.type === "Property" && property.shorthand && isLocationIdentifier(property.value)) {
            this.#output.overwrite(start(property), end(property), "location: __g$.L(location)");
          } else {
            this.visit(property, "read", false);
          }
        }
        return;
      case "Property":
        if (node.computed) this.visit(node.key, "read", false);
        this.visit(node.value, role, false);
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
    if (role === "read" && isLocationMember(node)) this.#wrap(node);
    // A wrapped link would stop an optional chain from short-circuiting, so the next access becomes optional too.
    if (inChain && !node.optional && isLocationMember(node.object) && hasOptionalLink(node.object)) {
      this.#output.appendRight(this.#nextToken(end(node.object)), node.computed ? "?." : "?");
    }
    this.visit(node.object, "read", inChain);
    if (node.computed) this.visit(node.property, "read", false);
  }

  #assignment(node: ESTree.AssignmentExpression): void {
    const { left, right } = node;
    if (left.type === "Identifier") {
      if (left.name === "location" && node.operator === "=" && !isHelperCall(right)) {
        this.#call("__g$.N(location, (", "))", right);
      }
    } else if (left.type === "MemberExpression" && node.operator === "=" && isLocationMember(left)) {
      // Only the text between the object and the value changes, so rewrites nested in either survive.
      const operator = this.#source.lastIndexOf(left.computed ? "[" : ".", start(left.property));
      this.#output.appendRight(start(node), "__g$.S(");
      this.#output.overwrite(operator, start(right), ', "location", (');
      this.#output.appendLeft(end(right), "))");
      this.visit(left.object, "read", false);
    } else {
      if (left.type === "ObjectPattern" && hasLocationKey(left) && !isHelperCall(right)) {
        this.#call("__g$.D(", ")", right);
      }
      this.visit(left, "target", false);
    }
    this.visit(right, "read", false);
  }

  #wrap(node: ESTree.Node): void {
    this.#call("__g$.L(", ")", node);
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

function isLocationMember(node: ESTree.Node): node is ESTree.MemberExpression {
  if (node.type !== "MemberExpression") return false;
  const { property } = node;
  return node.computed
    ? property.type === "Literal" && property.value === "location"
    : property.type === "Identifier" && property.name === "location";
}

function hasLocationKey(pattern: ESTree.ObjectPattern): boolean {
  return pattern.properties.some(
    (property) =>
      property.type === "Property" &&
      !property.computed &&
      ((property.key.type === "Identifier" && property.key.name === "location") ||
        (property.key.type === "Literal" && property.key.value === "location")),
  );
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
