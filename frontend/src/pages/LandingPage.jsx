import { Link } from 'react-router-dom';
import { MapPin, Navigation, QrCode, Layers, Zap, Shield } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface-950 overflow-x-hidden">
      {/* Grid background */}
      <div className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(rgba(99,102,241,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.03) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }}
      />

      {/* Glow blobs */}
      <div className="fixed top-0 left-1/4 w-96 h-96 bg-brand-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-1/4 right-1/4 w-64 h-64 bg-violet-600/15 rounded-full blur-3xl pointer-events-none" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-gradient-to-br from-brand-500 to-violet-500 rounded-lg flex items-center justify-center">
            <Navigation className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold text-lg text-white">CampusNav</span>
        </div>
        <Link to="/admin/login"
          className="btn-secondary text-sm py-2">
          Admin Portal →
        </Link>
      </nav>

      {/* Hero */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pt-20 pb-32 text-center">
        <div className="inline-flex items-center gap-2 glass px-4 py-2 rounded-full text-sm text-brand-300 mb-8 animate-in">
          <Zap className="w-3.5 h-3.5" />
          Indoor Navigation for Smart Institutions
        </div>

        <h1 className="font-display text-5xl md:text-7xl font-bold mb-6 leading-tight tracking-tight">
          Navigate any campus{' '}
          <span className="text-gradient">without asking</span>{' '}
          for directions
        </h1>

        <p className="text-white/50 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
          Scan a QR code. Find your destination. Follow the route.
          CampusNav brings smart indoor navigation to colleges, hospitals, events, and more.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/admin/login" className="btn-primary text-base px-6 py-3">
            Get Started Free →
          </Link>
          <a href="#how-it-works" className="btn-secondary text-base px-6 py-3">
            See how it works
          </a>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="relative z-10 max-w-5xl mx-auto px-6 pb-20">
        <h2 className="font-display text-3xl font-bold text-center mb-12 text-white">
          How it works
        </h2>
        <div className="grid md:grid-cols-4 gap-4">
          {[
            { icon: QrCode, step: '01', title: 'Scan QR', desc: 'Visitor scans a QR code placed at their location' },
            { icon: MapPin, step: '02', title: 'Opens Map', desc: 'Website opens instantly with their current location marked' },
            { icon: Navigation, step: '03', title: 'Pick Destination', desc: 'Search and select where they want to go' },
            { icon: Layers, step: '04', title: 'Follow Route', desc: 'Shortest path shown with step-by-step directions' },
          ].map(({ icon: Icon, step, title, desc }) => (
            <div key={step} className="card relative group hover:border-brand-500/30 transition-all duration-300">
              <div className="text-xs font-mono text-brand-500/60 mb-3">{step}</div>
              <div className="w-10 h-10 bg-brand-600/20 rounded-xl flex items-center justify-center mb-3 group-hover:bg-brand-600/30 transition-colors">
                <Icon className="w-5 h-5 text-brand-400" />
              </div>
              <h3 className="font-display font-semibold text-white mb-1.5">{title}</h3>
              <p className="text-white/40 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pb-24">
        <div className="glass rounded-3xl p-8 md:p-12">
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: Layers, title: 'Multi-Floor', desc: 'Navigate across floors with staircase and elevator routing' },
              { icon: Shield, title: 'No App Needed', desc: 'Entirely web-based. Works on any smartphone instantly.' },
              { icon: Zap, title: 'Admin Tools', desc: 'Powerful map editor with drag & drop room creation.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-4">
                <div className="w-10 h-10 bg-brand-600/20 rounded-xl flex-shrink-0 flex items-center justify-center mt-0.5">
                  <Icon className="w-5 h-5 text-brand-400" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-white mb-1">{title}</h3>
                  <p className="text-white/40 text-sm leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 px-6 py-8 text-center text-white/30 text-sm">
        <p>© 2025 CampusNav · Built for smart campuses</p>
      </footer>
    </div>
  );
}
