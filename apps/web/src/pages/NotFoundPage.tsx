import { Link } from '../router/Link';
import { paths } from '../router/router';

export function NotFoundPage() {
  return (
    <section className="gate" aria-labelledby="gate-title">
      <h1 id="gate-title" className="gate-title">
        Page not found
      </h1>
      <p className="gate-text">This address does not match any page in the dashboard.</p>
      <Link to={paths.queue()} className="button">
        Go to sessions
      </Link>
    </section>
  );
}
