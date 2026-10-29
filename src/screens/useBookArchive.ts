import { useCallback, useEffect, useState } from 'react';
import { archiveWriteFailureMessage, type ArchiveWriteKind } from '../copy/userFacing';
import { bookArchive } from '../db/chapterArchive';
import { emptyArchive, type BookArchive } from '../domain/chapterVersions';
import { useSample } from '../state/sampleStore';

export function useBookArchive(bookId: string): {
  archive: BookArchive;
  update: (recipe: (current: BookArchive) => BookArchive, kind?: ArchiveWriteKind) => Promise<BookArchive>;
  archivePersistOk: boolean;
} {
  const { actions } = useSample();
  const [archive, setArchive] = useState<BookArchive>(emptyArchive());
  const [archivePersistOk, setArchivePersistOk] = useState(() => bookArchive.isPersistOk(bookId));

  useEffect(() => {
    let alive = true;
    const unsubscribe = bookArchive.subscribe((id, next) => {
      if (alive && id === bookId) setArchive(next);
    });
    const unsubscribePersist = bookArchive.subscribePersist((id, ok, kind) => {
      if (!alive || id !== bookId) return;
      setArchivePersistOk(ok);
      if (!ok) {
        const noticeKind: ArchiveWriteKind = kind === 'delete' || kind === 'restore' ? kind : 'version';
        actions.toast(archiveWriteFailureMessage(noticeKind));
      }
    });
    void bookArchive.read(bookId).then((data) => {
      if (alive) setArchive(data);
    });
    return () => {
      alive = false;
      unsubscribe();
      unsubscribePersist();
    };
  }, [bookId, actions]);

  const update = useCallback(
    (recipe: (current: BookArchive) => BookArchive, kind: ArchiveWriteKind = 'version') => {
      setArchive((current) => recipe(current));
      return bookArchive.update(bookId, recipe, kind);
    },
    [bookId],
  );

  return { archive, update, archivePersistOk };
}
