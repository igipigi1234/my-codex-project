export type Stop = { id: string; name: string; lat: number; lon: number };
export type Route = { id: string; shortName: string; longName: string; color: string; textColor: string };
export type NetworkData = {
  generatedAt: string;
  sourceUpdatedAt?: string;
  retrievedAt?: string;
  validFrom?: string;
  validThrough?: string;
  sourceUrl: string;
  stops: Stop[];
  routes: Route[];
};
export type RoutingData = { generatedAt: string; routeIds: string[]; edges: Array<Array<[number, number, number]>> };
export type Connection = [departure: number, arrival: number, from: number, to: number, trip: number, route: number];
export type Trip = [route: number, headsign: string, shape: string];
export type Pattern = [route: number, headsign: string, shape: string, stops: number[]];
export type DayProfile = { date: string; connections: Connection[]; trips: Trip[]; patterns: Pattern[] };
export type ScheduleData = {
  generatedAt: string;
  validFrom?: string;
  validThrough?: string;
  profiles: Record<string, DayProfile> & Partial<Record<"weekday" | "saturday" | "sunday", DayProfile>>;
  dateProfiles?: Record<string, string>;
  fallbackProfiles?: Partial<Record<"weekday" | "saturday" | "sunday", string>>;
  shapes: Record<string, Array<[number, number]>>;
};
