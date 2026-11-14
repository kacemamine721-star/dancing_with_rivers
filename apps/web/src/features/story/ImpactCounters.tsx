import { useMemo } from 'react';

import { useHandLut } from '@/data/hooks';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';

interface ImpactCountersProps {
  className?: string;
}

export function ImpactCounters({ className }: ImpactCountersProps) {
  const volumeM3 = useAppStore((s) => s.flood.volumeM3);
  const handLut = useHandLut();

  const impact = useMemo(() => {
    if (!handLut.data?.rows || handLut.data.rows.length === 0) {
      return {
        area_km2: 26.5,
        cropland_ha: 1309,
        villages: 1,
        population: 980,
        road_km: 10.4,
      };
    }

    const rows = handLut.data.rows;

    // Find row with closest V_m3 (or linear interpolate between rows)
    let best = rows[0]!;
    let minDiff = Math.abs(best.V_m3 - volumeM3);

    for (let i = 1; i < rows.length; i++) {
      const diff = Math.abs(rows[i]!.V_m3 - volumeM3);
      if (diff < minDiff) {
        minDiff = diff;
        best = rows[i]!;
      }
    }

    return {
      area_km2: best.area_km2,
      cropland_ha: Math.round(best.cropland_ha),
      villages: best.villages,
      population: Math.round(best.population),
      road_km: Number(best.road_km.toFixed(1)),
    };
  }, [handLut.data, volumeM3]);

  return (
    <div
      className={cn(
        'glass pointer-events-auto rounded-xl border border-white/10 bg-[rgba(6,12,20,.88)] p-3 text-ink backdrop-blur-md',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-1.5 font-mono text-[10.5px] uppercase tracking-wider text-mute">
        <span>Downstream Exposure</span>
        <span className="text-teal">101 km Corridor</span>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* Cropland */}
        <div className="rounded border border-white/5 bg-black/40 p-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-mute">Cropland</p>
          <p className="font-mono text-lg font-bold text-ink">
            {impact.cropland_ha.toLocaleString()} <span className="text-xs font-normal text-mute">ha</span>
          </p>
        </div>

        {/* Inundated Area */}
        <div className="rounded border border-white/5 bg-black/40 p-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-mute">Flooded Extent</p>
          <p className="font-mono text-lg font-bold text-ink">
            {impact.area_km2.toFixed(1)} <span className="text-xs font-normal text-mute">km²</span>
          </p>
        </div>

        {/* Villages */}
        <div className="rounded border border-white/5 bg-black/40 p-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-mute">Villages</p>
          <p className="font-mono text-lg font-bold text-teal">
            {impact.villages} <span className="text-xs font-normal text-mute">localities</span>
          </p>
        </div>

        {/* Population */}
        <div className="rounded border border-white/5 bg-black/40 p-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-mute">Population</p>
          <p className="font-mono text-lg font-bold text-ink">
            ≈ {impact.population.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
