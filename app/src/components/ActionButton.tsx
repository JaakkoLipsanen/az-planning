import { useState, type ReactNode } from 'react';

import styles from './ActionButton.module.css';

interface Props {
  run: () => Promise<string>;
  children: ReactNode;
  title?: string;
  primary?: boolean;
}

export function ActionButton({ run, children, title, primary = false }: Props) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const onClick = async (): Promise<void> => {
    setBusy(true);
    setStatus('Working…');
    try {
      setStatus(await run());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={primary ? styles.primary : styles.button}
        title={title}
        disabled={busy}
        onClick={() => void onClick()}
      >
        {children}
      </button>
      {status && (
        <span className={styles.status} aria-live="polite">
          {status}
        </span>
      )}
    </span>
  );
}
