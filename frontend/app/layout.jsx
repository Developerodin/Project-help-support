import './globals.css';
import { ThemeProvider } from '@/shared/contexts/theme-context.jsx';
import { BRAND_DESCRIPTION, BRAND_FULL } from '@/shared/lib/brand.js';
import { themeInitScript } from '@/shared/lib/theme.js';

export const metadata = { title: BRAND_FULL, description: BRAND_DESCRIPTION };

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
