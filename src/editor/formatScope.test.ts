import { describe, expect, it } from 'vitest';
import type { ChapterNode } from '../data/demo';
import { collectWritableNodes, planFormat, planUndo, snapshotOf } from './formatScope';

const IDEO = '　';

/** 全書：卷 → 章（有子幕、章自己也有正文）→ 幕；另有空章與沒子節點的章。 */
function tree(): ChapterNode[] {
  return [
    {
      id: 'v1',
      type: 'folder',
      title: '第一卷　 長長長長長長長長長長長長長長長長長長長長',
      content: '卷不該被改\n\n\n',
      children: [
        {
          id: 'c1',
          type: 'file',
          title: '第一章',
          content: '甲\n乙\n\n\n丙',
          children: [
            { id: 's1', type: 'scene', title: '第一幕', content: '丁\n戊' },
            { id: 's2', type: 'scene', title: '第二幕', content: '' },
          ],
        },
        { id: 'c2', type: 'file', title: '第二章', content: '' },
        { id: 'c3', type: 'file', title: '第三章', content: `${IDEO}${IDEO}己\n\n${IDEO}${IDEO}庚` },
      ],
    },
    { id: 'c4', type: 'file', title: '第四章', content: ' 辛\n壬' },
  ];
}

describe('WO-122 範圍：目前這一章／幕', () => {
  it('目前章：只改這一章，不連同其子幕', () => {
    const plan = planFormat({ nodes: tree(), currentId: 'c1', scope: 'chapter', kind: 'space-paragraphs' });
    expect(plan).toEqual({
      status: 'ok',
      changes: [{ nodeId: 'c1', before: '甲\n乙\n\n\n丙', after: '甲\n\n乙\n\n丙' }],
    });
  });

  it('目前幕：只改這一幕', () => {
    const plan = planFormat({ nodes: tree(), currentId: 's1', scope: 'chapter', kind: 'space-paragraphs' });
    expect(plan).toEqual({ status: 'ok', changes: [{ nodeId: 's1', before: '丁\n戊', after: '丁\n\n戊' }] });
  });

  it('寫作框最新的字優先於稿子裡存的字', () => {
    const plan = planFormat({
      nodes: tree(),
      currentId: 'c4',
      scope: 'chapter',
      kind: 'strip-blank',
      liveText: '子\n\n\n丑',
    });
    expect(plan).toEqual({ status: 'ok', changes: [{ nodeId: 'c4', before: '子\n\n\n丑', after: '子\n丑' }] });
  });

  it('目前節點不存在或是資料夾：沒有目標', () => {
    expect(planFormat({ nodes: tree(), currentId: 'zzz', scope: 'chapter', kind: 'indent' })).toEqual({
      status: 'no-target',
    });
    expect(planFormat({ nodes: tree(), currentId: 'v1', scope: 'book', kind: 'indent' })).toEqual({
      status: 'no-target',
    });
  });

  it('已開章但正文為空：這一章可選，結果無改動', () => {
    expect(planFormat({ nodes: tree(), currentId: 'c2', scope: 'chapter', kind: 'indent' })).toEqual({
      status: 'ok',
      changes: [],
    });
  });
});

describe('WO-122 範圍：全書', () => {
  it('遞迴含章自身與其下的幕，卷不算；順序依樹', () => {
    expect(collectWritableNodes(tree()).map((n) => n.id)).toEqual(['c1', 's1', 's2', 'c2', 'c3', 'c4']);
  });

  it('全書：章自己的正文也處理（不因有子節點而漏掉），空章與已整齊的章不進變更集合', () => {
    const plan = planFormat({ nodes: tree(), currentId: 'c4', scope: 'book', kind: 'space-paragraphs' });
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.changes.map((c) => c.nodeId)).toEqual(['c1', 's1', 'c4']);
    expect(plan.changes.find((c) => c.nodeId === 'c1')?.after).toBe('甲\n\n乙\n\n丙');
  });

  it('全書(a)：未開的章幕也縮排，卷的正文不動', () => {
    const plan = planFormat({ nodes: tree(), currentId: 'c4', scope: 'book', kind: 'indent' });
    if (plan.status !== 'ok') throw new Error('plan');
    expect(plan.changes.map((c) => c.nodeId)).toEqual(['c1', 's1', 'c4']);
    expect(plan.changes.find((c) => c.nodeId === 'v1')).toBeUndefined();
  });

  it('全書：目前章用寫作框最新的字，其餘用稿子存的字', () => {
    const plan = planFormat({
      nodes: tree(),
      currentId: 'c4',
      scope: 'book',
      kind: 'strip-blank',
      liveText: '子\n\n丑',
    });
    if (plan.status !== 'ok') throw new Error('plan');
    expect(plan.changes.find((c) => c.nodeId === 'c4')).toEqual({ nodeId: 'c4', before: '子\n\n丑', after: '子\n丑' });
    expect(plan.changes.find((c) => c.nodeId === 'c1')?.after).toBe('甲\n乙\n丙');
  });

  it('規劃不改動輸入的節點樹（標題、卷、卡片以外資料原樣）', () => {
    const nodes = tree();
    const before = JSON.stringify(nodes);
    planFormat({ nodes, currentId: 'c1', scope: 'book', kind: 'indent' });
    expect(JSON.stringify(nodes)).toBe(before);
  });
});

describe('WO-122 快照與復原規劃', () => {
  const changes = [
    { nodeId: 'c1', before: '甲\n乙', after: '甲\n\n乙' },
    { nodeId: 's1', before: '丁\n戊', after: '丁\n\n戊' },
  ];

  it('快照只含有變更的章幕與排版前的完整正文', () => {
    const snapshot = snapshotOf({ projectId: 'p', kind: 'space-paragraphs', scope: 'book', changes });
    expect(snapshot).toEqual({
      projectId: 'p',
      kind: 'space-paragraphs',
      scope: 'book',
      entries: [
        { nodeId: 'c1', before: '甲\n乙', after: '甲\n\n乙' },
        { nodeId: 's1', before: '丁\n戊', after: '丁\n\n戊' },
      ],
    });
  });

  it('沒有快照或是別的稿子的快照：沒有可復原', () => {
    expect(planUndo(null, 'p', tree())).toEqual({ status: 'none' });
    expect(planUndo(undefined, 'p', tree())).toEqual({ status: 'none' });
    const snapshot = snapshotOf({ projectId: 'p', kind: 'indent', scope: 'book', changes });
    expect(planUndo(snapshot, 'other', tree())).toEqual({ status: 'none' });
  });

  it('其中一個章幕已經不在：整批停止（invalid），稿子不在也一樣', () => {
    const snapshot = snapshotOf({ projectId: 'p', kind: 'indent', scope: 'book', changes });
    const without = collectWritableNodes(tree()).filter((n) => n.id !== 's1');
    expect(planUndo(snapshot, 'p', [{ id: 'c1', type: 'file', title: 'x', content: '' }, ...without.slice(0, 0)])).toEqual({
      status: 'invalid',
    });
    expect(planUndo(snapshot, 'p', null)).toEqual({ status: 'invalid' });
  });

  it('章幕都在且正文未變：回傳可還原的項目（複本，不共用物件）', () => {
    const nodes = tree();
    const afterNodes: ChapterNode[] = [
      {
        ...nodes[0]!,
        children: [
          { ...nodes[0]!.children![0]!, content: '甲\n\n乙', children: [{ ...nodes[0]!.children![0]!.children![0]!, content: '丁\n\n戊' }] },
        ],
      },
    ];
    const snapshot = snapshotOf({ projectId: 'p', kind: 'indent', scope: 'book', changes });
    const plan = planUndo(snapshot, 'p', afterNodes);
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.entries).toEqual(snapshot.entries);
    expect(plan.entries[0]).not.toBe(snapshot.entries[0]);

    // 任一章幕已有新編輯（或 live 新字）即判定失效，不可覆蓋新字
    expect(planUndo(snapshot, 'p', afterNodes, { nodeId: 'c1', text: '甲\n\n乙新字' })).toEqual({ status: 'invalid' });
  });
});
