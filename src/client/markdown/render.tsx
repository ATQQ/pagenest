import { createContext, useContext, type ImgHTMLAttributes, type ReactNode } from "react";
import * as production from "react/jsx-runtime";
import rehypeReact, { type Components } from "rehype-react";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { resolveImageSource, type AssetDocument } from "./assets";
import { rehypeSyntaxHighlight } from "./highlight";

const MarkdownAssetContext = createContext<AssetDocument | null>(null);

function MarkdownImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const document = useContext(MarkdownAssetContext);
  return (
    <img {...props} src={resolveImageSource(props.src, document)} loading="lazy" decoding="async" />
  );
}

const components = {
  a: (props) => {
    const href = typeof props.href === "string" ? props.href : "";
    const external = /^https?:\/\//i.test(href);
    return (
      <a
        {...props}
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer noopener" : undefined}
      />
    );
  },
  input: (props) => (
    <input {...props} disabled aria-label={props.checked ? "已完成任务" : "未完成任务"} />
  ),
  img: (props) => <MarkdownImage {...props} />,
} satisfies Components;

const renderer = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSanitize)
  .use(rehypeSyntaxHighlight)
  .use(rehypeReact, {
    Fragment: production.Fragment,
    jsx: production.jsx,
    jsxs: production.jsxs,
    components,
  });

export function renderMarkdown(markdown: string): ReactNode {
  return renderer.processSync(markdown).result as ReactNode;
}

export function MarkdownAssetProvider({
  document,
  children,
}: {
  document: AssetDocument;
  children: ReactNode;
}) {
  return <MarkdownAssetContext.Provider value={document}>{children}</MarkdownAssetContext.Provider>;
}
