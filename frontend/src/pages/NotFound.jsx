// CampusNav redesign — NotFound.jsx — updated
import { Link } from "react-router-dom";
import { Compass, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="page-shell flex min-h-screen items-center justify-center px-6 py-12">
      <div className="card max-w-xl text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl bg-accent-light text-accent">
          <Compass className="h-8 w-8" />
        </div>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-muted">
          404
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-[-0.02em]">
          This page is off the route map
        </h1>
        <p className="mt-4 text-base subtle-text">
          The page you were looking for is not available. Head back to the
          CampusNav homepage to continue.
        </p>
        <Link to="/" className="btn-primary mt-8">
          <Home className="h-4 w-4" />
          Return Home
        </Link>
      </div>
    </div>
  );
}
