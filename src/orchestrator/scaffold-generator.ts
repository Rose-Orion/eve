/**
 * ScaffoldGenerator — Template-based website scaffold system.
 *
 * Instead of Web Agent generating code from scratch, this provides
 * pre-built scaffolds that get customized with brand theme data.
 *
 * Template types:
 *   - ecommerce: Product catalog + cart + checkout (Stripe)
 *   - service: Service business landing page + booking
 *   - content: Blog/content site + newsletter signup
 *   - personal-brand: Portfolio + about + contact
 *
 * Each scaffold is a Next.js App Router project that gets:
 * 1. Brand colors, fonts, and copy injected from Foundation Package
 * 2. Stripe payment link embedded for ecommerce
 * 3. Analytics snippet added
 * 4. SEO metadata populated
 */

export type ScaffoldType = 'ecommerce' | 'service' | 'content' | 'personal-brand';

export interface BrandTheme {
  /** Business name */
  businessName: string;
  /** Tagline / slogan */
  tagline: string;
  /** Primary brand color (hex) */
  colorPrimary: string;
  /** Secondary brand color (hex) */
  colorSecondary: string;
  /** Neutral color (hex) */
  colorNeutral: string;
  /** Heading font (Google Fonts name) */
  fontHeading: string;
  /** Body font (Google Fonts name) */
  fontBody: string;
  /** Short business description */
  description: string;
  /** Products (for ecommerce scaffold) */
  products?: Array<{
    name: string;
    description: string;
    priceCents: number;
    paymentLink?: string;
    imageUrl?: string;
  }>;
  /** Services (for service scaffold) */
  services?: Array<{
    name: string;
    description: string;
    price?: string;
  }>;
  /** Social links */
  socialLinks?: {
    instagram?: string;
    tiktok?: string;
    facebook?: string;
    twitter?: string;
  };
  /** Contact email */
  contactEmail?: string;
  /** Hero image URL */
  heroImageUrl?: string;
  /** Logo URL */
  logoUrl?: string;
}

export interface ScaffoldOutput {
  files: Array<{ path: string; content: string }>;
  framework: 'nextjs';
  buildCommand: string;
  outputDirectory: string;
}

// ─── ScaffoldGenerator ──────────────────────────────────────────────────────

export class ScaffoldGenerator {
  /**
   * Generate a complete scaffold for the given type and brand theme.
   */
  generate(type: ScaffoldType, theme: BrandTheme): ScaffoldOutput {
    const files: Array<{ path: string; content: string }> = [];

    // Common files for all scaffolds
    files.push(...this.generateCommonFiles(theme));

    // Type-specific pages
    switch (type) {
      case 'ecommerce':
        files.push(...this.generateEcommercePages(theme));
        break;
      case 'service':
        files.push(...this.generateServicePages(theme));
        break;
      case 'content':
        files.push(...this.generateContentPages(theme));
        break;
      case 'personal-brand':
        files.push(...this.generatePersonalBrandPages(theme));
        break;
    }

    return {
      files,
      framework: 'nextjs',
      buildCommand: 'next build',
      outputDirectory: '.next',
    };
  }

  // ── Common Files ──

  private generateCommonFiles(theme: BrandTheme): Array<{ path: string; content: string }> {
    const files: Array<{ path: string; content: string }> = [
      { path: 'package.json', content: this.packageJson(theme) },
      { path: 'next.config.js', content: this.nextConfig() },
      { path: 'tailwind.config.js', content: this.tailwindConfig(theme) },
      { path: 'postcss.config.js', content: `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };` },
      { path: 'app/layout.tsx', content: this.rootLayout(theme) },
      { path: 'app/globals.css', content: this.globalCss(theme) },
      // Layout components
      ...Object.entries(this.generateLayoutComponents({
        primary: theme.colorPrimary,
        secondary: theme.colorSecondary,
        accent: theme.colorSecondary,
        background: '#ffffff',
        text: '#000000',
      })).map(([path, content]) => ({ path, content })),
      // UI components
      ...Object.entries(this.generateUIComponents()).map(([path, content]) => ({ path, content })),
      // Ecommerce components
      ...Object.entries(this.generateEcommerceComponents()).map(([path, content]) => ({ path, content })),
      // Content components
      ...Object.entries(this.generateContentComponents()).map(([path, content]) => ({ path, content })),
      // Analytics components
      ...Object.entries(this.generateAnalyticsComponents()).map(([path, content]) => ({ path, content })),
      // Checkout API routes
      ...Object.entries(this.generateCheckoutAPI()).map(([path, content]) => ({ path, content })),
      // SEO templates
      ...Object.entries(this.generateSEOTemplates()).map(([path, content]) => ({ path, content })),
      // Tracking library
      { path: 'lib/tracking.ts', content: this.generateTrackingLibrary() },
      // Metadata helper
      { path: 'lib/metadata.ts', content: this.generateMetadataHelper() },
    ];
    return files;
  }

  private packageJson(theme: BrandTheme): string {
    return JSON.stringify({
      name: theme.businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      version: '1.0.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
      },
      dependencies: {
        next: '^14.2.0',
        react: '^18.3.0',
        'react-dom': '^18.3.0',
      },
      devDependencies: {
        '@types/node': '^20',
        '@types/react': '^18',
        typescript: '^5',
        tailwindcss: '^3.4',
        autoprefixer: '^10',
        postcss: '^8',
      },
    }, null, 2);
  }

  private nextConfig(): string {
    return `/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
};
module.exports = nextConfig;
`;
  }

  private tailwindConfig(theme: BrandTheme): string {
    return `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '${theme.colorPrimary}',
          secondary: '${theme.colorSecondary}',
          neutral: '${theme.colorNeutral}',
        },
      },
      fontFamily: {
        heading: ['${theme.fontHeading}', 'sans-serif'],
        body: ['${theme.fontBody}', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
`;
  }

  private rootLayout(theme: BrandTheme): string {
    const gfonts = [theme.fontHeading, theme.fontBody]
      .filter((f, i, a) => a.indexOf(f) === i) // dedupe
      .map(f => f.replace(/\s+/g, '+'))
      .join('&family=');

    return `import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '${this.escapeStr(theme.businessName)}',
  description: '${this.escapeStr(theme.tagline)}',
  openGraph: {
    title: '${this.escapeStr(theme.businessName)}',
    description: '${this.escapeStr(theme.description)}',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=${gfonts}&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body bg-white text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
`;
  }

  private globalCss(theme: BrandTheme): string {
    return `@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --color-primary: ${theme.colorPrimary};
  --color-secondary: ${theme.colorSecondary};
  --color-neutral: ${theme.colorNeutral};
}

body {
  font-family: '${theme.fontBody}', sans-serif;
}

h1, h2, h3, h4, h5, h6 {
  font-family: '${theme.fontHeading}', sans-serif;
}
`;
  }

  // ── Ecommerce Scaffold ──

  private generateEcommercePages(theme: BrandTheme): Array<{ path: string; content: string }> {
    const products = theme.products ?? [];
    const productCards = products.map(p => `
          <div key="${this.escapeStr(p.name)}" className="border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            ${p.imageUrl ? `<img src="${p.imageUrl}" alt="${this.escapeStr(p.name)}" className="w-full h-64 object-cover" />` : '<div className="w-full h-64 bg-brand-neutral/10" />'}
            <div className="p-6">
              <h3 className="font-heading text-xl font-bold">${this.escapeStr(p.name)}</h3>
              <p className="text-gray-600 mt-2">${this.escapeStr(p.description)}</p>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-2xl font-bold text-brand-primary">$${(p.priceCents / 100).toFixed(2)}</span>
                ${p.paymentLink ? `<a href="${p.paymentLink}" className="bg-brand-primary text-white px-6 py-2 rounded-full hover:opacity-90 transition-opacity">Buy Now</a>` : ''}
              </div>
            </div>
          </div>`).join('\n');

    const homePage = `export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="bg-brand-primary text-white py-20 px-6">
        <div className="max-w-6xl mx-auto text-center">
          ${theme.logoUrl ? `<img src="${theme.logoUrl}" alt="${this.escapeStr(theme.businessName)}" className="h-16 mx-auto mb-8" />` : ''}
          <h1 className="font-heading text-5xl font-bold mb-4">${this.escapeStr(theme.businessName)}</h1>
          <p className="text-xl opacity-90 max-w-2xl mx-auto">${this.escapeStr(theme.tagline)}</p>
          <a href="#products" className="inline-block mt-8 bg-white text-brand-primary px-8 py-3 rounded-full font-bold hover:opacity-90 transition-opacity">
            Shop Now
          </a>
        </div>
      </section>

      {/* Products */}
      <section id="products" className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-heading text-3xl font-bold text-center mb-12">Our Products</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            ${productCards || '<p className="text-center text-gray-500 col-span-3">Products coming soon!</p>'}
          </div>
        </div>
      </section>

      {/* About */}
      <section className="bg-gray-50 py-16 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-heading text-3xl font-bold mb-6">About Us</h2>
          <p className="text-lg text-gray-700">${this.escapeStr(theme.description)}</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12 px-6">
        <div className="max-w-6xl mx-auto text-center">
          <p className="font-heading text-xl font-bold">${this.escapeStr(theme.businessName)}</p>
          ${theme.contactEmail ? `<p className="mt-2 text-gray-400">${theme.contactEmail}</p>` : ''}
          ${this.socialLinksHtml(theme)}
          <p className="mt-8 text-gray-500 text-sm">&copy; ${new Date().getFullYear()} ${this.escapeStr(theme.businessName)}. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
`;

    return [{ path: 'app/page.tsx', content: homePage }];
  }

  // ── Service Scaffold ──

  private generateServicePages(theme: BrandTheme): Array<{ path: string; content: string }> {
    const services = theme.services ?? [];
    const serviceCards = services.map(s => `
          <div className="bg-white rounded-lg shadow-sm p-8 border hover:shadow-md transition-shadow">
            <h3 className="font-heading text-xl font-bold mb-3">${this.escapeStr(s.name)}</h3>
            <p className="text-gray-600 mb-4">${this.escapeStr(s.description)}</p>
            ${s.price ? `<p className="text-brand-primary font-bold text-lg">${this.escapeStr(s.price)}</p>` : ''}
          </div>`).join('\n');

    const homePage = `export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="relative bg-brand-primary text-white py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <h1 className="font-heading text-5xl font-bold mb-6">${this.escapeStr(theme.businessName)}</h1>
          <p className="text-xl opacity-90 max-w-2xl mb-8">${this.escapeStr(theme.tagline)}</p>
          <a href="#contact" className="inline-block bg-white text-brand-primary px-8 py-3 rounded-full font-bold hover:opacity-90 transition-opacity">
            Get Started
          </a>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="font-heading text-3xl font-bold text-center mb-12">Our Services</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            ${serviceCards || '<p className="text-center text-gray-500 col-span-3">Services coming soon!</p>'}
          </div>
        </div>
      </section>

      {/* About */}
      <section className="bg-gray-50 py-16 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-heading text-3xl font-bold mb-6">Why Choose Us</h2>
          <p className="text-lg text-gray-700">${this.escapeStr(theme.description)}</p>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="py-16 px-6">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="font-heading text-3xl font-bold mb-6">Get In Touch</h2>
          ${theme.contactEmail ? `<a href="mailto:${theme.contactEmail}" className="inline-block bg-brand-primary text-white px-8 py-3 rounded-full font-bold hover:opacity-90 transition-opacity">${theme.contactEmail}</a>` : '<p className="text-gray-500">Contact form coming soon!</p>'}
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12 px-6">
        <div className="max-w-6xl mx-auto text-center">
          <p className="font-heading text-xl font-bold">${this.escapeStr(theme.businessName)}</p>
          ${this.socialLinksHtml(theme)}
          <p className="mt-8 text-gray-500 text-sm">&copy; ${new Date().getFullYear()} ${this.escapeStr(theme.businessName)}. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
`;

    return [{ path: 'app/page.tsx', content: homePage }];
  }

  // ── Content Scaffold ──

  private generateContentPages(theme: BrandTheme): Array<{ path: string; content: string }> {
    const homePage = `export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="py-24 px-6 text-center">
        <div className="max-w-4xl mx-auto">
          <h1 className="font-heading text-5xl font-bold mb-4 text-brand-primary">${this.escapeStr(theme.businessName)}</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">${this.escapeStr(theme.tagline)}</p>
        </div>
      </section>

      {/* Newsletter */}
      <section className="bg-brand-primary text-white py-16 px-6">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="font-heading text-3xl font-bold mb-4">Stay Updated</h2>
          <p className="opacity-90 mb-8">Get the latest content delivered to your inbox.</p>
          <form className="flex gap-2 max-w-md mx-auto" action="#" method="POST">
            <input type="email" placeholder="Your email" className="flex-1 px-4 py-3 rounded-full text-gray-900" required />
            <button type="submit" className="bg-white text-brand-primary px-6 py-3 rounded-full font-bold hover:opacity-90 transition-opacity">
              Subscribe
            </button>
          </form>
        </div>
      </section>

      {/* Latest Posts Placeholder */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-heading text-3xl font-bold mb-12 text-center">Latest Posts</h2>
          <p className="text-center text-gray-500">Content coming soon! Check back for new posts.</p>
        </div>
      </section>

      {/* About */}
      <section className="bg-gray-50 py-16 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-heading text-3xl font-bold mb-6">About</h2>
          <p className="text-lg text-gray-700">${this.escapeStr(theme.description)}</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12 px-6">
        <div className="max-w-6xl mx-auto text-center">
          <p className="font-heading text-xl font-bold">${this.escapeStr(theme.businessName)}</p>
          ${this.socialLinksHtml(theme)}
          <p className="mt-8 text-gray-500 text-sm">&copy; ${new Date().getFullYear()} ${this.escapeStr(theme.businessName)}. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
`;

    return [{ path: 'app/page.tsx', content: homePage }];
  }

  // ── Personal Brand Scaffold ──

  private generatePersonalBrandPages(theme: BrandTheme): Array<{ path: string; content: string }> {
    const homePage = `export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-3xl text-center">
          ${theme.logoUrl ? `<img src="${theme.logoUrl}" alt="${this.escapeStr(theme.businessName)}" className="h-24 mx-auto mb-8 rounded-full" />` : ''}
          <h1 className="font-heading text-6xl font-bold mb-4">${this.escapeStr(theme.businessName)}</h1>
          <p className="text-xl text-gray-600 mb-8">${this.escapeStr(theme.tagline)}</p>
          <div className="flex gap-4 justify-center flex-wrap">
            <a href="#about" className="bg-brand-primary text-white px-8 py-3 rounded-full font-bold hover:opacity-90 transition-opacity">About Me</a>
            ${theme.contactEmail ? `<a href="mailto:${theme.contactEmail}" className="border-2 border-brand-primary text-brand-primary px-8 py-3 rounded-full font-bold hover:bg-brand-primary hover:text-white transition-colors">Contact</a>` : ''}
          </div>
          ${this.socialLinksHtml(theme)}
        </div>
      </section>

      {/* About */}
      <section id="about" className="py-16 px-6 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-heading text-3xl font-bold mb-6">About</h2>
          <p className="text-lg text-gray-700 leading-relaxed">${this.escapeStr(theme.description)}</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 text-center text-gray-500 text-sm">
        <p>&copy; ${new Date().getFullYear()} ${this.escapeStr(theme.businessName)}. All rights reserved.</p>
      </footer>
    </main>
  );
}
`;

    return [{ path: 'app/page.tsx', content: homePage }];
  }

  // ── Task 5.1: Layout Components ──

  private generateLayoutComponents(brandColors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  }): Record<string, string> {
    return {
      'components/layout/Header.tsx': `'use client';\n\nimport { useState } from 'react';\n\ninterface HeaderProps {\n  businessName: string;\n  logoUrl?: string;\n  navItems?: Array<{ label: string; href: string }>;\n}\n\nexport function Header({ businessName, logoUrl, navItems = [] }: HeaderProps) {\n  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);\n\n  return (\n    <header className="bg-white shadow-sm sticky top-0 z-40">\n      <nav className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">\n        <div className="flex items-center gap-3">\n          {logoUrl && <img src={logoUrl} alt={businessName} className="h-8" />}\n          <span className="font-heading text-xl font-bold">{businessName}</span>\n        </div>\n\n        {/* Desktop Nav */}\n        <div className="hidden md:flex gap-8">\n          {navItems.map((item) => (\n            <a\n              key={item.href}\n              href={item.href}\n              className="text-gray-700 hover:text-brand-primary transition-colors"\n            >\n              {item.label}\n            </a>\n          ))}\n        </div>\n\n        {/* Mobile Menu Toggle */}\n        <button\n          className="md:hidden p-2 hover:bg-gray-100 rounded"\n          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}\n          aria-label="Toggle mobile menu"\n        >\n          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">\n            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />\n          </svg>\n        </button>\n\n        {/* Cart Icon */}\n        <a href="/cart" className="hidden md:block p-2 hover:bg-gray-100 rounded" aria-label="Shopping cart">\n          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">\n            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2 9m10 0l2-9m-12 9h14" />\n          </svg>\n        </a>\n      </nav>\n\n      {/* Mobile Menu */}\n      {mobileMenuOpen && (\n        <MobileMenu items={navItems} onClose={() => setMobileMenuOpen(false)} />\n      )}\n    </header>\n  );\n}\n`,
      'components/layout/MobileMenu.tsx': `'use client';\n\ninterface MobileMenuProps {\n  items: Array<{ label: string; href: string }>;\n  onClose: () => void;\n}\n\nexport function MobileMenu({ items, onClose }: MobileMenuProps) {\n  return (\n    <div\n      className="fixed inset-0 bg-black/50 z-40 md:hidden"\n      onClick={onClose}\n      aria-label="Mobile menu overlay"\n    >\n      <div\n        className="absolute left-0 top-0 bottom-0 w-64 bg-white shadow-lg"\n        onClick={(e) => e.stopPropagation()}\n      >\n        <div className="p-4 space-y-2">\n          {items.map((item) => (\n            <a\n              key={item.href}\n              href={item.href}\n              className="block px-4 py-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"\n              onClick={onClose}\n            >\n              {item.label}\n            </a>\n          ))}\n          <a\n            href="/cart"\n            className="block px-4 py-2 text-gray-700 hover:bg-gray-100 rounded transition-colors"\n            onClick={onClose}\n          >\n            Cart\n          </a>\n        </div>\n      </div>\n    </div>\n  );\n}\n`,
      'components/layout/Footer.tsx': `interface FooterProps {\n  businessName: string;\n  contactEmail?: string;\n  socialLinks?: {\n    instagram?: string;\n    tiktok?: string;\n    facebook?: string;\n    twitter?: string;\n  };\n  links?: Array<{ label: string; href: string }>;\n}\n\nexport function Footer({ businessName, contactEmail, socialLinks, links = [] }: FooterProps) {\n  return (\n    <footer className="bg-gray-900 text-white py-12 px-6">\n      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">\n        {/* Brand Section */}\n        <div>\n          <p className="font-heading text-lg font-bold mb-2">{businessName}</p>\n          {contactEmail && (\n            <a href={\`mailto:\${contactEmail}\`} className="text-gray-400 hover:text-white transition-colors">\n              {contactEmail}\n            </a>\n          )}\n        </div>\n\n        {/* Links Section */}\n        {links.length > 0 && (\n          <div>\n            <h3 className="font-bold mb-4">Links</h3>\n            <ul className="space-y-2">\n              {links.map((link) => (\n                <li key={link.href}>\n                  <a href={link.href} className="text-gray-400 hover:text-white transition-colors">\n                    {link.label}\n                  </a>\n                </li>\n              ))}\n            </ul>\n          </div>\n        )}\n\n        {/* Social Links */}\n        {socialLinks && Object.values(socialLinks).some(Boolean) && (\n          <div>\n            <h3 className="font-bold mb-4">Follow</h3>\n            <div className="flex gap-4">\n              {socialLinks.instagram && (\n                <a href={socialLinks.instagram} aria-label="Instagram" className="hover:opacity-80 transition-opacity">\n                  Instagram\n                </a>\n              )}\n              {socialLinks.tiktok && (\n                <a href={socialLinks.tiktok} aria-label="TikTok" className="hover:opacity-80 transition-opacity">\n                  TikTok\n                </a>\n              )}\n              {socialLinks.facebook && (\n                <a href={socialLinks.facebook} aria-label="Facebook" className="hover:opacity-80 transition-opacity">\n                  Facebook\n                </a>\n              )}\n              {socialLinks.twitter && (\n                <a href={socialLinks.twitter} aria-label="Twitter" className="hover:opacity-80 transition-opacity">\n                  Twitter\n                </a>\n              )}\n            </div>\n          </div>\n        )}\n      </div>\n\n      {/* Copyright */}\n      <div className="border-t border-gray-800 pt-8 text-center text-gray-500 text-sm">\n        <p>&copy; {new Date().getFullYear()} {businessName}. All rights reserved.</p>\n      </div>\n    </footer>\n  );\n}\n`,
    };
  }

  // ── Task 5.1: UI Components ──

  private generateUIComponents(): Record<string, string> {
    return {
      'components/ui/Button.tsx': `interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {\n  variant?: 'primary' | 'secondary' | 'outline';\n  size?: 'sm' | 'md' | 'lg';\n  children: React.ReactNode;\n}\n\nexport function Button({\n  variant = 'primary',\n  size = 'md',\n  className = '',\n  ...props\n}: ButtonProps) {\n  const baseClass = 'font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';\n\n  const variantClass = {\n    primary: 'bg-brand-primary text-white hover:opacity-90 focus:ring-brand-primary',\n    secondary: 'bg-brand-secondary text-white hover:opacity-90 focus:ring-brand-secondary',\n    outline: 'border-2 border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white focus:ring-brand-primary',\n  }[variant];\n\n  const sizeClass = {\n    sm: 'px-3 py-1 text-sm',\n    md: 'px-4 py-2 text-base',\n    lg: 'px-6 py-3 text-lg',\n  }[size];\n\n  return (\n    <button className={[baseClass, variantClass, sizeClass, className].filter(Boolean).join(' ')} {...props} />\n  );\n}\n`,
      'components/ui/Input.tsx': `interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {\n  label?: string;\n  error?: string;\n  helperText?: string;\n}\n\nexport function Input({ label, error, helperText, className = '', ...props }: InputProps) {\n  return (\n    <div className="w-full">\n      {label && (\n        <label className="block text-sm font-medium text-gray-700 mb-1">\n          {label}\n        </label>\n      )}\n      <input\n        className={[\n          'w-full px-4 py-2 border rounded-lg font-body',\n          'focus:outline-none focus:ring-2 focus:ring-brand-primary focus:border-transparent',\n          error ? 'border-red-500' : 'border-gray-300',\n          className,\n        ].join(' ')}\n        {...props}\n      />\n      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}\n      {helperText && <p className="text-gray-500 text-sm mt-1">{helperText}</p>}\n    </div>\n  );\n}\n`,
      'components/ui/Card.tsx': `interface CardProps {\n  image?: string;\n  title: string;\n  description: string;\n  action?: { label: string; href: string };\n  children?: React.ReactNode;\n}\n\nexport function Card({ image, title, description, action, children }: CardProps) {\n  return (\n    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">\n      {image && <img src={image} alt={title} className="w-full h-48 object-cover" />}\n      <div className="p-6">\n        <h3 className="font-heading text-xl font-bold mb-2">{title}</h3>\n        <p className="text-gray-600 mb-4">{description}</p>\n        {children}\n        {action && (\n          <a\n            href={action.href}\n            className="inline-block mt-4 text-brand-primary hover:text-brand-primary/80 font-medium transition-colors"\n          >\n            {action.label}\n          </a>\n        )}\n      </div>\n    </div>\n  );\n}\n`,
      'components/ui/Modal.tsx': `interface ModalProps {\n  isOpen: boolean;\n  onClose: () => void;\n  title?: string;\n  children: React.ReactNode;\n}\n\nexport function Modal({ isOpen, onClose, title, children }: ModalProps) {\n  if (!isOpen) return null;\n\n  return (\n    <div\n      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"\n      onClick={onClose}\n      role="dialog"\n      aria-modal="true"\n      aria-labelledby={title ? 'modal-title' : undefined}\n    >\n      <div\n        className="bg-white rounded-lg shadow-xl max-w-md w-full"\n        onClick={(e) => e.stopPropagation()}\n      >\n        <div className="flex items-center justify-between p-6 border-b">\n          {title && <h2 id="modal-title" className="font-heading text-xl font-bold">{title}</h2>}\n          <button\n            onClick={onClose}\n            className="text-gray-400 hover:text-gray-600 transition-colors"\n            aria-label="Close modal"\n          >\n            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">\n              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />\n            </svg>\n          </button>\n        </div>\n        <div className="p-6">{children}</div>\n      </div>\n    </div>\n  );\n}\n`,
      'components/ui/Toast.tsx': `interface ToastProps {\n  type: 'success' | 'error' | 'info';\n  message: string;\n  onClose: () => void;\n}\n\nexport function Toast({ type, message, onClose }: ToastProps) {\n  const baseClass = 'fixed bottom-4 right-4 rounded-lg shadow-lg p-4 max-w-sm';\n\n  const typeClass = {\n    success: 'bg-green-50 text-green-900 border border-green-200',\n    error: 'bg-red-50 text-red-900 border border-red-200',\n    info: 'bg-blue-50 text-blue-900 border border-blue-200',\n  }[type];\n\n  return (\n    <div className={[baseClass, typeClass].join(' ')} role="alert">\n      <div className="flex items-start justify-between">\n        <p className="text-sm font-medium">{message}</p>\n        <button\n          onClick={onClose}\n          className="text-current hover:opacity-70 transition-opacity ml-2"\n          aria-label="Close notification"\n        >\n          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">\n            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />\n          </svg>\n        </button>\n      </div>\n    </div>\n  );\n}\n`,
    };
  }

  // ── Task 5.1: Ecommerce Components ──

  private generateEcommerceComponents(): Record<string, string> {
    return {
      'components/ecommerce/ProductCard.tsx': `interface ProductCardProps {\n  id: string;\n  name: string;\n  price: number;\n  image?: string;\n  onAddToCart: (productId: string, quantity: number) => void;\n}\n\nexport function ProductCard({ id, name, price, image, onAddToCart }: ProductCardProps) {\n  return (\n    <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">\n      {image && <img src={image} alt={name} className="w-full h-48 object-cover" />}\n      <div className="p-4">\n        <h3 className="font-heading text-lg font-bold mb-2">{name}</h3>\n        <p className="text-2xl font-bold text-brand-primary mb-4">\n          \$\${(price / 100).toFixed(2)}\n        </p>\n        <button\n          onClick={() => onAddToCart(id, 1)}\n          className="w-full bg-brand-primary text-white py-2 rounded-lg hover:opacity-90 transition-opacity"\n          aria-label={"Add " + name + " to cart"}\n        >\n          Add to Cart\n        </button>\n      </div>\n    </div>\n  );\n}\n`,
      'components/ecommerce/ProductGallery.tsx': `'use client';\n\nimport { useState } from 'react';\n\ninterface ProductGalleryProps {\n  images: string[];\n  productName: string;\n}\n\nexport function ProductGallery({ images, productName }: ProductGalleryProps) {\n  const [selectedIndex, setSelectedIndex] = useState(0);\n\n  if (!images.length) return <div className="w-full h-96 bg-gray-200 rounded" />;\n\n  return (\n    <div className="space-y-4">\n      <img\n        src={images[selectedIndex]}\n        alt={productName}\n        className="w-full rounded-lg"\n      />\n      {images.length > 1 && (\n        <div className="flex gap-2">\n          {images.map((image, index) => (\n            <button\n              key={index}\n              onClick={() => setSelectedIndex(index)}\n              className={[\n                'w-20 h-20 rounded border-2 overflow-hidden transition-colors',\n                index === selectedIndex ? 'border-brand-primary' : 'border-gray-300'\n              ].join(' ')}\n              aria-label={"View image " + (index + 1)}\n            >\n              <img src={image} alt="" className="w-full h-full object-cover" />\n            </button>\n          ))}\n        </div>\n      )}\n    </div>\n  );\n}\n`,
      'components/ecommerce/CartDrawer.tsx': `'use client';\n\ninterface CartItem {\n  id: string;\n  name: string;\n  price: number;\n  quantity: number;\n}\n\ninterface CartDrawerProps {\n  isOpen: boolean;\n  items: CartItem[];\n  onClose: () => void;\n  onCheckout: () => void;\n}\n\nexport function CartDrawer({ isOpen, items, onClose, onCheckout }: CartDrawerProps) {\n  if (!isOpen) return null;\n\n  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);\n\n  return (\n    <div className="fixed inset-0 z-40">\n      <div\n        className="fixed inset-0 bg-black/50"\n        onClick={onClose}\n        aria-label="Close cart"\n      />\n      <div className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-white shadow-lg overflow-y-auto">\n        <div className="p-6 border-b flex items-center justify-between">\n          <h2 className="font-heading text-xl font-bold">Cart</h2>\n          <button onClick={onClose} aria-label="Close cart">\n            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">\n              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />\n            </svg>\n          </button>\n        </div>\n\n        <div className="p-6 space-y-4">\n          {items.length === 0 ? (\n            <p className="text-gray-500 text-center py-8">Your cart is empty</p>\n          ) : (\n            <>\n              {items.map((item) => (\n                <div key={item.id} className="flex justify-between border-b pb-4">\n                  <div>\n                    <p className="font-medium">{item.name}</p>\n                    <p className="text-sm text-gray-600">{"Qty: " + item.quantity}</p>\n                  </div>\n                  <p className="font-bold">\$\${((item.price * item.quantity) / 100).toFixed(2)}</p>\n                </div>\n              ))}\n              <div className="flex justify-between text-lg font-bold py-4 border-t">\n                <span>Total:</span>\n                <span>\$\${(total / 100).toFixed(2)}</span>\n              </div>\n              <button\n                onClick={onCheckout}\n                className="w-full bg-brand-primary text-white py-3 rounded-lg hover:opacity-90 transition-opacity font-medium"\n              >\n                Checkout\n              </button>\n            </>\n          )}\n        </div>\n      </div>\n    </div>\n  );\n}\n`,
      'components/ecommerce/CheckoutButton.tsx': `interface CheckoutButtonProps {\n  sessionId: string;\n  children?: React.ReactNode;\n  onError?: (error: string) => void;\n}\n\nexport function CheckoutButton({ sessionId, children = 'Checkout', onError }: CheckoutButtonProps) {\n  const handleCheckout = async () => {\n    try {\n      const response = await fetch('/api/checkout', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({\n          lineItems: [{ price: sessionId, quantity: 1 }],\n        }),\n      });\n\n      if (!response.ok) {\n        throw new Error('Checkout failed');\n      }\n\n      const data = await response.json() as { url?: string };\n      if (data.url) {\n        window.location.href = data.url;\n      }\n    } catch (error) {\n      onError?.(error instanceof Error ? error.message : 'Unknown error');\n    }\n  };\n\n  return (\n    <button\n      onClick={handleCheckout}\n      className="bg-brand-primary text-white px-6 py-3 rounded-lg hover:opacity-90 transition-opacity"\n      aria-label="Proceed to checkout"\n    >\n      {children}\n    </button>\n  );\n}\n`,
      'components/ecommerce/PriceDisplay.tsx': `interface PriceDisplayProps {\n  priceCents: number;\n  currency?: string;\n  originalPrice?: number;\n  showDiscount?: boolean;\n}\n\nexport function PriceDisplay({\n  priceCents,\n  currency = 'USD',\n  originalPrice,\n  showDiscount = false,\n}: PriceDisplayProps) {\n  const displayPrice = (priceCents / 100).toFixed(2);\n  const discount = originalPrice\n    ? Math.round(((originalPrice - priceCents) / originalPrice) * 100)\n    : 0;\n\n  return (\n    <div className="space-y-2">\n      <div className="flex items-center gap-2">\n        <span className="text-2xl font-bold text-brand-primary">\n          {new Intl.NumberFormat('en-US', {\n            style: 'currency',\n            currency,\n          }).format(priceCents / 100)}\n        </span>\n        {originalPrice && (\n          <span className="text-lg text-gray-400 line-through">\n            {new Intl.NumberFormat('en-US', {\n              style: 'currency',\n              currency,\n            }).format(originalPrice / 100)}\n          </span>\n        )}\n      </div>\n      {showDiscount && discount > 0 && (\n        <p className="text-green-600 font-medium">{"Save " + discount + "%"}</p>\n      )}\n    </div>\n  );\n}\n`,
    };
  }

  // ── Task 5.1: Content Components ──

  private generateContentComponents(): Record<string, string> {
    return {
      'components/content/HeroSection.tsx': `interface HeroSectionProps {\n  title: string;\n  subtitle: string;\n  ctaText?: string;\n  ctaHref?: string;\n  backgroundImage?: string;\n}\n\nexport function HeroSection({\n  title,\n  subtitle,\n  ctaText = 'Get Started',\n  ctaHref = '#',\n  backgroundImage,\n}: HeroSectionProps) {\n  return (\n    <section\n      className="relative min-h-screen flex items-center justify-center px-6 py-20"\n      style={backgroundImage ? { backgroundImage: \`url(\${backgroundImage})\`, backgroundSize: 'cover' } : {}}\n    >\n      {backgroundImage && <div className="absolute inset-0 bg-black/40" />}\n      <div className="relative z-10 text-center max-w-3xl mx-auto">\n        <h1 className="font-heading text-5xl md:text-6xl font-bold mb-6 text-white">\n          {title}\n        </h1>\n        <p className="text-xl md:text-2xl text-white/90 mb-8">\n          {subtitle}\n        </p>\n        <a\n          href={ctaHref}\n          className="inline-block bg-brand-primary text-white px-8 py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"\n        >\n          {ctaText}\n        </a>\n      </div>\n    </section>\n  );\n}\n`,
      'components/content/FeatureGrid.tsx': `interface Feature {\n  title: string;\n  description: string;\n  icon?: string;\n}\n\ninterface FeatureGridProps {\n  features: Feature[];\n}\n\nexport function FeatureGrid({ features }: FeatureGridProps) {\n  return (\n    <section className="py-20 px-6">\n      <div className="max-w-6xl mx-auto">\n        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">\n          {features.map((feature, index) => (\n            <div key={index} className="bg-white rounded-lg shadow-md p-8 hover:shadow-lg transition-shadow">\n              {feature.icon && (\n                <img src={feature.icon} alt="" className="w-12 h-12 mb-4" />\n              )}\n              <h3 className="font-heading text-xl font-bold mb-2">{feature.title}</h3>\n              <p className="text-gray-600">{feature.description}</p>\n            </div>\n          ))}\n        </div>\n      </div>\n    </section>\n  );\n}\n`,
      'components/content/Testimonials.tsx': `'use client';\n\nimport { useState } from 'react';\n\ninterface Testimonial {\n  author: string;\n  text: string;\n  role?: string;\n  image?: string;\n}\n\ninterface TestimonialsProps {\n  testimonials: Testimonial[];\n}\n\nexport function Testimonials({ testimonials }: TestimonialsProps) {\n  const [current, setCurrent] = useState(0);\n\n  const testimonial = testimonials[current];\n\n  return (\n    <section className="bg-gray-50 py-20 px-6">\n      <div className="max-w-2xl mx-auto text-center">\n        <h2 className="font-heading text-3xl font-bold mb-12">What Our Customers Say</h2>\n        {testimonial && (\n          <div className="bg-white rounded-lg shadow-md p-8">\n            <p className="text-lg text-gray-700 mb-6">"{ testimonial.text}"</p>\n            <div className="flex items-center justify-center gap-4">\n              {testimonial.image && (\n                <img src={testimonial.image} alt={testimonial.author} className="w-12 h-12 rounded-full" />\n              )}\n              <div>\n                <p className="font-bold">{testimonial.author}</p>\n                {testimonial.role && <p className="text-gray-600 text-sm">{testimonial.role}</p>}\n              </div>\n            </div>\n            {testimonials.length > 1 && (\n              <div className="flex gap-2 justify-center mt-6">\n                {testimonials.map((_, index) => (\n                  <button\n                    key={index}\n                    onClick={() => setCurrent(index)}\n                    className={[\n                      'w-2 h-2 rounded-full transition-colors',\n                      index === current ? 'bg-brand-primary' : 'bg-gray-300'\n                    ].join(' ')}\n                    aria-label={"Go to testimonial " + (index + 1)}\n                  />\n                ))}\n              </div>\n            )}\n          </div>\n        )}\n      </div>\n    </section>\n  );\n}\n`,
      'components/content/FAQ.tsx': `'use client';\n\nimport { useState } from 'react';\n\ninterface FAQItem {\n  question: string;\n  answer: string;\n}\n\ninterface FAQProps {\n  items: FAQItem[];\n}\n\nexport function FAQ({ items }: FAQProps) {\n  const [openIndex, setOpenIndex] = useState<number | null>(null);\n\n  return (\n    <section className="py-20 px-6">\n      <div className="max-w-2xl mx-auto">\n        <h2 className="font-heading text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>\n        <div className="space-y-4">\n          {items.map((item, index) => (\n            <div key={index} className="border rounded-lg">\n              <button\n                onClick={() => setOpenIndex(openIndex === index ? null : index)}\n                className="w-full px-6 py-4 text-left font-medium flex items-center justify-between hover:bg-gray-50 transition-colors"\n                aria-expanded={openIndex === index}\n                aria-label={item.question}\n              >\n                {item.question}\n                <svg\n                  className={["w-5 h-5 transition-transform", openIndex === index ? "rotate-180" : ""].join(" ")}\n                  fill="none"\n                  stroke="currentColor"\n                  viewBox="0 0 24 24"\n                >\n                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />\n                </svg>\n              </button>\n              {openIndex === index && (\n                <div className="px-6 py-4 bg-gray-50 border-t text-gray-700">\n                  {item.answer}\n                </div>\n              )}\n            </div>\n          ))}\n        </div>\n      </div>\n    </section>\n  );\n}\n`,
      'components/content/Newsletter.tsx': `'use client';\n\nimport { useState } from 'react';\n\ninterface NewsletterProps {\n  heading?: string;\n  subheading?: string;\n  onSubscribe?: (email: string) => Promise<void>;\n}\n\nexport function Newsletter({\n  heading = 'Stay Updated',\n  subheading = 'Get the latest updates delivered to your inbox.',\n  onSubscribe,\n}: NewsletterProps) {\n  const [email, setEmail] = useState('');\n  const [loading, setLoading] = useState(false);\n  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);\n\n  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {\n    e.preventDefault();\n    if (!email || !onSubscribe) return;\n\n    setLoading(true);\n    try {\n      await onSubscribe(email);\n      setMessage({ type: 'success', text: 'Thanks for subscribing!' });\n      setEmail('');\n    } catch {\n      setMessage({ type: 'error', text: 'Failed to subscribe. Please try again.' });\n    } finally {\n      setLoading(false);\n    }\n  };\n\n  return (\n    <section className="bg-brand-primary text-white py-16 px-6">\n      <div className="max-w-xl mx-auto text-center">\n        <h2 className="font-heading text-3xl font-bold mb-2">{heading}</h2>\n        <p className="opacity-90 mb-8">{subheading}</p>\n        <form onSubmit={handleSubmit} className="flex gap-2 max-w-md mx-auto">\n          <input\n            type="email"\n            placeholder="Your email"\n            value={email}\n            onChange={(e) => setEmail(e.target.value)}\n            className="flex-1 px-4 py-3 rounded-lg text-gray-900 font-body"\n            required\n            disabled={loading}\n          />\n          <button\n            type="submit"\n            disabled={loading}\n            className="bg-white text-brand-primary px-6 py-3 rounded-lg font-bold hover:opacity-90 transition-opacity disabled:opacity-50"\n          >\n            {loading ? 'Subscribing...' : 'Subscribe'}\n          </button>\n        </form>\n        {message && (\n          <p className={["mt-4 text-sm", message.type === 'success' ? 'text-green-200' : 'text-red-200'].join(' ')}>\n            {message.text}\n          </p>\n        )}\n      </div>\n    </section>\n  );\n}\n`,
    };
  }

  // ── Task 5.2: Checkout API Routes ──

  private generateCheckoutAPI(): Record<string, string> {
    return {
      'app/api/checkout/route.ts': `import { NextRequest, NextResponse } from 'next/server';

const STRIPE_API = 'https://api.stripe.com/v1';

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { error: 'Stripe is not configured' },
        { status: 500 }
      );
    }

    const body = await request.json() as {
      lineItems?: Array<{ price: string; quantity: number }>;
      floorId?: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    const { lineItems = [], floorId, successUrl, cancelUrl } = body;

    if (!lineItems.length) {
      return NextResponse.json(
        { error: 'No items in cart' },
        { status: 400 }
      );
    }

    // Format line items for Stripe
    const formattedItems = lineItems
      .map((item, index) => ({
        [\`line_items[\${index}][price]\`]: item.price,
        [\`line_items[\${index}][quantity]\`]: String(item.quantity),
      }))
      .reduce((acc, curr) => ({ ...acc, ...curr }), {});

    const params = new URLSearchParams({
      ...formattedItems,
      success_url: successUrl || 'https://example.com/success',
      cancel_url: cancelUrl || 'https://example.com/cancel',
      ...(floorId && { 'metadata[floor_id]': floorId }),
    });

    const response = await fetch(\`\${STRIPE_API}/checkout/sessions\`, {
      method: 'POST',
      headers: {
        'Authorization': \`Bearer \${stripeKey}\`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Stripe checkout session error:', errorBody);
      return NextResponse.json(
        { error: 'Failed to create checkout session' },
        { status: response.status }
      );
    }

    const session = await response.json() as { url?: string };
    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error('Checkout API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
`,
      'app/api/webhooks/stripe/route.ts': `import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('stripe-signature');
    const body = await request.text();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      return NextResponse.json(
        { error: 'Missing signature or webhook secret' },
        { status: 400 }
      );
    }

    // Verify Stripe signature
    let event: { type: string; data: { object: { id: string; metadata?: { floor_id?: string } } } };
    try {
      const timestamp = signature.split(',')[0].split('=')[1];
      const hash = crypto
        .createHmac('sha256', webhookSecret)
        .update(\`\${timestamp}.\${body}\`, 'utf8')
        .digest('hex');

      const expectedSignature = signature.split('v1=')[1];
      if (hash !== expectedSignature) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }

      event = JSON.parse(body) as typeof event;
    } catch {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Handle checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const floorId = session.metadata?.floor_id;

      console.log('Checkout completed:', {
        sessionId: session.id,
        floorId,
        timestamp: new Date().toISOString(),
      });

      // TODO: Emit event or trigger post-purchase workflows
      // eventBus.emit('order:created', { ... })
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
`,
    };
  }

  // ── Task 5.3: Analytics Components ──

  private generateAnalyticsComponents(): Record<string, string> {
    return {
      'components/analytics/Analytics.tsx': `'use client';\n\nimport { useEffect } from 'react';\n\nexport function Analytics() {\n  useEffect(() => {\n    // Google Analytics 4\n    const GA_ID = process.env.NEXT_PUBLIC_GA_ID;\n    if (GA_ID) {\n      const script1 = document.createElement('script');\n      script1.async = true;\n      script1.src = \`https://www.googletagmanager.com/gtag/js?id=\${GA_ID}\`;\n      document.head.appendChild(script1);\n\n      const script2 = document.createElement('script');\n      script2.innerHTML = \`\n        window.dataLayer = window.dataLayer || [];\n        function gtag(){dataLayer.push(arguments);}\n        gtag('js', new Date());\n        gtag('config', '\${GA_ID}');\n      \`;\n      document.head.appendChild(script2);\n    }\n\n    // Meta Pixel\n    const FB_PIXEL_ID = process.env.NEXT_PUBLIC_FB_PIXEL_ID;\n    if (FB_PIXEL_ID) {\n      const script = document.createElement('script');\n      script.innerHTML = \`\n        !function(f,b,e,v,n,t,s)\n        {if(f.fbq)return;n=f.fbq=function(){n.callMethod?\n        n.callMethod.apply(n,arguments):n.queue.push(arguments)};\n        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';\n        n.queue=[];t=b.createElement(e);t.async=!0;\n        t.src=v;s=b.getElementsByTagName(e)[0];\n        s.parentNode.insertBefore(t,s)}(window, document,'script',\n        'https://connect.facebook.net/en_US/fbevents.js');\n        fbq('init', '\${FB_PIXEL_ID}');\n        fbq('track', 'PageView');\n      \`;\n      document.head.appendChild(script);\n    }\n\n    // Track initial pageview\n    trackPageView();\n  }, []);\n\n  return null;\n}\n\nexport function trackPageView() {\n  if (typeof window !== 'undefined' && (window as any).gtag) {\n    (window as any).gtag('event', 'page_view', {\n      page_path: window.location.pathname,\n      page_title: document.title,\n    });\n  }\n\n  if (typeof window !== 'undefined' && (window as any).fbq) {\n    (window as any).fbq('track', 'PageView');\n  }\n}\n\nexport function trackEvent(\n  eventName: string,\n  eventData: Record<string, unknown> = {}\n) {\n  const eventId = \`\${Date.now()}_\${Math.random().toString(36).substr(2, 9)}\`;\n\n  if (typeof window !== 'undefined' && (window as any).gtag) {\n    (window as any).gtag('event', eventName, {\n      ...eventData,\n      event_id: eventId,\n    });\n  }\n\n  if (typeof window !== 'undefined' && (window as any).fbq) {\n    (window as any).fbq('track', eventName, {\n      ...eventData,\n      event_id: eventId,\n    });\n  }\n}\n\nexport function trackAddToCart(productId: string, productName: string, price: number) {\n  trackEvent('add_to_cart', {\n    items: [{ item_id: productId, item_name: productName, price }],\n    value: price / 100,\n    currency: 'USD',\n  });\n}\n\nexport function trackInitiateCheckout(value: number, itemCount: number) {\n  trackEvent('begin_checkout', {\n    value: value / 100,\n    currency: 'USD',\n    items: itemCount,\n  });\n}\n\nexport function trackPurchase(orderId: string, value: number, items: Array<{ id: string; name: string; price: number; quantity: number }>) {\n  trackEvent('purchase', {\n    transaction_id: orderId,\n    value: value / 100,\n    currency: 'USD',\n    items: items.map(item => ({\n      item_id: item.id,\n      item_name: item.name,\n      price: item.price / 100,\n      quantity: item.quantity,\n    })),\n  });\n}\n`,
      'components/analytics/CookieConsent.tsx': `'use client';\n\nimport { useState, useEffect } from 'react';\n\ninterface CookieConsentProps {\n  onConsent?: (accepted: boolean) => void;\n}\n\nexport function CookieConsent({ onConsent }: CookieConsentProps) {\n  const [shown, setShown] = useState(false);\n  const [preferences, setPreferences] = useState({\n    analytics: false,\n    marketing: false,\n    essential: true,\n  });\n\n  useEffect(() => {\n    const consent = localStorage.getItem('cookie-consent');\n    if (!consent) {\n      setShown(true);\n    }\n  }, []);\n\n  const handleAccept = (analyticsOnly = false) => {\n    const consentData = {\n      essential: true,\n      analytics: analyticsOnly || preferences.analytics,\n      marketing: analyticsOnly ? false : preferences.marketing,\n      timestamp: new Date().toISOString(),\n    };\n\n    localStorage.setItem('cookie-consent', JSON.stringify(consentData));\n    setShown(false);\n    onConsent?.(true);\n  };\n\n  if (!shown) return null;\n\n  return (\n    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-lg p-4">\n      <div className="max-w-6xl mx-auto">\n        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">\n          <div className="flex-1">\n            <p className="font-medium mb-2">\n              We use cookies to enhance your experience and analyze site usage.\n            </p>\n            <p className="text-sm text-gray-600">\n              Essential cookies are always enabled. You can choose to allow analytics and marketing cookies.\n            </p>\n          </div>\n\n          <div className="flex flex-col sm:flex-row gap-3 whitespace-nowrap">\n            <button\n              onClick={() => setShown(false)}\n              className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"\n            >\n              Settings\n            </button>\n            <button\n              onClick={() => handleAccept(true)}\n              className="px-4 py-2 text-sm bg-gray-200 text-gray-900 hover:bg-gray-300 rounded transition-colors"\n            >\n              Analytics Only\n            </button>\n            <button\n              onClick={() => handleAccept()}\n              className="px-4 py-2 text-sm bg-brand-primary text-white hover:opacity-90 rounded transition-colors"\n            >\n              Accept All\n            </button>\n          </div>\n        </div>\n      </div>\n    </div>\n  );\n}\n`,
    };
  }

  private generateTrackingLibrary(): string {
    return `/**
 * Tracking utilities for GA4 and Meta Pixel
 * Used by components to track user events
 */

export function getEventId(): string {
  return \`\${Date.now()}_\${Math.random().toString(36).substr(2, 9)}\`;
}

export function captureUTM(): Record<string, string> {
  if (typeof window === 'undefined') return {};

  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get('utm_source') ?? '',
    utm_medium: params.get('utm_medium') ?? '',
    utm_campaign: params.get('utm_campaign') ?? '',
    utm_content: params.get('utm_content') ?? '',
    utm_term: params.get('utm_term') ?? '',
  };
}

export function trackPageView(options: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;

  const gtag = (window as any).gtag;
  const fbq = (window as any).fbq;

  if (gtag) {
    gtag('event', 'page_view', {
      page_path: window.location.pathname,
      page_title: document.title,
      ...options,
    });
  }

  if (fbq) {
    fbq('track', 'PageView', options);
  }
}

export function trackEvent(
  eventName: string,
  eventData: Record<string, unknown> = {}
) {
  if (typeof window === 'undefined') return;

  const eventId = getEventId();
  const gtag = (window as any).gtag;
  const fbq = (window as any).fbq;

  const dataWithId = {
    ...eventData,
    event_id: eventId,
  };

  if (gtag) {
    gtag('event', eventName, dataWithId);
  }

  if (fbq) {
    fbq('track', eventName, dataWithId);
  }
}

export function trackViewContent(
  contentId: string,
  contentName: string,
  value: number,
  currency = 'USD'
) {
  trackEvent('view_item', {
    items: [{ item_id: contentId, item_name: contentName }],
    value: value / 100,
    currency,
  });
}

export function trackAddToCart(
  productId: string,
  productName: string,
  price: number,
  quantity = 1
) {
  trackEvent('add_to_cart', {
    items: [
      {
        item_id: productId,
        item_name: productName,
        price: price / 100,
        quantity,
      },
    ],
    value: (price / 100) * quantity,
    currency: 'USD',
  });
}

export function trackInitiateCheckout(
  value: number,
  itemCount: number,
  items: Array<{ item_id: string; item_name: string; price: number }> = []
) {
  trackEvent('begin_checkout', {
    value: value / 100,
    currency: 'USD',
    items: items.length > 0 ? items : undefined,
    coupon: undefined,
  });
}

export function trackPurchase(
  transactionId: string,
  value: number,
  items: Array<{ item_id: string; item_name: string; price: number; quantity: number }>,
  tax: number = 0,
  shipping: number = 0
) {
  trackEvent('purchase', {
    transaction_id: transactionId,
    affiliation: undefined,
    value: value / 100,
    currency: 'USD',
    tax: tax / 100,
    shipping: shipping / 100,
    items: items.map(item => ({
      item_id: item.item_id,
      item_name: item.item_name,
      price: item.price / 100,
      quantity: item.quantity,
    })),
  });
}

export function trackAddPaymentInfo(
  value: number,
  paymentType: string = 'credit_card'
) {
  trackEvent('add_payment_info', {
    value: value / 100,
    currency: 'USD',
    payment_type: paymentType,
  });
}
`;
  }

  private generateMetadataHelper(): string {
    return `/**
 * Metadata helper for generating page meta tags and SEO
 */

export interface MetadataOptions {
  title: string;
  description: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article' | 'product';
  author?: string;
  publishedDate?: string;
  updatedDate?: string;
}

export function generateMetadata(options: MetadataOptions) {
  const {
    title,
    description,
    image,
    url = typeof window !== 'undefined' ? window.location.href : '',
    type = 'website',
    author,
    publishedDate,
    updatedDate,
  } = options;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type,
      url,
      images: image ? [{ url: image, width: 1200, height: 630 }] : [],
      ...(publishedDate && { publishedTime: publishedDate }),
      ...(updatedDate && { modifiedTime: updatedDate }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      image,
    },
  };
}

export function generateProductMetadata(
  productName: string,
  description: string,
  price: number,
  image?: string,
  url?: string
) {
  return generateMetadata({
    title: productName,
    description,
    image,
    url,
    type: 'product',
  });
}

export function generateArticleMetadata(
  title: string,
  description: string,
  author: string,
  image?: string,
  publishedDate?: string,
  updatedDate?: string,
  url?: string
) {
  return generateMetadata({
    title,
    description,
    image,
    url,
    type: 'article',
    author,
    publishedDate,
    updatedDate,
  });
}
`;
  }

  // ── Task 5.4: SEO Templates ──

  private generateSEOTemplates(): Record<string, string> {
    return {
      'app/sitemap.ts': `import type { MetadataRoute } from 'next';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://example.com';

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: \`\${baseUrl}/products\`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: \`\${baseUrl}/about\`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: \`\${baseUrl}/contact\`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
  ];

  // TODO: Add dynamic product pages
  // const products = await fetchProducts();
  // const productPages = products.map(product => ({
  //   url: \`\${baseUrl}/products/\${product.slug}\`,
  //   lastModified: product.updatedAt,
  //   changeFrequency: 'weekly' as const,
  //   priority: 0.8,
  // }));

  return staticPages;
}
`,
      'app/robots.ts': `import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://example.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api', '/.well-known'],
      },
    ],
    sitemap: \`\${baseUrl}/sitemap.xml\`,
  };
}
`,
      'components/seo/StructuredData.tsx': `interface OrganizationSchema {
  name: string;
  url: string;
  logo?: string;
  description?: string;
  contact?: string;
}

interface ProductSchema {
  name: string;
  description: string;
  image: string[];
  brand: string;
  price: number;
  currency: string;
  rating?: number;
  reviewCount?: number;
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder';
}

interface BreadcrumbSchema {
  items: Array<{ name: string; url: string }>;
}

export function OrganizationSchema({ name, url, logo, description, contact }: OrganizationSchema) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url,
    ...(logo && { logo: { '@type': 'ImageObject', url: logo } }),
    ...(description && { description }),
    ...(contact && {
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'Customer Service',
        url: contact,
      },
    }),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function ProductSchema({
  name,
  description,
  image,
  brand,
  price,
  currency,
  rating,
  reviewCount,
  availability,
}: ProductSchema) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    image,
    brand: { '@type': 'Brand', name: brand },
    offers: {
      '@type': 'Offer',
      price: (price / 100).toFixed(2),
      priceCurrency: currency,
      availability: \`https://schema.org/\${availability || 'InStock'}\`,
    },
    ...(rating && reviewCount && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: rating,
        reviewCount,
      },
    }),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function BreadcrumbSchema({ items }: BreadcrumbSchema) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
`,
    };
  }

  // ── Helpers ──

  private socialLinksHtml(theme: BrandTheme): string {
    if (!theme.socialLinks) return '';
    const links: string[] = [];
    if (theme.socialLinks.instagram) links.push(`<a href="${theme.socialLinks.instagram}" className="hover:opacity-80">Instagram</a>`);
    if (theme.socialLinks.tiktok) links.push(`<a href="${theme.socialLinks.tiktok}" className="hover:opacity-80">TikTok</a>`);
    if (theme.socialLinks.facebook) links.push(`<a href="${theme.socialLinks.facebook}" className="hover:opacity-80">Facebook</a>`);
    if (theme.socialLinks.twitter) links.push(`<a href="${theme.socialLinks.twitter}" className="hover:opacity-80">Twitter</a>`);
    if (links.length === 0) return '';
    return `<div className="flex gap-6 justify-center mt-6">${links.join('\n            ')}</div>`;
  }

  private escapeStr(s: string): string {
    return s.replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/`/g, '\\`');
  }
}
