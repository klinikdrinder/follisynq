import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppProvider } from '@/components/AppProvider';

export const metadata: Metadata = {
  title: 'Follisync',
  description: 'Clinical media collection for hair transplantation — Klinik Dr Inder (internal use)',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Follisync', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: 'cover', themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
