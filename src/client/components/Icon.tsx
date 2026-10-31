import type { SVGProps } from "react";

export type IconName =
  | "menu"
  | "search"
  | "star"
  | "moon"
  | "sun"
  | "leaf"
  | "book"
  | "cup"
  | "contrast"
  | "display"
  | "file"
  | "folder"
  | "folderOpen"
  | "chevron"
  | "plus"
  | "close"
  | "save"
  | "outline"
  | "history"
  | "edit"
  | "source"
  | "more"
  | "tree"
  | "list"
  | "settings"
  | "refresh"
  | "check"
  | "chevronLeft"
  | "chevronRight"
  | "external"
  | "sidebar"
  | "github";

const paths: Record<IconName, React.ReactNode> = {
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />,
  moon: <path d="M20 15.2A8.4 8.4 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 4C12 4.5 6.5 8 5.3 14.1c-.7 3.6 1.6 5.9 4.4 5.9 6 0 9.4-6.7 10.3-16Z" />
      <path d="M4 20c2.7-4.2 6.1-7.2 10.5-9.2" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.5C10.4 5.2 8.2 4.5 5.5 4.5H3v13h2.5c2.7 0 4.9.7 6.5 2 1.6-1.3 3.8-2 6.5-2H21v-13h-2.5c-2.7 0-4.9.7-6.5 2Z" />
      <path d="M12 6.5v13" />
    </>
  ),
  cup: (
    <>
      <path d="M4.5 7.5h12v6a6 6 0 0 1-12 0Z" />
      <path d="M16.5 9H19a2 2 0 0 1 0 4h-2.5M4 20.5h13" />
    </>
  ),
  contrast: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none" />
    </>
  ),
  display: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.8" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  file: (
    <>
      <path d="M6 2.8h8l4 4V21H6z" />
      <path d="M14 2.8V7h4M9 11h6M9 15h6M9 19h4" />
    </>
  ),
  folder: <path d="M3 6.5h6l2 2h10V19H3z" />,
  folderOpen: <path d="M3 7h6l2 2h10l-2.4 10H3zM3 7v12" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  save: (
    <>
      <path d="M4 4h13l3 3v13H4z" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" />
    </>
  ),
  outline: <path d="M5 6h4M5 12h8M5 18h12" />,
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2-5.3L4 9" />
      <path d="M4 4v5h5M12 8v5l3 2" />
    </>
  ),
  edit: (
    <>
      <path d="m4 20 4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
      <path d="m14 7 3 3" />
    </>
  ),
  source: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </>
  ),
  tree: <path d="M5 5h5v5H5zM14 5h5v5h-5zM9 16h5v5H9zM7.5 10v6h9v-6" />,
  list: <path d="M5 6h2M10 6h9M5 12h2M10 12h9M5 18h2M10 18h9" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.8-1L14.4 3h-4l-.4 3.1a8 8 0 0 0-1.8 1l-2.4-1-2 3.4L5.9 11a7 7 0 0 0 0 2l-2.1 1.5 2 3.4 2.4-1a8 8 0 0 0 1.8 1l.4 3.1h4l.4-3.1a8 8 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" />
    </>
  ),
  refresh: (
    <path d="M20 7v5h-5M4 17v-5h5M6.1 9a7 7 0 0 1 11.4-2.3L20 9M4 15l2.5 2.3A7 7 0 0 0 18 15" />
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 13v7H4V6h7" />,
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
      <path d="M9.5 4.5v15M5.8 8.5h1.6M5.8 11.5h1.6" />
    </>
  ),
  github: (
    <path
      d="M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.7c-2.7.6-3.3-1.2-3.3-1.2-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.1-.2-4.3-1.1-4.3-4.7 0-1 .4-1.9 1-2.6-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.6 1a9 9 0 0 1 4.8 0c1.8-1.3 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.5.6.7 1 1.6 1 2.6 0 3.7-2.2 4.5-4.3 4.7.3.3.6.9.6 1.8v2.6c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.5Z"
      fill="currentColor"
      stroke="none"
    />
  ),
};

export function Icon({
  name,
  size = 18,
  ...props
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
