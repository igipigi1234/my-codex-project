import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata = {
  title: "Doseg Ljubljana",
  description: "Doseg, načrtovanje poti, vozni redi in primerjava dostopnosti z LPP v Ljubljani",
  applicationName: "Doseg Ljubljana",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sl"><body>{children}</body></html>;
}
