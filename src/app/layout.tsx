import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { MotionProvider } from "@/app/components/shared/motion/MotionProvider";
import { sidebarScript } from "@/lib/sidebar";
import "./globals.css";

// Lexend přímo v repu (app/fonts/lexend, licence OFL), jeden proměnný soubor 400–700. Jen znaky pro češtinu a běžnou interpunkci.
// Lexend vyhrál test čitelnosti (docs/brain/10-rozhodnuti.md): rozliší I, l a 1 a nula není přeškrtnutá, takže data a částky se čtou bez zaváhání.
const lexend = localFont({
  src: [{ path: "./fonts/lexend/lexend-variable.woff2", weight: "400 700", style: "normal" }],
  variable: "--font-sans",
  display: "swap",
});

// Big Shoulders Display na velké titulky značky (verzálky, stadionové písmo jako startovní čísla, kampaň „Svůj úsek“).
// Jen titulky od 30 px výš, nikdy text ke čtení: úzké verzálky čtou senioři hůř než Lexend.
const display = localFont({
  src: [{ path: "./fonts/big-shoulders/big-shoulders-display.woff2", weight: "700 900", style: "normal" }],
  variable: "--font-display",
  display: "swap",
});

// Bricolage Grotesque jen na logo Klidka. Na text ke čtení ne.
const bricolage = localFont({
  src: [{ path: "./fonts/bricolage/bricolage-700.woff2", weight: "700", style: "normal" }],
  variable: "--font-brand",
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "Klidka · příprava na zákrok",
  description: "Předoperační příprava s anesteziologickou ambulancí.",
  applicationName: "Klidka",
  appleWebApp: {
    capable: true,
    title: "Klidka",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: skript níž dá <html> atribut sbaleného panelu ještě před hydratací.
    <html
      lang="cs"
      className={`${lexend.variable} ${bricolage.variable} ${display.variable} ${geistMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col">
        <script dangerouslySetInnerHTML={{ __html: sidebarScript }} />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
