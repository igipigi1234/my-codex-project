export type Stop = { id: string; name: string; lat: number; lon: number };
export type Route = { id: string; shortName: string; longName: string; color: string; textColor: string };
export type NetworkData = { generatedAt: string; sourceUpdatedAt: string; sourceUrl: string; stops: Stop[]; routes: Route[] };
export type RoutingData = { generatedAt: string; routeIds: string[]; edges: Array<Array<[number, number, number]>> };
export type DayProfile = { date: string; connections: Array<[number, number, number, number, number, number]>; trips: Array<[number, string, string]>; patterns: Array<[number, string, string, number[]]> };
export type ScheduleData = { generatedAt: string; profiles: { weekday: DayProfile; saturday: DayProfile; sunday: DayProfile }; shapes: Record<string, Array<[number, number]>> };
