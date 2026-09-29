/**
 * Inline SVG icon set (Material Symbols geometry, drawn locally). No icon
 * font, no sprite request, no CDN — every glyph is one <path> sized and
 * coloured entirely from CSS.
 */

export interface IconProps {
  readonly className?: string;
}

interface GlyphProps extends IconProps {
  readonly path: string;
}

function Glyph({ className, path }: GlyphProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
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

export function PhotoLibraryIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M20 4H8a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 13H8V6h12v11Zm-9-3.5 2.03 2.71L15 12.5l3.5 4.5H8.5l2.5-3.5ZM2 6v14a2 2 0 0 0 2 2h13v-2H4V6H2Z"
    />
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8Z"
    />
  );
}

export function ErrorIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 15.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm1.25-6.25a1.25 1.25 0 0 1-2 0V8a1.25 1.25 0 0 1 2 0v3.75Z"
    />
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z"
    />
  );
}

export function CheckIcon(props: IconProps) {
  return <Glyph {...props} path="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" />;
}

export function CloseIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z"
    />
  );
}

export function AddIcon(props: IconProps) {
  return <Glyph {...props} path="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z" />;
}

export function ExpandMoreIcon(props: IconProps) {
  return <Glyph {...props} path="M7 10l5 5 5-5H7Z" />;
}

export function UploadCloudIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96ZM14 13v4h-4v-4H7l5-5 5 5h-3Z"
    />
  );
}

export function DeleteIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"
    />
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"
    />
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5-5-5ZM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4V5Z"
    />
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Glyph {...props} path="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z" />
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2ZM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5Z"
    />
  );
}

export function MovieIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4a2 2 0 0 0-1.99 2L2 18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4h-4Z"
    />
  );
}

export function DescriptionIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M14 2H6a2 2 0 0 0-1.99 2L4 20a2 2 0 0 0 1.99 2H18a2 2 0 0 0 2-2V8l-6-6Zm2 16H8v-2h8v2Zm0-4H8v-2h8v2Zm-3-5V3.5L18.5 9H13Z"
    />
  );
}

export function VisibilityIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5Zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
    />
  );
}

export function VisibilityOffIcon(props: IconProps) {
  return (
    <Glyph
      {...props}
      path="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92A11.8 11.8 0 0 0 23 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7ZM2 4.27l2.28 2.28A11.9 11.9 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27Zm7.53 5.53l1.55 1.55a3 3 0 0 0 3.9 3.9l1.55 1.55A5 5 0 0 1 7.53 9.8Z"
    />
  );
}
