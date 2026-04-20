import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lookout Booking',
  description: 'Band booking assistant for Lookout Farm Taproom',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {children}
      </body>
    </html>
  );
}
