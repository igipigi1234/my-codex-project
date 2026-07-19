export type Stop = { id: string; name: string; lat: number; lon: number };
export type Route = { id: string; shortName: string; longName: string; color: string; textColor: string };
export type TransitEdge = [to: number, seconds: number, route: number];
export type NetworkData = { generatedAt: string; sourceUpdatedAt: string; sourceUrl: string; stops: Stop[]; routes: Route[]; graph?: TransitEdge[][] };
