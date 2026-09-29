import { useState } from 'react';

import { publicUrl, thumbUrl } from '../lib/urls';
import type { MediaKind } from '../lib/validate';
import { DescriptionIcon, MovieIcon } from './icons';

interface ThumbnailProps {
  readonly setId: string;
  readonly name: string;
  readonly kind: MediaKind;
}

function fallbackIcon(kind: MediaKind) {
  if (kind === 'video') {
    return (
      <span className="thumb__fallback thumb__fallback--video">
        <MovieIcon className="icon icon--lg" />
      </span>
    );
  }

  return (
    <span className="thumb__fallback">
      <DescriptionIcon className="icon" />
    </span>
  );
}

/**
 * 56×56 preview straight from the public bucket — no auth, no round trip.
 * A missing preview retries once against the original (photos), and only then
 * falls back to an icon, so a set without thumbs is still browsable.
 */
export function Thumbnail({ setId, name, kind }: ThumbnailProps) {
  const preview = thumbUrl(setId, name, kind);
  const [source, setSource] = useState(preview);
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);

  if (preview === null) {
    return <span className="thumb">{fallbackIcon(kind)}</span>;
  }

  return (
    <span className="thumb" data-loaded={loaded}>
      {broken === false && (
        <img
          className="thumb__img"
          src={source ?? ''}
          alt=""
          width={56}
          height={56}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => {
            setLoaded(true);
          }}
          onError={() => {
            setLoaded(false);

            if (kind === 'image' && source !== publicUrl(setId, name)) {
              setSource(publicUrl(setId, name));
              return;
            }

            setBroken(true);
          }}
        />
      )}

      {loaded === false && broken === false && <span className="thumb__skeleton skeleton" />}

      {broken && fallbackIcon(kind)}
    </span>
  );
}
