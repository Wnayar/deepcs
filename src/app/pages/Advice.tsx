import { Link } from 'react-router';

/** The honest playbook: the whole preparation strategy, including the
 * parts this site does not sell. Trust copy first, funnel second. */
export function AdvicePage() {
  return (
    <div className="upgrade centered">
      <p className="kicker">The honest playbook</p>
      <h2>How to actually prepare for SWE interviews</h2>

      <ul className="playbook">
        <li>
          <strong className="lead-neetcode">NeetCode 150.</strong> Data structures and
          algorithms.
        </li>
        <li>
          <strong className="lead-deepcs">DeepCS.</strong> General technical rounds. Start with
          Easy and work your way up.
        </li>
        <li>
          <strong className="lead-projects">Personal projects.</strong> Find your dream SWE job
          at your ideal company, reverse its job description into project requirements on a
          topic you like, and build it.
        </li>
        <li>
          <strong className="lead-apply">Apply as early as possible to internships and jobs.</strong>
        </li>
      </ul>

      <Link className="navlink primary" to="/">
        Start the free Easy row
      </Link>
    </div>
  );
}
