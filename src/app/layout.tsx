import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { Providers } from "@/components/providers";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { getSitePresentation } from "@/lib/site-presentation";
import { THEME_COOKIE, isThemeColor } from "@/lib/theme";
import "./globals.css";

const jakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateMetadata(): Metadata {
  const site = getSitePresentation();

  return {
    metadataBase: site.baseUrl,
    applicationName: "PolySIEM",
    title: {
      default: site.title,
      template: "%s · PolySIEM",
    },
    description: site.description,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      url: "/",
      siteName: "PolySIEM",
      title: site.title,
      description: site.description,
    },
    twitter: {
      card: "summary_large_image",
      title: site.title,
      description: site.description,
    },
    manifest: "/manifest.webmanifest",
    icons: {
      icon: "/brand/polysiem-mark.svg",
      apple: "/icons/apple-touch-icon.png",
    },
    appleWebApp: {
      capable: true,
      title: "PolySIEM",
      statusBarStyle: "default",
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const cookieTheme = cookieStore.get(THEME_COOKIE)?.value;
  const themeColor = isThemeColor(cookieTheme) ? cookieTheme : "blue";

  return (
    <html
      lang="en"
      data-theme={themeColor}
      className={`${jakartaSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <Providers>{children}</Providers>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
