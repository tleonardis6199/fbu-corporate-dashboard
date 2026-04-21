import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FBU Corporate Dashboard",
  description: "Live sales + pipeline dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg text-text font-sans min-h-screen">{children}</body>
    </html>
  );
}
