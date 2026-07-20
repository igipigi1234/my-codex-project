import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import "./extra.css";

export const metadata = {
  title: "Doseg Ljubljana",
  description: "Raziskovalnik dostopnosti z javnim potniškim prometom v Ljubljani",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sl"><body>{children}</body></html>;
}
