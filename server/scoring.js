export const PLACE_POINTS = [0,12,9,8,7,6,5,4,3,2,1,0,0];
export const pointsFor = (placement, kills) => (PLACE_POINTS[placement] ?? 0) + kills;

export function standings(teams, rooms, results, goldThreshold = 0) {
  const rows = teams.map(t => ({...t, games:0, placePoints:0, kills:0, booyahs:0, goldBooyahs:0, points:0}));
  const lookup = new Map(rows.map(row => [row.id, row]));
  for (const room of [...rooms].sort((a,b)=>a.id-b.id)) {
    for (const r of results.filter(x => x.roomId === room.id)) {
      const row = lookup.get(r.teamId);
      if (!row) continue;
      row.games++;
      row.placePoints += PLACE_POINTS[r.placement] ?? 0;
      row.kills += r.kills;
      row.points += pointsFor(r.placement, r.kills);
      if (r.placement === 1) {
        row.booyahs++;
        if (goldThreshold > 0 && row.points >= goldThreshold) row.goldBooyahs++;
      }
    }
  }
  return rows.sort((a,b)=>b.points-a.points || b.booyahs-a.booyahs || b.kills-a.kills || a.id-b.id);
}
