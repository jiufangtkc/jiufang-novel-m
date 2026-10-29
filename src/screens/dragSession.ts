export interface DragDrop {
  id: string;
  after: boolean;
}

export interface DragState {
  dragId: string | null;
  drop: DragDrop | null;
}

export type DragEvent =
  | { type: 'start'; id: string }
  | { type: 'hover'; drop: DragDrop }
  | { type: 'pointerup' }
  | { type: 'pointercancel' }
  | { type: 'lostpointercapture' };

export interface DragMove {
  dragId: string;
  drop: DragDrop;
}

/** 放開手指才搬移。系統中斷或失去指標時取消，順序不變。 */
export function reduceDrag(
  state: DragState,
  event: DragEvent,
): { state: DragState; move: DragMove | null } {
  if (event.type === 'start') return { state: { dragId: event.id, drop: null }, move: null };
  if (!state.dragId) return { state, move: null };
  if (event.type === 'hover') return { state: { dragId: state.dragId, drop: event.drop }, move: null };
  if (event.type === 'pointercancel' || event.type === 'lostpointercapture') {
    return { state: { dragId: null, drop: null }, move: null };
  }
  const move = state.drop ? { dragId: state.dragId, drop: state.drop } : null;
  return { state: { dragId: null, drop: null }, move };
}
