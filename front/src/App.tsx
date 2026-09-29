import { useEffect, useState } from 'react';

import { applyGrayPalette } from './lib/palette';
import { NotFoundPage } from './ui/NotFoundPage';
import { RootPage } from './ui/RootPage';
import { SetPage } from './ui/SetPage';

/**
 * Routes are encoded in the hash, because photo sets are handed out as direct
 * links (`…/#/{setId}`) and the whole app must work as a static bundle.
 *
 *   (empty) | #/        → root form
 *   #/{setId}           → one set (the user's entire world)
 *   #/a/b               → not found
 */
type Route =
  | { readonly name: 'root' }
  | { readonly name: 'set'; readonly setId: string }
  | { readonly name: 'not-found' };

function parseRoute(hash: string): Route {
  const path = hash.startsWith('#') ? hash.slice(1) : hash;

  if (path === '' || path === '/') {
    return { name: 'root' };
  }

  const segments = path.split('/').filter((segment) => segment.length > 0);

  if (segments.length !== 1) {
    return { name: 'not-found' };
  }

  let decoded: string;

  try {
    decoded = decodeURIComponent(segments[0]);
  } catch {
    // Malformed percent-encoding can never name a real set.
    return { name: 'not-found' };
  }

  const setId = decoded.trim();

  if (setId === '') {
    return { name: 'root' };
  }

  return { name: 'set', setId };
}

function readRoute(): Route {
  return parseRoute(window.location.hash);
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const handleHashChange = (): void => {
      setRoute(readRoute());
    };

    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  const setId = route.name === 'set' ? route.setId : null;

  useEffect(() => {
    if (setId !== null) {
      window.scrollTo(0, 0);
    }
  }, [setId]);

  // Only a set page has a photo to take colours from; everywhere else the
  // neutral gray Material palette stands in, so a set's colours never leak out.
  useEffect(() => {
    if (route.name !== 'set') {
      applyGrayPalette();
    }
  }, [route.name]);

  if (route.name === 'set') {
    return <SetPage key={route.setId} setId={route.setId} />;
  }

  if (route.name === 'not-found') {
    return <NotFoundPage />;
  }

  return <RootPage />;
}
