import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata = {
  title: "Doseg Slovenija",
  description: "Doseg, multimodalno načrtovanje poti in vozni redi javnega potniškega prometa po vsej Sloveniji",
  applicationName: "Doseg Slovenija",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sl"><body>{children}</body></html>;
}
