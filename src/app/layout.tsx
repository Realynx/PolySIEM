import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { Providers } from "@/components/providers";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { isMobileView } from "@/lib/device";
import { getSitePresentation } from "@/lib/site-presentation";
import { MODE_COOKIE, THEME_COOKIE, isFixedThemeMode, isThemeColor } from "@/lib/theme";
import { ReducedEffectsProbe } from "@/components/render/reduced-effects-probe";
import {
  REDUCED_EFFECTS_CLASS,
  RENDER_MODE_COOKIE,
} from "@/lib/render/constants";
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
  // Draw under the S26 Ultra's punch-hole / gesture bar; safe-area insets
  // (pb-safe etc.) keep chrome clear of them.
  viewportFit: "cover",
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
  // Replayed from the last probe so a software-rendered client never paints the
  // expensive version first. First visit renders full effects and corrects on
  // mount; there is no synchronous way to ask the GPU before paint.
  const softwareRendered =
    cookieStore.get(RENDER_MODE_COOKIE)?.value === "software";
  const mobile = await isMobileView();
  // Dark/light from the profile cookie (login stamps it, ThemeModeSync keeps
  // it current). Baking it into the SSR class means a cold PWA start paints
  // the right mode and RSC refreshes can't wipe a client-added "dark".
  const cookieMode = cookieStore.get(MODE_COOKIE)?.value;
  const mode = isFixedThemeMode(cookieMode) ? cookieMode : undefined;

  return (
    <html
      lang="en"
      data-theme={themeColor}
      className={`${jakartaSans.variable} ${geistMono.variable}${
        softwareRendered ? ` ${REDUCED_EFFECTS_CLASS}` : ""
      }${mobile ? " mobile-view" : ""}${mode ? ` ${mode}` : ""}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ReducedEffectsProbe />
        <Providers defaultMode={mode}>{children}</Providers>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
