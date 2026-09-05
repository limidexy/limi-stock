import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: '李米看板',
  description: '盘中板块驱动、连板晋级、打板涨速监控与15:00收盘情绪周期定格。',
  openGraph: {
    title: '李米看板',
    description: '板块异动 · 情绪周期 · 连板晋级 · 涨速观察',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: '李米看板',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '李米看板',
    description: '板块异动 · 情绪周期 · 连板晋级 · 涨速观察',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
