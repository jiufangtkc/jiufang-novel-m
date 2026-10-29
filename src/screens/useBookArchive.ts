import { useCallback, useEffect, useState } from 'react';
import { bookArchive } from '../db/chapterArchive';
import { emptyArchive, type BookArchive } from '../domain/chapterVersions';

export function useBookArchive(bookId: string): {
  archive: BookArchive;
  update: (recipe: (current: BookArchive) => BookArchive) => void;
} {
  const [archive, setArchive] = useState<BookArchive>(emptyArchive());

  useEffect(() => {
    let alive = true;
    const unsubscribe = bookArchive.subscribe((id, next) => {
      if (alive && id === bookId) setArchive(next);
    });
    void bookArchive.read(bookId).then((data) => {
      if (alive) setArchive(data);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [bookId]);

  const update = useCallback(
    (recipe: (current: BookArchive) => BookArchive) => {
      setArchive((current) => recipe(current));
      void bookArchive.update(bookId, recipe);
    },
    [bookId],
  );

  return { archive, update };
}
