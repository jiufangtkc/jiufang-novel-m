import { useCallback, useEffect, useState } from 'react';
import { ARCHIVE_KEEP_FAIL } from '../copy/userFacing';
import { bookArchive } from '../db/chapterArchive';
import { emptyArchive, type BookArchive } from '../domain/chapterVersions';
import { useSample } from '../state/sampleStore';

export function useBookArchive(bookId: string): {
  archive: BookArchive;
  update: (recipe: (current: BookArchive) => BookArchive) => void;
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
    const unsubscribePersist = bookArchive.subscribePersist((id, ok) => {
      if (!alive || id !== bookId) return;
      setArchivePersistOk(ok);
      if (!ok) actions.toast(ARCHIVE_KEEP_FAIL);
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
    (recipe: (current: BookArchive) => BookArchive) => {
      setArchive((current) => recipe(current));
      void bookArchive.update(bookId, recipe);
    },
    [bookId],
  );

  return { archive, update, archivePersistOk };
}
