import './globals.css';
import { ThemeProvider } from '@/shared/contexts/theme-context.jsx';
import { PwaRegister } from '@/shared/components/pwa-register.jsx';
import { BRAND_DESCRIPTION, BRAND_FULL, BRAND_NAME } from '@/shared/lib/brand.js';
import { themeInitScript } from '@/shared/lib/theme.js';

/** Light paper token from design-system.css (`--paper` ≈ #fcfbf9). */
const THEME_COLOR = '#fcfbf9';

export const metadata = {
  title: BRAND_FULL,
  description: BRAND_DESCRIPTION,
  applicationName: BRAND_NAME,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: BRAND_NAME,
    statusBarStyle: 'default',
  },
  icons: {
    apple: [{ url: '/icons/apple-touch-prowplus.png', sizes: '180x180', type: 'image/png' }],
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: THEME_COLOR,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
