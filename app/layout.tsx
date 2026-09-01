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
  title: '等风盘中 · 异动与晋级监控',
  description: '板块驱动、连板晋级、同梯队竞争与打板涨速监控。',
  openGraph: {
    title: '等风盘中',
    description: '板块异动 · 连板晋级 · 梯队竞争 · 涨速观察',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: '等风盘中监控看板',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '等风盘中',
    description: '板块异动 · 连板晋级 · 梯队竞争 · 涨速观察',
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
