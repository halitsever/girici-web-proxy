import { describe, expect, it } from "vitest";
import { rewriteXml } from "../src/rewrite/html.ts";
import { xmlClientTag } from "../src/shared/client-tag.ts";
import { PROTOCOL_VERSION } from "../src/shared/protocol.ts";
import { decodeCharacterData, scanProlog } from "../src/rewrite/xml.ts";

const TAG = '<script xmlns="http://www.w3.org/1999/xhtml" src="/_g/client.test.js"></script>';
const rw = (xml: string, inject = false) =>
  rewriteXml(xml, {
    url: new URL("https://site.test/dir/page.svg"),
    origin: "http://proxy.test",
    inject: inject ? TAG : undefined,
  });

const SVG = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"';

describe("XML runtime injection", () => {
  it.each([
    [`<svg ${SVG}><rect/></svg>`, `<svg ${SVG}>${TAG}<rect/></svg>`],
    [
      `<?xml version="1.0"?>\n<!-- c -->\n<svg ${SVG}>\n<script>a()</script></svg>`,
      `<?xml version="1.0"?>\n<!-- c -->\n<svg ${SVG}>${TAG}\n<script>a()</script></svg>`,
    ],
    [
      '<html xmlns="http://www.w3.org/1999/xhtml">\n<head><title>t</title></head><body/></html>',
      `<html xmlns="http://www.w3.org/1999/xhtml">\n<head>${TAG}<title>t</title></head><body/></html>`,
    ],
    [
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><script>a()</script></body></html>',
      `<html xmlns="http://www.w3.org/1999/xhtml">${TAG}<body><script>a()</script></body></html>`,
    ],
    [`<svg ${SVG}/>`, `<svg ${SVG}>${TAG}</svg>`],
    ['<s:svg xmlns:s="http://www.w3.org/2000/svg" />', `<s:svg xmlns:s="http://www.w3.org/2000/svg" >${TAG}</s:svg>`],
  ])("injects into %j", (input, output) => {
    expect(rw(input, true)).toBe(output);
  });

  it("skips a doctype whose internal subset holds markup", () => {
    const doctype = '<!DOCTYPE svg [\n  <!ENTITY s "<script>x()</script>">\n  <!-- > --> <?pi > ?>\n]>';
    expect(rw(`${doctype}<svg ${SVG}>&s;</svg>`, true)).toBe(`${doctype}<svg ${SVG}>${TAG}&s;</svg>`);
  });

  it("refuses a document with no root element to hold the runtime", () => {
    for (const input of ["", "   ", "plain text", "<!-- only -->", "<!DOCTYPE svg [", "<?xml version='1.0'"])
      expect(rw(input, true), input).toBeNull();
  });

  it("builds a namespaced runtime tag with an escaped config", () => {
    const tag = xmlClientTag("https://p.test/c.js?a=1&b=2", { v: PROTOCOL_VERSION, cookies: [], site: "<&'\">" });
    expect(tag).toMatch(
      /^<script xmlns="http:\/\/www\.w3\.org\/1999\/xhtml" src="https:\/\/p\.test\/c\.js\?a=1&amp;b=2"/,
    );
    expect(tag).not.toMatch(/data-girici="[^"]*[<'&](?!amp;|lt;|gt;|quot;|#39;)/);
  });
});

describe("XML URL attributes", () => {
  it.each([
    [`<svg ${SVG}><a xlink:href="https://other.test/x"/></svg>`, '<a xlink:href="/~/https/other.test/x"/>'],
    [`<svg ${SVG}><image href="/i.png"/></svg>`, '<image href="/~/https/site.test/i.png"/>'],
    [`<svg ${SVG}><use href="#icon"/></svg>`, '<use href="#icon"/>'],
    [`<svg ${SVG}><a href='https://o.test/?a=1&amp;b=2'/></svg>`, '<a href="/~/https/o.test/?a=1&amp;b=2"/>'],
    [
      `<svg ${SVG}><rect fill="url(https://o.test/p.svg#g)"/></svg>`,
      `<rect fill="url(&quot;/~/https/o.test/p.svg#g&quot;)"/>`,
    ],
    [`<svg ${SVG}><rect fill="url(#g)"/></svg>`, '<rect fill="url(#g)"/>'],
    [
      `<svg ${SVG}><rect style="background:url(https://o.test/b.png)"/></svg>`,
      '<rect style="background:url(&quot;/~/https/o.test/b.png&quot;)"/>',
    ],
    [
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><form action="https://o.test/f"/></body></html>',
      '<form action="/~/https/o.test/f"/>',
    ],
  ])("rewrites %j", (input, fragment) => {
    expect(rw(input)).toContain(fragment);
  });

  it("leaves an attribute that names a doctype entity as written", () => {
    const input = `<!DOCTYPE svg [<!ENTITY h "https://o.test/">]><svg ${SVG}><a href="&h;x"/></svg>`;
    expect(rw(input)).toBe(input);
  });

  it("escapes rewritten values for XML, whitespace included", () => {
    const out = rw(`<svg ${SVG}><rect onclick="a&lt;b&#10;c()"/></svg>`) ?? "";
    expect(out).not.toMatch(/onclick="[^"]*</);
    expect(out).toContain("&#10;");
  });

  it("removes dropped elements with their end tag", () => {
    const input =
      '<html xmlns="http://www.w3.org/1999/xhtml"><head>' +
      '<link rel="preconnect" href="https://o.test"></link>' +
      '<meta http-equiv="Content-Security-Policy" content="x"/>' +
      '<script type="speculationrules"><![CDATA[{}]]></script><title>t</title></head></html>';
    expect(rw(input)).toBe('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head></html>');
  });
});

describe("XML script and style text", () => {
  it("rewrites code inside CDATA and escapes it back as text", () => {
    const out = rw(`<svg ${SVG}><script><![CDATA[ if (a < b && c) location.href = "/x"; ]]></script></svg>`) ?? "";
    const text = /<script>([\s\S]*)<\/script>/.exec(out)?.[1] ?? "";
    expect(text).not.toContain("<");
    expect(text).toContain("&lt;");
    expect(decodeCharacterData(text)).not.toContain("location.href");
  });

  it("decodes references before rewriting a stylesheet", () => {
    const out = rw(`<svg ${SVG}><style>a { b: url('https://o.test/&amp;x.png') }</style></svg>`) ?? "";
    expect(out).toContain("/~/https/o.test/&amp;x.png");
  });

  it("leaves text it cannot decode alone", () => {
    const input = `<svg ${SVG}><script>&custom; location.href = 1</script></svg>`;
    expect(rw(input)).toBe(input);
  });
});

describe("XML processing instructions", () => {
  it("rewrites a CSS xml-stylesheet and drops any other", () => {
    const input =
      '<?xml version="1.0" encoding="iso-8859-1"?>\n' +
      '<?xml-stylesheet type="text/css" href="https://o.test/s.css?a=1&amp;b=2"?>\n' +
      "<?xml-stylesheet type='text/xsl' href='t.xsl'?>\n" +
      '<?xml-stylesheet href="u.xsl"?>\n' +
      `<svg ${SVG}/>`;
    expect(rw(input)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<?xml-stylesheet type="text/css" href="/~/https/o.test/s.css?a=1&amp;b=2"?>\n\n\n' +
        `<svg ${SVG}/>`,
    );
  });

  it("finds the root past every kind of prolog markup", () => {
    const text = '﻿<?xml version="1.0"?> <!--x--> <!DOCTYPE a SYSTEM "a>b"> <?p d?> <a/>';
    const prolog = scanProlog(text);
    expect(prolog?.root).toBe(text.indexOf("<a/>"));
    expect(prolog?.instructions.map((pi) => pi.target)).toEqual(["xml", "p"]);
  });
});
