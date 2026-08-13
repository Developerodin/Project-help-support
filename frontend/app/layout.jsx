import './globals.css';
import { ThemeProvider } from '@/shared/contexts/theme-context.jsx';
import { themeInitScript } from '@/shared/lib/theme.js';

export const metadata = { title: 'Help & Support', description: 'Ticket tracker' };

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
