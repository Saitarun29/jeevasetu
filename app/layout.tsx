import type { Metadata } from 'next';
import './globals.css';
import { ServiceWorkerRegistration } from '@/components/offline/ServiceWorkerRegistration';

export const metadata: Metadata = {
  title: 'JEEVASETU — A bridge between generations',
  description: 'Human-centered elderly care coordination platform connecting elderly people, family members, and caregivers.',
  manifest: '/manifest.json',
};

export const viewport = {
  themeColor: '#1e293b',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased flex flex-col font-sans">
        <ServiceWorkerRegistration />
        <div className="flex-1 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
