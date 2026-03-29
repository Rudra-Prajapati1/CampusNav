// CampusNav redesign — LandingPage.jsx — updated
import { useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  Compass,
  Mail,
  Map,
  Menu,
  Moon,
  Phone,
  Send,
  Sun,
} from "lucide-react";
import { INDUSTRY_TYPES, resolvePoiIcon } from "../config/poiTypes.js";
import { useTheme } from "../context/themeContext.jsx";

const featureCards = [
  {
    title: "Outdoor + Indoor Navigation",
    description:
      "Guide visitors from the road approach to the exact room, across entrances, floors, and wayfinding decision points.",
    icon: Map,
  },
  {
    title: "Custom Map Editor",
    description:
      "Create and maintain floor plans, doors, waypoints, and paths with a workspace built for real operations teams.",
    icon: Compass,
  },
  {
    title: "Admin Dashboard & Analytics",
    description:
      "Track mapped spaces, review building readiness, and keep navigation data current across every active venue.",
    icon: CalendarClock,
  },
];

const workflow = [
  "Add your building and define the entrance.",
  "Draw your floor plan, rooms, and routes.",
  "Publish and start navigating visitors in real time.",
];

const industryDescriptions = {
  education: "Universities, schools, research campuses",
  healthcare: "Hospitals, clinics, medical centers",
  corporate: "Office parks, HQs, co-working spaces",
  mall: "Shopping centers, outlet malls",
  events: "Conference halls, stadiums, expo centers",
  hospitality: "Hotels, resorts, convention centers",
};

const trustedBy = [
  "Universities",
  "Hospitals",
  "Corporate HQs",
  "Shopping Centers",
  "Event Venues",
];

export default function LandingPage() {
  const { isDark, toggleTheme } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [contactForm, setContactForm] = useState({
    name: "",
    email: "",
    organization: "",
    message: "",
  });

  const contactEmail = import.meta.env.VITE_CONTACT_EMAIL || "hello@campusnav.com";

  const handleContactSubmit = (event) => {
    event.preventDefault();

    const subject = encodeURIComponent(
      `CampusNav demo request from ${contactForm.organization || contactForm.name}`,
    );
    const body = encodeURIComponent(
      [
        `Name: ${contactForm.name}`,
        `Email: ${contactForm.email}`,
        `Organization: ${contactForm.organization}`,
        "",
        contactForm.message,
      ].join("\n"),
    );

    window.location.href = `mailto:${contactEmail}?subject=${subject}&body=${body}`;
  };

  const industries = [
    "education",
    "healthcare",
    "corporate",
    "mall",
    "events",
    "hospitality",
  ].map((industryId) => {
    const industry = INDUSTRY_TYPES[industryId];
    const Icon = resolvePoiIcon(industry.icon);
    return {
      ...industry,
      description: industryDescriptions[industryId],
      Icon,
    };
  });

  return (
    <div className="page-shell">
      <header className="sticky top-0 z-40 border-b border-default bg-[color:var(--color-map-overlay)] backdrop-blur-md">
        <div className="page-container flex min-h-[72px] items-center justify-between gap-4">
          <a href="#hero" className="app-logo">
            <span className="app-logo-mark">
              <Compass className="h-5 w-5" />
            </span>
            <span className="text-lg font-semibold">CampusNav</span>
          </a>

          <nav className="hidden items-center gap-8 text-sm font-medium text-secondary lg:flex">
            <a href="#features" className="transition-colors hover:text-primary">
              Features
            </a>
            <a href="#industries" className="transition-colors hover:text-primary">
              Industries
            </a>
            <a href="#pricing" className="transition-colors hover:text-primary">
              Pricing
            </a>
            <a href="#contact" className="transition-colors hover:text-primary">
              Contact
            </a>
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <button
              onClick={toggleTheme}
              className="btn-ghost px-3"
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <a href="#contact" className="btn-primary">
              Request a Demo
            </a>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <button
              onClick={toggleTheme}
              className="btn-ghost px-3"
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setMobileNavOpen((value) => !value)}
              className="btn-secondary px-3"
              aria-label="Toggle navigation menu"
            >
              <Menu className="h-4 w-4" />
            </button>
          </div>
        </div>

        {mobileNavOpen && (
          <div className="border-t border-default bg-surface lg:hidden">
            <div className="page-container flex flex-col gap-3 py-4 text-sm font-medium text-secondary">
              <a href="#features" onClick={() => setMobileNavOpen(false)}>
                Features
              </a>
              <a href="#industries" onClick={() => setMobileNavOpen(false)}>
                Industries
              </a>
              <a href="#pricing" onClick={() => setMobileNavOpen(false)}>
                Pricing
              </a>
              <a href="#contact" onClick={() => setMobileNavOpen(false)}>
                Contact
              </a>
              <a href="#contact" className="btn-primary mt-2" onClick={() => setMobileNavOpen(false)}>
                Request a Demo
              </a>
            </div>
          </div>
        )}
      </header>

      <main>
        <section id="hero" className="page-container grid gap-14 py-16 lg:grid-cols-[1fr_520px] lg:py-24">
          <div className="max-w-2xl">
            <span className="section-label">Map-First Indoor Navigation</span>
            <h1 className="mt-6 text-balance text-5xl font-bold tracking-[-0.02em] sm:text-6xl">
              Navigate Any Space, Instantly
            </h1>
            <p className="mt-6 text-lg subtle-text">
              CampusNav helps universities, hospitals, offices, malls, and venues
              guide people from the building entrance to the exact destination with
              a clean, enterprise-ready wayfinding experience.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#contact" className="btn-primary">
                Request a Demo
              </a>
              <a href="#features" className="btn-secondary">
                See How It Works
              </a>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-3 text-sm text-secondary">
              <span className="font-semibold text-primary">
                Trusted by universities, hospitals, and enterprises
              </span>
              {trustedBy.map((item) => (
                <span key={item} className="badge-neutral">
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="card relative overflow-hidden p-6">
            <div className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.12),transparent_70%)]" />
            <div className="relative rounded-xl border border-default bg-surface-alt p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-label">Live Route Preview</p>
                  <h2 className="mt-3 text-2xl font-bold tracking-[-0.02em]">
                    Clear wayfinding for complex buildings
                  </h2>
                </div>
                <span className="badge-success">Map Ready</span>
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-[220px_1fr]">
                <div className="space-y-3">
                  <div className="rounded-xl border border-default bg-surface p-4">
                    <p className="text-sm font-semibold text-primary">From</p>
                    <p className="mt-2 text-sm text-secondary">Main Entrance</p>
                  </div>
                  <div className="rounded-xl border border-default bg-surface p-4">
                    <p className="text-sm font-semibold text-primary">To</p>
                    <p className="mt-2 text-sm text-secondary">Radiology Desk</p>
                  </div>
                  <div className="rounded-xl border border-default bg-surface p-4">
                    <p className="text-sm font-semibold text-primary">Route Summary</p>
                    <div className="mt-3 grid gap-2 text-sm text-secondary">
                      <div className="flex items-center justify-between">
                        <span>Distance</span>
                        <span>184 m</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Time</span>
                        <span>4 min</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Floors</span>
                        <span>2</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className="relative min-h-[340px] overflow-hidden rounded-xl border border-default"
                  style={{
                    background:
                      "linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 84%, transparent), color-mix(in srgb, var(--color-surface-alt) 92%, transparent))",
                  }}
                >
                  <div
                    className="absolute inset-0 opacity-70"
                    style={{
                      backgroundImage:
                        "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
                      backgroundSize: "36px 36px",
                    }}
                  />
                  <div
                    className="absolute left-[10%] top-[14%] h-[70%] w-[80%] rounded-[24px] border border-default"
                    style={{ background: "color-mix(in srgb, var(--color-surface) 70%, transparent)" }}
                  />
                  <div
                    className="absolute left-[18%] top-[22%] h-[18%] w-[22%] rounded-[18px] bg-accent-light"
                    style={{ border: "1px solid color-mix(in srgb, var(--color-accent) 40%, var(--color-border))" }}
                  />
                  <div className="absolute left-[44%] top-[22%] h-[12%] w-[24%] rounded-[18px] border border-default bg-surface-alt" />
                  <div className="absolute left-[18%] top-[48%] h-[14%] w-[30%] rounded-[18px] border border-default bg-surface-alt" />
                  <div
                    className="absolute left-[56%] top-[44%] h-[18%] w-[18%] rounded-[18px] bg-accent-light"
                    style={{ border: "1px solid color-mix(in srgb, var(--color-accent) 40%, var(--color-border))" }}
                  />
                  <div className="absolute left-[20%] top-[72%] h-[8%] w-[54%] rounded-full bg-surface-alt" />
                  <svg
                    className="absolute inset-0 h-full w-full"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <path
                      d="M24 76 C35 76, 45 76, 53 76 C62 76, 66 60, 69 48 C72 36, 77 31, 83 30"
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray="8 6"
                    />
                  </svg>
                  <div className="absolute left-[20%] top-[72%] flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
                    A
                  </div>
                  <div className="absolute left-[78%] top-[26%] flex h-8 w-8 items-center justify-center rounded-full bg-surface text-xs font-semibold text-accent shadow-card">
                    B
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="industries" className="page-container py-16">
          <div className="page-header">
            <span className="section-label">Built For Your Industry</span>
            <h2>One Platform, Every Venue</h2>
            <p>
              Configure the same navigation platform for campuses, healthcare,
              offices, retail environments, events, and hospitality spaces.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {industries.map(({ id, label, description, Icon }) => (
              <article
                key={id}
                className="card-sm transition-transform duration-150 hover:-translate-y-1"
              >
                <div className="icon-chip">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-xl font-semibold tracking-[-0.02em]">
                  {label}
                </h3>
                <p className="mt-2 text-sm subtle-text">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="features" className="page-container py-16">
          <div className="page-header">
            <span className="section-label">How It Works</span>
            <h2>Built for operational clarity</h2>
            <p>
              CampusNav keeps maps, routing, and admin workflows aligned so teams
              can publish navigation confidently across every building.
            </p>
          </div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {featureCards.map(({ title, description, icon: Icon }) => (
              <article key={title} className="card-sm">
                <div className="icon-chip">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-xl font-semibold tracking-[-0.02em]">
                  {title}
                </h3>
                <p className="mt-3 text-sm subtle-text">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="page-container py-16">
          <div className="card">
            <div className="page-header">
              <span className="section-label">Deployment Steps</span>
              <h2>Publish your venue in three steps</h2>
            </div>
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {workflow.map((step, index) => (
                <div key={step} className="rounded-xl border border-default bg-surface-alt p-5">
                  <div className="text-3xl font-bold tracking-[-0.02em] text-accent">
                    0{index + 1}
                  </div>
                  <p className="mt-4 text-sm subtle-text">{step}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="page-container py-16">
          <div className="card text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-accent-light text-accent">
              <CalendarClock className="h-6 w-6" />
            </div>
            <h2 className="mt-6 text-4xl font-bold tracking-[-0.02em]">
              See CampusNav in Action
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base subtle-text">
              Book a 30-minute walkthrough to see how CampusNav handles public
              navigation, map editing, and operational rollout for your venue type.
            </p>
            <a href="#contact" className="btn-primary mt-8">
              Request a Demo
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>

        <section id="contact" className="page-container py-16">
          <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
            <div className="card">
              <div className="page-header">
                <span className="section-label">Contact</span>
                <h2>Talk to the CampusNav team</h2>
                <p>
                  Share your venue type, rollout goals, and the kind of navigation
                  experience you need. We will take it from there.
                </p>
              </div>
              <div className="mt-8 grid gap-4 text-sm">
                <div className="rounded-xl border border-default bg-surface-alt p-4">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-accent" />
                    <span className="font-medium text-primary">Email</span>
                  </div>
                  <p className="mt-2 subtle-text">{contactEmail}</p>
                </div>
                <div className="rounded-xl border border-default bg-surface-alt p-4">
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-accent" />
                    <span className="font-medium text-primary">Response Window</span>
                  </div>
                  <p className="mt-2 subtle-text">Typically within one business day</p>
                </div>
              </div>
            </div>

            <form className="card" onSubmit={handleContactSubmit}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="field-label">Name</label>
                  <input
                    className="input"
                    value={contactForm.name}
                    onChange={(event) =>
                      setContactForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Your name"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">Email</label>
                  <input
                    type="email"
                    className="input"
                    value={contactForm.email}
                    onChange={(event) =>
                      setContactForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    placeholder="you@organization.com"
                    required
                  />
                </div>
              </div>
              <div className="mt-4">
                <label className="field-label">Organization</label>
                <input
                  className="input"
                  value={contactForm.organization}
                  onChange={(event) =>
                    setContactForm((current) => ({
                      ...current,
                      organization: event.target.value,
                    }))
                  }
                  placeholder="Organization or venue"
                  required
                />
              </div>
              <div className="mt-4">
                <label className="field-label">Message</label>
                <textarea
                  className="textarea"
                  value={contactForm.message}
                  onChange={(event) =>
                    setContactForm((current) => ({
                      ...current,
                      message: event.target.value,
                    }))
                  }
                  placeholder="Tell us about your venue, scale, and rollout goals."
                  required
                />
              </div>
              <button type="submit" className="btn-primary mt-6">
                <Send className="h-4 w-4" />
                Send Request
              </button>
            </form>
          </div>
        </section>
      </main>

      <footer className="border-t border-default py-8">
        <div className="page-container flex flex-col gap-4 text-sm text-secondary md:flex-row md:items-center md:justify-between">
          <div>
            <div className="app-logo">
              <span className="app-logo-mark">
                <Compass className="h-4 w-4" />
              </span>
              <span>CampusNav</span>
            </div>
            <p className="mt-3">
              Enterprise indoor navigation for campuses, hospitals, offices,
              retail spaces, and venues.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <a href="#features">Features</a>
            <a href="#industries">Industries</a>
            <a href="#contact">Contact</a>
            <a href="#privacy">Privacy Policy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
