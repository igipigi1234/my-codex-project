export type Stop = { id: string; name: string; lat: number; lon: number };
export type Route = { id: string; shortName: string; longName: string; color: string; textColor: string };
export type NetworkData = { generatedAt: string; sourceUpdatedAt: string; sourceUrl: string; stops: Stop[]; routes: Route[] };
export type RoutingData = { generatedAt: string; routeIds: string[]; edges: Array<Array<[number, number, number]>> };
