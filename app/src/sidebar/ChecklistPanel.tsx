import { useTripModel } from '../trip/TripContext.tsx';

import styles from './Sidebar.module.css';

/** Things to arrange before the trip, from trip.yaml. */
export function ChecklistPanel() {
  const { bundle } = useTripModel();
  if (!bundle.checklist) return null;
  return (
    <section className={styles.group} id="checklist">
      <h2 className={styles.groupTitle}>Before you go</h2>
      <ul className={styles.checklist}>
        {bundle.checklist.map((item) => (
          <li key={item.text}>
            {item.text}
            {item.link && (
              <>
                {' '}
                <a href={item.link.url} target="_blank" rel="noreferrer">
                  {item.link.label}
                </a>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
