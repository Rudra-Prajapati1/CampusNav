import { Link } from 'react-router-dom';
import { Navigation } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface-950 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-violet-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <Navigation className="w-8 h-8 text-white" />
        </div>
        <h1 className="font-display text-6xl font-bold text-white mb-3">404</h1>
        <p className="text-white/40 mb-8">This location doesn't exist on the map.</p>
        <Link to="/" className="btn-primary mx-auto w-fit">← Back to home</Link>
      </div>
    </div>
  );
}
