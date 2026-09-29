/**
 * Suspense fallback while the viewer chunk arrives. It deliberately uses its
 * own tiny class names (styled in app.css, which ships eagerly) instead of the
 * viewer's styles, so the overlay is never unstyled while the chunk loads.
 */
export function ViewerFallback() {
  return (
    <div className="veil" role="dialog" aria-modal="true" aria-label="Открывается просмотр">
      <div className="veil__loader">
        <span className="spinner spinner--lg" aria-hidden="true" />
      </div>
    </div>
  );
}
