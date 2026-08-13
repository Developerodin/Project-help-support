import './globals.css';

export const metadata = { title: 'Help & Support', description: 'Ticket tracker' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
