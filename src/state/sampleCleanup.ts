import { DEMO_PROJECTS, type ChapterNode, type DemoProject } from '../data/demo';
import { isBuiltinSampleBook } from '../domain/builtinSampleBook';
import { normalizeLoadedProject } from '../domain/outline';
import type { LiveDraft } from '../editor/liveDraft';
import type { DeviceSaveRecord } from './deviceSaveRecord';

/**
 * WO-95：舊裝置上的內建範例書，沒改過的才清掉，改過或拿不準的一律留著。
 *
 * 「沒改過」的判斷：把本機存的那份與原始範例常數都經過載入時同一套正規化
 * （補 origin、補卡片與分類欄位）後，逐欄比較使用者內容，必須完全相同。
 *
 * 比較時排除、不算使用者內容的欄位：
 * - origin：載入時自動補上。
 * - updatedLabel：「上次編輯」時間標籤，畫面顯示用。
 * - lastOpenedNodeId、lastCursor：上次停在哪一章、游標位置，只是位置記憶。
 * - 各章節的 expanded：目錄展開或收合，只是畫面狀態。
 *
 * 其他欄位（書名、全書目標、篇章樹的結構與順序、各章標題、正文、進度、卡片、分類順序、
 * 展開分類、自訂分類、單篇／長篇、檔名與存檔標記，以及任何不認得的欄位）只要有一點不同就保留。
 *
 * 另外以下情況也保留：
 * - 本機有這份稿子尚未併回的正文草稿（live draft），不論草稿內容是否和範例相同。
 * - 位置記憶裡有這份稿子尚未完成的卡片草稿。
 * - 這個裝置的存檔紀錄顯示曾經暫存、另存或存回檔案，或存有這份稿子自己的每日目標或寫作紀錄。
 */
export interface SampleCleanupContext {
  /** 本機尚未併回的正文草稿；沒有就是 null。 */
  liveDraft: LiveDraft | null;
  /** 這份稿子在位置記憶裡有沒有尚未完成的卡片草稿。 */
  hasCardDrafts: (projectId: string) => boolean;
  /** 這個裝置的存檔紀錄。 */
  record: Pick<DeviceSaveRecord, 'saveMeta' | 'goalById' | 'logsById'>;
}

const IGNORED_PROJECT_KEYS: ReadonlySet<string> = new Set([
  'origin',
  'updatedLabel',
  'lastOpenedNodeId',
  'lastCursor',
]);

const IGNORED_NODE_KEYS: ReadonlySet<string> = new Set(['expanded']);

/** 依鍵名排序、略過 undefined 的穩定字串，用來比較內容是否完全相同。 */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function contentOfNode(node: ChapterNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (IGNORED_NODE_KEYS.has(key)) continue;
    result[key] = key === 'children' && Array.isArray(value) ? value.map(contentOfNode) : value;
  }
  return result;
}

/** 使用者內容（去掉不算內容的欄位）的穩定字串。 */
export function sampleContentSignature(project: DemoProject): string {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(project)) {
    if (IGNORED_PROJECT_KEYS.has(key)) continue;
    result[key] = key === 'nodes' && Array.isArray(value) ? value.map(contentOfNode) : value;
  }
  return stableStringify(result);
}

/** 原始範例經載入正規化後的樣子；找不到對應範例就是 null。 */
function normalizedBaseline(id: string): DemoProject | null {
  const demo = DEMO_PROJECTS.find((item) => item.id === id);
  if (!demo) return null;
  return normalizeLoadedProject({ ...structuredClone(demo), origin: demo.origin ?? 'demo' });
}

function hasSavedOrTracked(projectId: string, record: SampleCleanupContext['record']): boolean {
  const meta = record.saveMeta[projectId];
  if (
    meta &&
    (meta.lastManualSaveMs != null || meta.lastExportMs != null || meta.lastProjectSaveMs != null)
  ) {
    return true;
  }
  return Boolean(record.goalById[projectId]) || Boolean(record.logsById[projectId]);
}

/**
 * 這份稿子是不是「確定沒改過的內建範例」。只有確定時才回傳 true；
 * 不是內建範例、從檔案開啟的稿子、比不出來或出錯，一律回傳 false（保留）。
 */
export function isUntouchedSample(project: DemoProject, context: SampleCleanupContext): boolean {
  try {
    if (!project || typeof project !== 'object') return false;
    if (!isBuiltinSampleBook(project)) return false;
    if (context.liveDraft && context.liveDraft.projectId === project.id) return false;
    if (context.hasCardDrafts(project.id)) return false;
    if (hasSavedOrTracked(project.id, context.record)) return false;
    const baseline = normalizedBaseline(project.id);
    if (!baseline) return false;
    return sampleContentSignature(normalizeLoadedProject(project)) === sampleContentSignature(baseline);
  } catch {
    return false;
  }
}

/** 逐份判斷，只拿掉確定沒改過的內建範例；其他稿子原封不動、順序不變。 */
export function dropUntouchedSamples(
  projects: readonly DemoProject[],
  context: SampleCleanupContext,
): { kept: DemoProject[]; removedIds: string[] } {
  const kept: DemoProject[] = [];
  const removedIds: string[] = [];
  for (const project of projects) {
    if (isUntouchedSample(project, context)) removedIds.push(project.id);
    else kept.push(project);
  }
  return { kept, removedIds };
}
