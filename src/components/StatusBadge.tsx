import { progressLabel, type ProgressCode } from '../domain/labels';

export function StatusBadge({ code }: { code: ProgressCode }) {
  return (
    <span className="badge" data-progress={code}>
      <span className="badge-dot" />
      {progressLabel(code)}
    </span>
  );
}
