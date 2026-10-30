import {
  applyWordDelta,
  createSchedule,
  withClock,
  type GoalSchedule,
  type SettledWritingDay,
} from '../domain/dailyGoal';
import type { NodeType, ProgressCode } from '../domain/labels';
import { emptyWritingLog, type WritingLogRow } from '../domain/writingLog';

export interface ChapterNode {
  id: string;
  type: NodeType;
  title: string;
  progress?: ProgressCode;
  content?: string;
  expanded?: boolean;
  children?: ChapterNode[];
  sceneSummary?: string;
  scenePov?: string;
  sceneLocation?: string;
}

export interface DemoProject {
  id: string;
  title: string;
  updatedLabel: string;
  bookGoal: number;
  nodes: ChapterNode[];
  /** 從電腦版檔案匯入的專案。範例專案沒有這個欄位。 */
  origin?: 'demo' | 'file';
  dbKey?: string;
  filename?: string;
  /** 只留在 App。單篇進檔時仍是一章，不寫進 .db 的新欄位。 */
  shape?: 'novel' | 'single';
  lastOpenedNodeId?: string | null;
  lastCursor?: number;
  /** 這份稿子有沒有對應到已經存過的 .db。新稿子在另存或儲存之前沒有。 */
  hasExternalFile?: boolean;
  /** 上次寫進那個檔案時的書名。用來判斷要不要另存新檔。 */
  titleInFile?: string | null;
  /** export：只能另存，選了等一下。resave：電腦下次儲存專案會用新書名另存。 */
  titleSavePending?: 'export' | 'resave' | null;
}

export function demoParagraph(label: string, index: number): string {
  return `【範例】${label} 第 ${index} 段：霧氣自港口緩緩爬上石階，路燈一盞接一盞亮起。她把信紙摺成四折，塞進大衣口袋，想著明天要不要再去一趟燈塔。`;
}

function chapterBody(label: string, count: number): string {
  return Array.from({ length: count }, (_, index) => demoParagraph(label, index + 1)).join('\n\n');
}

/** 已經結束、不再改動的範例日子。樣品用的固定數字。 */
export const DEMO_SETTLED: SettledWritingDay[] = [
  { dayKey: '2026-10-18', dayEndHour: 0, wordCount: 400, finalGoal: 300, achieved: true },
  { dayKey: '2026-10-19', dayEndHour: 0, wordCount: 520, finalGoal: 300, achieved: true },
  { dayKey: '2026-10-20', dayEndHour: 0, wordCount: 610, finalGoal: 300, achieved: true },
  { dayKey: '2026-10-21', dayEndHour: 0, wordCount: 700, finalGoal: 300, achieved: true },
  { dayKey: '2026-10-27', dayEndHour: 0, wordCount: 800, finalGoal: 1000, achieved: false },
  { dayKey: '2026-10-28', dayEndHour: 0, wordCount: 1200, finalGoal: 1000, achieved: true },
];

const DEMO_DURATIONS: Record<string, number> = {
  '2026-10-18': 7200,
  '2026-10-19': 5400,
  '2026-10-20': 7200,
  '2026-10-21': 10800,
  '2026-10-27': 3600,
  '2026-10-28': 9000,
};

export function demoLogs(): WritingLogRow[] {
  return DEMO_SETTLED.map((day, index) => ({
    ...emptyWritingLog(index + 1, day.dayKey),
    word_count: day.wordCount,
    duration: DEMO_DURATIONS[day.dayKey] ?? 0,
    paste_large_count: day.dayKey === '2026-10-27' ? 1 : 0,
    delete_large_count: day.dayKey === '2026-10-28' ? 1 : 0,
  }));
}

export function createDemoSchedule(now: Date): GoalSchedule {
  let schedule: GoalSchedule = {
    ...createSchedule({ dayEndHour: 0, defaultGoal: 1000 }),
    settled: DEMO_SETTLED.map((day) => ({ ...day })),
  };
  schedule = withClock(schedule, now);
  if (schedule.open && schedule.open.wordCount === 0) {
    schedule = applyWordDelta(schedule, 300, now);
  }
  return schedule;
}

export const DEMO_PROJECTS: DemoProject[] = [
  {
    id: 'fog',
    title: '【範例】霧港紀事',
    updatedLabel: '12 分鐘前',
    bookGoal: 100000,
    nodes: [
      {
        id: 'vol-1',
        type: 'folder',
        title: '第一卷　霧港（範例）',
        expanded: true,
        children: [
          {
            id: 'ch-1',
            type: 'file',
            title: '第一章　來信',
            progress: 'Final',
            content: chapterBody('第一章', 4),
          },
          {
            id: 'ch-2',
            type: 'file',
            title: '第二章　燈塔',
            progress: '2nd Edit',
            expanded: true,
            content: chapterBody('第二章', 2),
            children: [
              {
                id: 'sc-1',
                type: 'scene',
                title: '幕 1　上坡',
                progress: '2nd Edit',
                content: demoParagraph('幕 1', 1),
              },
              {
                id: 'sc-2',
                type: 'scene',
                title: '幕 2　守塔人',
                progress: '1st Edit',
                content: demoParagraph('幕 2', 1),
              },
            ],
          },
          {
            id: 'ch-3',
            type: 'file',
            title: '第三章　舊照片',
            progress: '1st Edit',
            content: demoParagraph('第三章', 1),
          },
          {
            id: 'ch-4',
            type: 'file',
            title: '第四章　（刪去的岔路）',
            progress: 'Discarded',
            content: '【範例】這一章標成棄稿。\n',
          },
        ],
      },
      {
        id: 'vol-2',
        type: 'folder',
        title: '第二卷　潮間帶（範例）',
        expanded: true,
        children: [
          {
            id: 'ch-5',
            type: 'file',
            title: '第五章　退潮',
            progress: 'Draft',
            content: demoParagraph('第五章', 1),
          },
          {
            id: 'ch-6',
            type: 'file',
            title: '第六章　（範例，未動）',
            progress: 'Draft',
            content: '【範例】這一章還沒有正文。\n',
          },
        ],
      },
      {
        id: 'vol-3',
        type: 'folder',
        title: '第三卷　（收合）',
        expanded: false,
        children: [
          {
            id: 'ch-7',
            type: 'file',
            title: '第七章　封存',
            progress: 'Draft',
            content: '【範例】收合的卷裡的章節。\n',
          },
        ],
      },
    ],
  },
  {
    id: 'second',
    title: '【範例】第二本專案',
    updatedLabel: '3 天前',
    bookGoal: 50000,
    nodes: [
      {
        id: 'second-ch',
        type: 'file',
        title: '第一章　空白的碼頭',
        progress: 'Draft',
        content: '【範例】這是第二本範例專案，用來試試專案列表。\n',
      },
    ],
  },
  {
    id: 'old',
    title: '【範例】很久以前的短篇',
    updatedLabel: '2026-07-02',
    bookGoal: 8000,
    nodes: [
      {
        id: 'old-ch',
        type: 'file',
        title: '短篇　雨停之前',
        progress: '1st Edit',
        content: '【範例】短篇只有這一段。\n',
      },
    ],
  },
  {
    id: 'long',
    title: '【範例】長目錄',
    updatedLabel: '剛剛',
    bookGoal: 10000,
    nodes: Array.from({ length: 41 }, (_, index) => ({
      id: `long-${index + 1}`,
      type: 'file' as const,
      title: `第${index + 1}章　【範例】`,
      progress: 'Draft' as const,
      content: '【範例】這一行用來試捲動。\n',
    })),
  },
];

export function findNode(nodes: readonly ChapterNode[], id: string): ChapterNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function updateNode(
  nodes: readonly ChapterNode[],
  id: string,
  updater: (node: ChapterNode) => ChapterNode,
): ChapterNode[] {
  return nodes.map((node) => {
    if (node.id === id) return updater(node);
    if (!node.children) return node;
    return { ...node, children: updateNode(node.children, id, updater) };
  });
}

export function collectContents(nodes: readonly ChapterNode[]): string[] {
  const texts: string[] = [];
  for (const node of nodes) {
    if (node.content) texts.push(node.content);
    if (node.children) texts.push(...collectContents(node.children));
  }
  return texts;
}
