import { Link } from 'react-router';

/** The honest playbook: the whole preparation strategy, including the
 * parts this site does not sell. Trust copy first, funnel second. */
export function AdvicePage() {
  return (
    <div className="upgrade">
      <p className="kicker">The honest playbook</p>
      <h2>How to actually prepare for SWE interviews</h2>

      <ul className="playbook">
        <li>
          <strong className="lead-neetcode">NeetCode 150.</strong> Data structures and
          algorithms, on a schedule.
        </li>
        <li>
          <strong className="lead-deepcs">DeepCS.</strong> General technical rounds. Start with
          the free Easy row.
        </li>
        <li>
          <strong className="lead-projects">Reverse engineer postings you want.</strong> Build
          one project you enjoy that covers what they keep asking for.
        </li>
        <li>
          <strong className="lead-apply">Apply as early as possible.</strong> Deadlines roll.
        </li>
      </ul>

      <Link className="navlink primary" to="/">
        Start the free Easy row
      </Link>
    </div>
  );
}
