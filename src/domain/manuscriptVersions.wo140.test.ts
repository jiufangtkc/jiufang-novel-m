import { describe, expect, it } from 'vitest';
import {
  compareManuscriptVersionsDesc,
  createManuscriptVersion,
  discardManuscriptVersion,
  hasManualNote,
  isDuplicateOfLatestVersion,
  latestVersionForChapter,
  MANUSCRIPT_VERSION_AUTO_NOTE,
  MANUSCRIPT_VERSION_CHAPTER_LIMIT,
  nextManuscriptVersionSortOrder,
  normalizeManuscriptVersion,
  normalizeManuscriptVersions,
  restoreDiscardedManuscriptVersion,
  saveAutoVersionBeforeRestore,
  saveManualVersion,
  sortManuscriptVersions,
  summarizeChapterVersions,
  updateManuscriptVersionNote,
  versionsForChapter,
  type ManuscriptVersion,
} from './manuscriptVersions';
import { countWords } from './wordCount';

function makeSampleVersion(
  index: number,
  overrides: Partial<ManuscriptVersion> = {},
): ManuscriptVersion {
  const content = overrides.content ?? `【範例】第 ${index} 版正文內容`;
  return createManuscriptVersion({
    version_id: overrides.version_id ?? `ver-sample-${String(index).padStart(2, '0')}`,
    chapter_id: overrides.chapter_id ?? 'ch-sample-1',
    chapter_title_snapshot: overrides.chapter_title_snapshot ?? '第一章　霧港（範例）',
    content,
    note: overrides.note ?? '',
    source: overrides.source ?? 'manual',
    saved_at_ms: overrides.saved_at_ms ?? 1_764_100_000_000 + index * 1_000,
    sort_order: overrides.sort_order ?? 0,
  });
}

describe('WO-140 第 1 段：稿子版本領域模型與純函式規則', () => {
  it('建立版本時呼叫 countWords 計算字數，並允許空白章正文', () => {
    const sampleText = '【範例】霧港的夜色很深，clock 指向 12:30。';
    const v1 = createManuscriptVersion({
      version_id: 'v-1',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章　霧港（範例）',
      content: sampleText,
      note: '大改前',
      saved_at_ms: 1_764_100_000_000,
    });
    expect(v1.word_count).toBe(countWords(sampleText));
    expect(v1.source).toBe('manual');
    expect(v1.sort_order).toBe(0);

    const emptyChapterVersion = createManuscriptVersion({
      version_id: 'v-empty',
      chapter_id: 'ch-sample-2',
      chapter_title_snapshot: '第二章　空白章（範例）',
      content: '',
      saved_at_ms: 1_764_100_001_000,
    });
    expect(emptyChapterVersion.content).toBe('');
    expect(emptyChapterVersion.word_count).toBe(0);
  });

  it('清單依 saved_at_ms DESC, sort_order DESC, version_id DESC 排序（最新在前）', () => {
    const a = makeSampleVersion(1, {
      version_id: 'v-a',
      saved_at_ms: 1_000,
      sort_order: 0,
    });
    const b = makeSampleVersion(2, {
      version_id: 'v-b',
      saved_at_ms: 1_000,
      sort_order: 1,
    });
    const c = makeSampleVersion(3, {
      version_id: 'v-c',
      saved_at_ms: 1_000,
      sort_order: 1,
    });
    const d = makeSampleVersion(4, {
      version_id: 'v-d',
      saved_at_ms: 2_000,
      sort_order: 0,
    });

    const input = [a, b, c, d];
    const sorted = sortManuscriptVersions(input);
    expect(sorted.map((item) => item.version_id)).toEqual(['v-d', 'v-c', 'v-b', 'v-a']);
    // 不修改原陣列
    expect(input.map((item) => item.version_id)).toEqual(['v-a', 'v-b', 'v-c', 'v-d']);
    expect(compareManuscriptVersionsDesc(d, c)).toBeLessThan(0);
    expect(nextManuscriptVersionSortOrder(input, 1_000)).toBe(2);
    expect(nextManuscriptVersionSortOrder(input, 3_000)).toBe(0);
  });

  it('手寫備註判定：僅 source === "manual" 且非純空白才受手寫保護', () => {
    expect(
      hasManualNote({ source: 'manual', note: '【範例】準備大修' }),
    ).toBe(true);
    expect(
      hasManualNote({ source: 'manual', note: '' }),
    ).toBe(false);
    expect(
      hasManualNote({ source: 'manual', note: '   　\n ' }),
    ).toBe(false);
    expect(
      hasManualNote({
        source: 'auto-before-restore',
        note: MANUSCRIPT_VERSION_AUTO_NOTE,
      }),
    ).toBe(false);
    expect(
      hasManualNote({
        source: 'auto-before-restore',
        note: '其他自動文字',
      }),
    ).toBe(false);
  });

  it('與該章最新一版正文完全相同時不再重複存；改回更早版本內容仍可存', () => {
    const first = saveManualVersion([], {
      version_id: 'v-1',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】第一段',
      note: '初稿',
      saved_at_ms: 1_000,
    });
    expect(first.kind).toBe('saved');
    if (first.kind !== 'saved') throw new Error('expected saved');

    expect(isDuplicateOfLatestVersion(first.versions, 'ch-sample-1', '【範例】第一段')).toBe(
      true,
    );
    expect(isDuplicateOfLatestVersion(first.versions, 'ch-sample-2', '【範例】第一段')).toBe(
      false,
    );

    const dup = saveManualVersion(first.versions, {
      version_id: 'v-2',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】第一段',
      note: '想換個備註再存',
      saved_at_ms: 2_000,
    });
    expect(dup.kind).toBe('duplicate');
    if (dup.kind !== 'duplicate') throw new Error('expected duplicate');
    expect(dup.reasonCode).toBe('duplicate-latest');
    expect(dup.versions).toHaveLength(1);

    const second = saveManualVersion(first.versions, {
      version_id: 'v-3',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】第二段（改過）',
      saved_at_ms: 3_000,
    });
    expect(second.kind).toBe('saved');
    if (second.kind !== 'saved') throw new Error('expected saved');

    // 最新一版已變成 v-3，改回跟 v-1 相同的字不算與最新一版重複
    const backToFirstContent = saveManualVersion(second.versions, {
      version_id: 'v-4',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】第一段',
      saved_at_ms: 4_000,
    });
    expect(backToFirstContent.kind).toBe('saved');
    if (backToFirstContent.kind !== 'saved') throw new Error('expected saved');
    expect(backToFirstContent.versions).toHaveLength(3);
  });

  it('每章上限 20 份：滿了先清最舊且無手寫備註者（含自動保存），不清有手寫備註者', () => {
    expect(MANUSCRIPT_VERSION_CHAPTER_LIMIT).toBe(20);
    // 構造 20 份：第 1 份有手寫備註（最舊）、第 2 份自動保存、第 3 份無備註手動、第 4～20 份皆有手寫備註
    const initial: ManuscriptVersion[] = [];
    for (let i = 1; i <= 20; i += 1) {
      if (i === 2) {
        initial.push(
          makeSampleVersion(i, {
            source: 'auto-before-restore',
            note: MANUSCRIPT_VERSION_AUTO_NOTE,
          }),
        );
      } else if (i === 3) {
        initial.push(
          makeSampleVersion(i, {
            source: 'manual',
            note: '',
          }),
        );
      } else {
        initial.push(
          makeSampleVersion(i, {
            source: 'manual',
            note: `【範例】手寫備註 ${i}`,
          }),
        );
      }
    }

    const res1 = saveManualVersion(initial, {
      version_id: 'v-new-21',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章　霧港（範例）',
      content: '【範例】全新第 21 次修改',
      note: '新存一版',
      saved_at_ms: 1_764_100_100_000,
    });
    expect(res1.kind).toBe('saved');
    if (res1.kind !== 'saved') throw new Error('expected saved');
    expect(res1.noticeCode).toBe('saved-evicted-oldest');
    expect(res1.evictedCount).toBe(1);
    // 清掉第 2 份（最舊且無手寫保護的自動保存），第 1 份手寫備註必須保留
    expect(res1.evictedVersions.map((v) => v.version_id)).toEqual(['ver-sample-02']);
    expect(res1.versions.some((v) => v.version_id === 'ver-sample-01')).toBe(true);
    expect(res1.versions).toHaveLength(20);

    // 再存一份，這次應清掉第 3 份（無備註的手動版本）
    const res2 = saveManualVersion(res1.versions, {
      version_id: 'v-new-22',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章　霧港（範例）',
      content: '【範例】全新第 22 次修改',
      note: '再存一版',
      saved_at_ms: 1_764_100_200_000,
    });
    expect(res2.kind).toBe('saved');
    if (res2.kind !== 'saved') throw new Error('expected saved');
    expect(res2.evictedVersions.map((v) => v.version_id)).toEqual(['ver-sample-03']);
    expect(res2.versions).toHaveLength(20);

    // 現在 20 份全都有手寫備註，手動存版必須拒絕並帶代號，且原清單完全不變
    const blocked = saveManualVersion(res2.versions, {
      version_id: 'v-new-23',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章　霧港（範例）',
      content: '【範例】第 23 次修改（應被擋）',
      note: '應該存不進去',
      saved_at_ms: 1_764_100_300_000,
    });
    expect(blocked.kind).toBe('blocked-full');
    if (blocked.kind !== 'blocked-full') throw new Error('expected blocked-full');
    expect(blocked.reasonCode).toBe('all-manual-noted-full');
    expect(blocked.versions).toHaveLength(20);
    expect(blocked.versions.some((v) => v.version_id === 'v-new-23')).toBe(false);
  });

  it('章 A 滿 20 份不影響章 B 存版，且不自動清除其他章節', () => {
    const chapterA = Array.from({ length: 20 }, (_, idx) =>
      makeSampleVersion(idx + 1, {
        chapter_id: 'ch-sample-A',
        note: `【範例】手寫 ${idx + 1}`,
      }),
    );

    const savedInB = saveManualVersion(chapterA, {
      version_id: 'v-b-1',
      chapter_id: 'ch-sample-B',
      chapter_title_snapshot: '第二章（範例）',
      content: '【範例】第二章內容',
      saved_at_ms: 1_764_100_500_000,
    });
    expect(savedInB.kind).toBe('saved');
    if (savedInB.kind !== 'saved') throw new Error('expected saved');
    expect(versionsForChapter(savedInB.versions, 'ch-sample-A')).toHaveLength(20);
    expect(versionsForChapter(savedInB.versions, 'ch-sample-B')).toHaveLength(1);
    expect(savedInB.evictedCount).toBe(0);
  });

  it('回到舊版前自動保存：滿 20 且皆手寫時暫留第 21 份；再還原時先清舊自動保存使上限收斂在 21', () => {
    const allManual20 = Array.from({ length: 20 }, (_, idx) =>
      makeSampleVersion(idx + 1, {
        chapter_id: 'ch-sample-1',
        note: `【範例】手寫 ${idx + 1}`,
      }),
    );

    // 第一次還原：滿 20 且皆有手寫備註，暫留第 21 份
    const auto1 = saveAutoVersionBeforeRestore(allManual20, {
      version_id: 'v-auto-1',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】第一次還原前的正文',
      saved_at_ms: 1_764_100_600_000,
    });
    expect(auto1.kind).toBe('saved');
    if (auto1.kind !== 'saved') throw new Error('expected saved');
    expect(auto1.overLimit).toBe(true);
    expect(auto1.noticeCode).toBe('auto-saved-over-limit');
    expect(auto1.version.source).toBe('auto-before-restore');
    expect(auto1.version.note).toBe(MANUSCRIPT_VERSION_AUTO_NOTE);
    expect(versionsForChapter(auto1.versions, 'ch-sample-1')).toHaveLength(21);

    const summary = summarizeChapterVersions(auto1.versions, 'ch-sample-1');
    expect(summary).toEqual({
      count: 21,
      limit: 20,
      manualNotedCount: 20,
      evictableCount: 1,
      isFull: true,
      isAllManualNotedFull: false,
      isOverLimit: true,
    });

    // 若此時嘗試手動存（20 手寫 + 1 自動保存 = 21 份），清完 1 份自動保存後仍剩 20 手寫，故拒絕手動存且不偷偷清掉該自動保存
    const manualBlocked = saveManualVersion(auto1.versions, {
      version_id: 'v-manual-blocked',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】試圖手動存第 22 份',
      saved_at_ms: 1_764_100_650_000,
    });
    expect(manualBlocked.kind).toBe('blocked-full');
    expect(manualBlocked.versions).toHaveLength(21);

    // 第二次還原：先清掉舊的自動保存 v-auto-1，再存新的 v-auto-2，數量收斂在 21（不變成 22）
    const auto2 = saveAutoVersionBeforeRestore(auto1.versions, {
      version_id: 'v-auto-2',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】第二次還原前的正文',
      saved_at_ms: 1_764_100_700_000,
    });
    expect(auto2.kind).toBe('saved');
    if (auto2.kind !== 'saved') throw new Error('expected saved');
    expect(auto2.evictedVersions.map((v) => v.version_id)).toEqual(['v-auto-1']);
    expect(auto2.overLimit).toBe(true);
    expect(versionsForChapter(auto2.versions, 'ch-sample-1')).toHaveLength(21);
    expect(auto2.versions.some((v) => v.version_id === 'v-auto-2')).toBe(true);

    // 若目前正文剛好與最新一版相同，自動保存沿用最新一版而不重複建列
    const reused = saveAutoVersionBeforeRestore(auto2.versions, {
      version_id: 'v-auto-3',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】第二次還原前的正文',
      saved_at_ms: 1_764_100_800_000,
    });
    expect(reused.kind).toBe('reused-latest');
    if (reused.kind !== 'reused-latest') throw new Error('expected reused-latest');
    expect(reused.version.version_id).toBe('v-auto-2');
    expect(versionsForChapter(reused.versions, 'ch-sample-1')).toHaveLength(21);

    // 必修 2：把暫留第 21 份自動保存改成手寫備註後，21 份皆受保護，再自動保存必須回傳 blocked-full 且不出現第 22 份
    const promotedAuto = updateManuscriptVersionNote(
      auto2.versions,
      'v-auto-2',
      '【範例】這第 21 份也很重要',
    );
    expect(promotedAuto.kind).toBe('updated');
    if (promotedAuto.kind !== 'updated') throw new Error('expected updated');
    expect(promotedAuto.version.source).toBe('manual');

    const blocked22 = saveAutoVersionBeforeRestore(promotedAuto.versions, {
      version_id: 'v-auto-4',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】試圖擠出第 22 份的新正文',
      saved_at_ms: 1_764_100_900_000,
    });
    expect(blocked22.kind).toBe('blocked-full');
    if (blocked22.kind !== 'blocked-full') throw new Error('expected blocked-full');
    expect(blocked22.reasonCode).toBe('all-manual-noted-full');
    expect(versionsForChapter(blocked22.versions, 'ch-sample-1')).toHaveLength(21);
    expect(blocked22.versions.some((v) => v.version_id === 'v-auto-4')).toBe(false);
  });

  it('補／改備註：自動保存改寫為不同手寫備註轉為 manual 並受保護；清空備註解除保護', () => {
    const autoVer = makeSampleVersion(1, {
      version_id: 'v-auto',
      source: 'auto-before-restore',
      note: MANUSCRIPT_VERSION_AUTO_NOTE,
    });
    expect(hasManualNote(autoVer)).toBe(false);

    // 沒改字直接儲存自動備註，不轉為 manual
    const unchanged = updateManuscriptVersionNote(
      [autoVer],
      'v-auto',
      MANUSCRIPT_VERSION_AUTO_NOTE,
    );
    expect(unchanged.kind).toBe('updated');
    if (unchanged.kind !== 'updated') throw new Error('expected updated');
    expect(unchanged.version.source).toBe('auto-before-restore');
    expect(unchanged.becameManualProtected).toBe(false);
    expect(hasManualNote(unchanged.version)).toBe(false);

    // 改寫成不同的非空白手寫備註 → 轉為 manual 並受手寫保護
    const edited = updateManuscriptVersionNote(
      unchanged.versions,
      'v-auto',
      '【範例】改前重要備份',
    );
    expect(edited.kind).toBe('updated');
    if (edited.kind !== 'updated') throw new Error('expected updated');
    expect(edited.version.source).toBe('manual');
    expect(edited.version.note).toBe('【範例】改前重要備份');
    expect(edited.becameManualProtected).toBe(true);
    expect(hasManualNote(edited.version)).toBe(true);

    // 清空備註（純空白）→ 正規化為空字串並解除手寫保護
    const cleared = updateManuscriptVersionNote(edited.versions, 'v-auto', '   ');
    expect(cleared.kind).toBe('updated');
    if (cleared.kind !== 'updated') throw new Error('expected updated');
    expect(cleared.version.note).toBe('');
    expect(cleared.clearedManualProtection).toBe(true);
    expect(hasManualNote(cleared.version)).toBe(false);

    const missing = updateManuscriptVersionNote(cleared.versions, 'no-such-id', '測試');
    expect(missing.kind).toBe('not-found');
  });

  it('自動保存改寫為手寫備註後不受自動清理；手寫備註清空後可被自動清理', () => {
    // 1 筆最舊的自動保存 + 19 筆手寫備註（共 20 份）
    const base: ManuscriptVersion[] = [
      makeSampleVersion(1, {
        version_id: 'v-oldest-auto',
        source: 'auto-before-restore',
        note: MANUSCRIPT_VERSION_AUTO_NOTE,
        saved_at_ms: 1_000,
      }),
      ...Array.from({ length: 19 }, (_, idx) =>
        makeSampleVersion(idx + 2, {
          note: `【範例】手寫 ${idx + 2}`,
          saved_at_ms: 2_000 + idx * 1_000,
        }),
      ),
    ];

    // 將最舊的自動保存補上手寫備註 → 20 份全受手寫保護，手動存應被擋下
    const promoted = updateManuscriptVersionNote(base, 'v-oldest-auto', '【範例】轉為手寫保護');
    expect(promoted.kind).toBe('updated');
    if (promoted.kind !== 'updated') throw new Error('expected updated');
    const blocked = saveManualVersion(promoted.versions, {
      version_id: 'v-blocked',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】試圖擠掉剛保護的版',
      saved_at_ms: 50_000,
    });
    expect(blocked.kind).toBe('blocked-full');
    expect(blocked.versions.some((v) => v.version_id === 'v-oldest-auto')).toBe(true);

    // 把原本受保護的第 2 筆清空備註 → 解除保護，再手動存版會清掉它
    const unprotected = updateManuscriptVersionNote(promoted.versions, 'ver-sample-02', '');
    expect(unprotected.kind).toBe('updated');
    if (unprotected.kind !== 'updated') throw new Error('expected updated');
    expect(unprotected.clearedManualProtection).toBe(true);

    const saved = saveManualVersion(unprotected.versions, {
      version_id: 'v-after-unprotect',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】清掉已解除保護的版本',
      saved_at_ms: 60_000,
    });
    expect(saved.kind).toBe('saved');
    if (saved.kind !== 'saved') throw new Error('expected saved');
    expect(saved.evictedVersions.map((v) => v.version_id)).toEqual(['ver-sample-02']);
    expect(saved.versions.some((v) => v.version_id === 'v-oldest-auto')).toBe(true);
  });

  it('丟掉與復原丟掉：移除並原樣放回清單原排序位置，含重複與滿限情境', () => {
    const v1 = makeSampleVersion(1, { version_id: 'v-1', note: '【範例】第一版', saved_at_ms: 1_000 });
    const v2 = makeSampleVersion(2, { version_id: 'v-2', note: '【範例】第二版', saved_at_ms: 2_000 });
    const v3 = makeSampleVersion(3, { version_id: 'v-3', note: '【範例】第三版', saved_at_ms: 3_000 });
    const list = sortManuscriptVersions([v1, v2, v3]);

    const discarded = discardManuscriptVersion(list, 'v-2');
    expect(discarded.kind).toBe('discarded');
    if (discarded.kind !== 'discarded') throw new Error('expected discarded');
    expect(discarded.removed).toEqual(v2);
    expect(discarded.versions.map((v) => v.version_id)).toEqual(['v-3', 'v-1']);

    const restored = restoreDiscardedManuscriptVersion(discarded.versions, discarded.removed);
    expect(restored.kind).toBe('restored');
    if (restored.kind !== 'restored') throw new Error('expected restored');
    expect(restored.versions.map((v) => v.version_id)).toEqual(['v-3', 'v-2', 'v-1']);
    expect(latestVersionForChapter(restored.versions, 'ch-sample-1')?.version_id).toBe('v-3');

    // 已存在同 version_id 不重複插入
    const dupRestore = restoreDiscardedManuscriptVersion(restored.versions, v2);
    expect(dupRestore.kind).toBe('already-exists');
    expect(dupRestore.versions).toHaveLength(3);

    // 不存在的 id 丟掉回傳 not-found
    const missingDiscard = discardManuscriptVersion(restored.versions, 'v-missing');
    expect(missingDiscard.kind).toBe('not-found');
    expect(missingDiscard.removed).toBeNull();
  });

  it('必修 3：暫留 21 份（20 手寫＋1 自動保存）時，丟掉手寫再立即復原，不可清掉自動保存且數量回到 21', () => {
    const manual20 = Array.from({ length: 20 }, (_, idx) =>
      makeSampleVersion(idx + 1, {
        version_id: `v-m-${idx + 1}`,
        note: `【範例】手寫 ${idx + 1}`,
        saved_at_ms: 1_764_100_000_000 + idx * 1_000,
      }),
    );
    const autoRes = saveAutoVersionBeforeRestore(manual20, {
      version_id: 'v-auto-21',
      chapter_id: 'ch-sample-1',
      chapter_title_snapshot: '第一章（範例）',
      content: '【範例】暫留第 21 份自動保存',
      saved_at_ms: 1_764_100_050_000,
    });
    expect(autoRes.kind).toBe('saved');
    if (autoRes.kind !== 'saved') throw new Error('expected saved');
    expect(autoRes.versions).toHaveLength(21);

    // 丟掉 1 份手寫備註版（剩 19 手寫 + 1 自動保存 = 20）
    const afterDiscard = discardManuscriptVersion(autoRes.versions, 'v-m-5');
    expect(afterDiscard.kind).toBe('discarded');
    if (afterDiscard.kind !== 'discarded') throw new Error('expected discarded');
    expect(afterDiscard.versions).toHaveLength(20);

    // 立即復原剛丟掉的手寫版 → 回到 21 份，且自動保存仍在
    const afterUndo = restoreDiscardedManuscriptVersion(
      afterDiscard.versions,
      afterDiscard.removed,
    );
    expect(afterUndo.kind).toBe('restored');
    if (afterUndo.kind !== 'restored') throw new Error('expected restored');
    expect(afterUndo.evictedCount).toBe(0);
    expect(afterUndo.versions).toHaveLength(21);
    expect(afterUndo.versions.some((v) => v.version_id === 'v-auto-21')).toBe(true);
    expect(afterUndo.versions.some((v) => v.version_id === 'v-m-5')).toBe(true);

    // 20 份皆手寫（無自動保存作為暫留理由）時，放回第 21 份手寫應回傳 blocked-full
    const extraManual = makeSampleVersion(99, {
      version_id: 'v-extra-manual',
      note: '【範例】額外手寫',
      saved_at_ms: 1_764_100_060_000,
    });
    const blockedNoAuto = restoreDiscardedManuscriptVersion(manual20, extraManual);
    expect(blockedNoAuto.kind).toBe('blocked-full');
    expect(blockedNoAuto.versions).toHaveLength(20);

    // 21 份（20 手寫 + 1 自動保存）時，若再放回另一份版本（會超過 21），不得丟掉原有自動保存來換位子
    const blockedAt21 = restoreDiscardedManuscriptVersion(autoRes.versions, extraManual);
    expect(blockedAt21.kind).toBe('blocked-full');
    expect(blockedAt21.versions).toHaveLength(21);
    expect(blockedAt21.versions.some((v) => v.version_id === 'v-auto-21')).toBe(true);

    // 20 份中含 1 份無備註手動版（無自動保存）時，放回手寫會清掉最舊無備註手動版、維持 20 份
    const withUnnoted = manual20.map((v, idx) =>
      idx === 0 ? { ...v, note: '' } : v,
    );
    const evictedUnnoted = restoreDiscardedManuscriptVersion(withUnnoted, extraManual);
    expect(evictedUnnoted.kind).toBe('restored');
    if (evictedUnnoted.kind !== 'restored') throw new Error('expected restored');
    expect(evictedUnnoted.evictedVersions.map((v) => v.version_id)).toEqual(['v-m-1']);
    expect(evictedUnnoted.versions).toHaveLength(20);
  });

  it('空白章正文連續存版亦正確去重', () => {
    const firstEmpty = saveManualVersion([], {
      version_id: 'v-empty-1',
      chapter_id: 'ch-sample-empty',
      chapter_title_snapshot: '空白章（範例）',
      content: '',
      saved_at_ms: 1_000,
    });
    expect(firstEmpty.kind).toBe('saved');
    if (firstEmpty.kind !== 'saved') throw new Error('expected saved');
    expect(firstEmpty.version.word_count).toBe(0);

    const dupEmpty = saveManualVersion(firstEmpty.versions, {
      version_id: 'v-empty-2',
      chapter_id: 'ch-sample-empty',
      chapter_title_snapshot: '空白章（範例）',
      content: '',
      saved_at_ms: 2_000,
    });
    expect(dupEmpty.kind).toBe('duplicate');
  });

  it('normalizeManuscriptVersions 合法化、依 version_id 去重且保留已刪章版本（決-3 不做孤兒清理）', () => {
    const raw = [
      {
        version_id: 'v-deleted-chapter',
        chapter_id: 'ch-deleted-99',
        chapter_title_snapshot: '【範例】已刪掉的章',
        content: '【範例】刪章前的文字',
        note: '重要',
        source: 'manual',
        saved_at_ms: 5_000,
      },
      {
        version_id: 'v-deleted-chapter',
        chapter_id: 'ch-deleted-99',
        content: '【範例】重複 id 應被略過',
        source: 'manual',
        saved_at_ms: 6_000,
      },
      {
        version_id: 'v-bad-source',
        chapter_id: 'ch-sample-1',
        content: '【範例】錯誤來源',
        source: 'unknown',
        saved_at_ms: 4_000,
      },
      {
        version_id: '',
        chapter_id: 'ch-sample-1',
        content: '【範例】缺 id',
        source: 'manual',
        saved_at_ms: 4_000,
      },
      {
        version_id: 'v-empty-content',
        chapter_id: 'ch-sample-2',
        content: '',
        source: 'auto-before-restore',
        saved_at_ms: 3_000,
      },
    ];

    expect(normalizeManuscriptVersion(raw[2])).toBeNull();
    const normalized = normalizeManuscriptVersions(raw);
    expect(normalized).toHaveLength(2);
    expect(normalized.map((v) => v.version_id)).toEqual([
      'v-deleted-chapter',
      'v-empty-content',
    ]);
    // 缺 word_count 時自動用 countWords 重算
    expect(normalized[0]!.word_count).toBe(countWords('【範例】刪章前的文字'));
    expect(normalized[1]!.word_count).toBe(0);
    // 已刪章節 id 仍完整保留（決-3）
    expect(normalized[0]!.chapter_id).toBe('ch-deleted-99');
  });
});
