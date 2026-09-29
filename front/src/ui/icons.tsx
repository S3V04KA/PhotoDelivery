/**
 * Inline SVG icon set (Material Symbols geometry, drawn locally).
 * No icon font, no sprite request, no CDN — every glyph is one <path> and is
 * sized and coloured entirely from CSS.
 */

export interface IconProps {
  readonly className?: string;
}

interface GlyphProps extends IconProps {
  readonly path: string;
  readonly viewBox?: string;
}

function Glyph({ className, path, viewBox = '0 0 24 24' }: GlyphProps) {
  return (
    <svg
      className={className}
      viewBox={viewBox}
      width="24"
      height="24"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return <Glyph {...props} path="M8 5.14v13.72c0 .79.87 1.27 1.54.84l10.78-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />;
}

export function CloseIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"
    />
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return <Glyph {...props} path="M14.7 6.7a1 1 0 0 1 0 1.4L9.4 13.4a1 1 0 0 0 0 1.4l5.3 5.3a1 1 0 1 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0Z" />;
}

export function ChevronRightIcon(props: IconProps) {
  return <Glyph {...props} path="M9.3 6.7a1 1 0 0 0 0 1.4l5.3 5.3a1 1 0 0 1 0 1.4l-5.3 5.3a1 1 0 1 0 1.4 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.4 0Z" />;
}

export function ErrorIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 15.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm1.25-6.25a1 1 0 0 1-2 0V8a1 1 0 0 1 2 0v3.75Z"
    />
  );
}

export function PhotoLibraryIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M20 4H8a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 13H8V6h12v11Zm-9-3.5 2.03 2.71L15 12.5l3.5 4.5H8.5l2.5-3.5ZM2 6v14a2 2 0 0 0 2 2h13v-2H4V6H2Z"
    />
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M12 3a1 1 0 0 1 1 1v9.59l2.3-2.3a1 1 0 0 1 1.42 1.42l-4 4a1 1 0 0 1-1.42 0l-4-4a1 1 0 0 1 1.42-1.42l2.3 2.3V4a1 1 0 0 1 1-1Zm-8 15a1 1 0 0 1 1 1v1h14v-1a1 1 0 0 1 2 0v1.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20.5V19a1 1 0 0 1 1-1Z"
    />
  );
}

export function ChevronDownIcon(props: IconProps) {
  return <Glyph {...props} path="M7 10l5 5 5-5H7Z" />;
}

export function CheckIcon(props: IconProps) {
  return <Glyph {...props} path="M9.55 17.54a1 1 0 0 1-1.42 0l-5-5a1 1 0 1 1 1.42-1.42L9 15.67l9.45-9.45a1 1 0 0 1 1.42 1.42l-10.32 9.9Z" />;
}

export function BrokenImageIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16.05H5V4.95h14v14.1ZM13.96 12.29l-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71Z"
    />
  );
}
