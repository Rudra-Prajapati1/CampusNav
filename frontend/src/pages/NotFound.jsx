import { Link } from "react-router-dom";
import { Compass, Home, Navigation } from "lucide-react";

export default function NotFound() {
  return (
    <div className="page-shell page-grid flex min-h-screen items-center justify-center px-4 py-10">
      <div className="card max-w-xl text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-brand-500/10 text-brand-500">
          <Compass className="h-8 w-8" />
        </div>
        <div className="mt-6 font-display text-6xl font-bold">404</div>
        <h1 className="mt-3 font-display text-3xl font-bold">This route is not on the map</h1>
        <p className="mx-auto mt-4 max-w-md text-base leading-7 subtle-text">
          The page you requested could not be found. Return to the landing page or jump straight into the admin workspace.
        </p>

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to="/" className="btn-primary">
            <Home className="h-4 w-4" />
            Back home
          </Link>
          <Link to="/admin" className="btn-secondary">
            <Navigation className="h-4 w-4" />
            Open admin
          </Link>
        </div>
      </div>
    </div>
  );
}
