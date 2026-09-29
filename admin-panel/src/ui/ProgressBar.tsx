export type ProgressTone = 'active' | 'ok' | 'error';

interface ProgressBarProps {
  readonly percent: number;
  readonly label: string;
  readonly tone?: ProgressTone;
}

const TONE_CLASS: Record<ProgressTone, string> = {
  active: '',
  ok: ' progress--ok',
  error: ' progress--error',
};

export function ProgressBar({ percent, label, tone = 'active' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <div
      className={`progress${TONE_CLASS[tone]}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={`${clamped}%`}
      aria-label={label}
    >
      <span className="progress__bar" style={{ width: `${clamped}%` }} />
    </div>
  );
}
