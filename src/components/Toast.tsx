import { useSample } from '../state/sampleStore';

export function Toast() {
  const { state } = useSample();
  if (!state.toast) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {state.toast}
    </div>
  );
}
