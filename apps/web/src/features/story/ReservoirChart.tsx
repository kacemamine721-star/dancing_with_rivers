import { AxisBottom, AxisLeft } from '@visx/axis';
import { Group } from '@visx/group';
import { scaleLinear, scaleTime } from '@visx/scale';
import { AreaClosed, LinePath } from '@visx/shape';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/Badge';
import { useReservoirArea } from '@/data/hooks';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app';
import { tokens } from '@/styles/tokens';

interface Point {
  date: Date;
  dateStr: string;
  area_km2: number;
  sigma_km2: number;
  sensor: string;
}

export function ReservoirChart({
  width = 440,
  height = 190,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) {
  const reservoirQuery = useReservoirArea();
  const currentDate = useAppStore((s) => s.date);
  const setDate = useAppStore((s) => s.setDate);

  const [hoveredPoint, setHoveredPoint] = useState<Point | null>(null);

  const margin = { top: 18, right: 18, bottom: 28, left: 38 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const { points, events } = useMemo(() => {
    if (!reservoirQuery.data) return { points: [], events: [] };
    const rawPoints = reservoirQuery.data.points.map((p) => ({
      date: new Date(p.date),
      dateStr: p.date,
      area_km2: p.area_km2,
      sigma_km2: p.sigma_km2 ?? 0.15,
      sensor: p.sensor,
    }));
    return {
      points: rawPoints.sort((a, b) => a.date.getTime() - b.date.getTime()),
      events: reservoirQuery.data.events ?? [],
    };
  }, [reservoirQuery.data]);

  const xScale = useMemo(
    () =>
      scaleTime({
        range: [0, innerWidth],
        domain: [
          points.length > 0 ? points[0]!.date : new Date('2026-05-15'),
          points.length > 0 ? points[points.length - 1]!.date : new Date('2026-11-01'),
        ],
      }),
    [points, innerWidth],
  );

  const yScale = useMemo(
    () =>
      scaleLinear({
        range: [innerHeight, 0],
        domain: [1.2, 3.6],
        nice: true,
      }),
    [innerHeight],
  );

  if (points.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-xs text-mute font-mono">
        Loading reservoir time series...
      </div>
    );
  }

  const activePoint = hoveredPoint ?? points.find((p) => p.dateStr === currentDate) ?? null;

  return (
    <div
      className={cn(
        'glass pointer-events-auto rounded-xl border border-white/10 bg-[rgba(6,12,20,.88)] p-3 shadow-xl backdrop-blur-md',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-teal">
            Reservoir Area
          </span>
          <Badge kind="measured" source="NISAR + Sentinel-1 Otsu" subject="Area Time Series" />
        </div>
        {activePoint && (
          <div className="font-mono text-[11px] text-ink">
            <span className="text-teal font-semibold">{activePoint.area_km2.toFixed(2)} km²</span>
            <span className="ml-1.5 text-mute">({activePoint.dateStr})</span>
          </div>
        )}
      </div>

      <div className="relative mt-2">
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
          <defs>
            <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tokens.color.water} stopOpacity={0.4} />
              <stop offset="100%" stopColor={tokens.color.water} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="sigma-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={tokens.color.teal} stopOpacity={0.15} />
              <stop offset="100%" stopColor={tokens.color.teal} stopOpacity={0.05} />
            </linearGradient>
          </defs>

          <Group left={margin.left} top={margin.top}>
            {/* Uncertainty Upper and Lower Band */}
            <AreaClosed<Point>
              data={points}
              x={(d) => xScale(d.date)}
              y0={(d) => yScale(Math.max(1.0, d.area_km2 - d.sigma_km2))}
              y1={(d) => yScale(d.area_km2 + d.sigma_km2)}
              yScale={yScale}
              fill="url(#sigma-gradient)"
            />

            {/* Main Area Fill */}
            <AreaClosed<Point>
              data={points}
              x={(d) => xScale(d.date)}
              y={(d) => yScale(d.area_km2)}
              yScale={yScale}
              fill="url(#area-gradient)"
            />

            {/* Main Area Stroke Line */}
            <LinePath<Point>
              data={points}
              x={(d) => xScale(d.date)}
              y={(d) => yScale(d.area_km2)}
              stroke={tokens.color.water}
              strokeWidth={2}
            />

            {/* Key Event Markers (Failure 17 Jun, Repair 16 Jul) */}
            {events.map((ev, i) => {
              const evDate = new Date(ev.date);
              const xPos = xScale(evDate);
              if (xPos < 0 || xPos > innerWidth) return null;
              const isFailure = ev.kind === 'failure';
              const isRepair = ev.kind === 'repair';
              const col = isFailure ? tokens.color.danger : isRepair ? tokens.color.ok : tokens.color.alert;

              return (
                <g key={i}>
                  <line
                    x1={xPos}
                    x2={xPos}
                    y1={0}
                    y2={innerHeight}
                    stroke={col}
                    strokeWidth={1.5}
                    strokeDasharray={isFailure ? undefined : '3 3'}
                    opacity={0.85}
                  />
                  <circle cx={xPos} cy={6} r={3} fill={col} />
                </g>
              );
            })}

            {/* Points / Acquisition Dots */}
            {points.map((p, i) => {
              const cx = xScale(p.date);
              const cy = yScale(p.area_km2);
              const isSelected = p.dateStr === currentDate;
              const isNisar = p.sensor === 'NISAR';

              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 4.5 : isNisar ? 3 : 2}
                  fill={isSelected ? tokens.color.teal : isNisar ? tokens.color.teal : '#a0b8d8'}
                  stroke={isSelected ? '#ffffff' : 'transparent'}
                  strokeWidth={1.5}
                  className="cursor-pointer transition-transform hover:scale-150"
                  onClick={() => setDate(p.dateStr)}
                  onMouseEnter={() => setHoveredPoint(p)}
                  onMouseLeave={() => setHoveredPoint(null)}
                />
              );
            })}

            {/* Left Axis */}
            <AxisLeft
              scale={yScale}
              numTicks={4}
              stroke="rgba(255,255,255,0.15)"
              tickStroke="rgba(255,255,255,0.15)"
              tickLabelProps={() => ({
                fill: '#8da2be',
                fontSize: 9,
                fontFamily: 'JetBrains Mono, monospace',
                textAnchor: 'end',
                dx: -4,
                dy: 3,
              })}
            />

            {/* Bottom Axis */}
            <AxisBottom
              top={innerHeight}
              scale={xScale}
              numTicks={5}
              stroke="rgba(255,255,255,0.15)"
              tickStroke="rgba(255,255,255,0.15)"
              tickLabelProps={() => ({
                fill: '#8da2be',
                fontSize: 9,
                fontFamily: 'JetBrains Mono, monospace',
                textAnchor: 'middle',
                dy: 4,
              })}
            />
          </Group>
        </svg>

        {/* Legend */}
        <div className="mt-2 flex items-center justify-between font-mono text-[9.5px] text-mute">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-teal" /> NISAR (L-band)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-[#a0b8d8]" /> Sentinel-1
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-danger">
              <span className="inline-block size-1.5 bg-danger" /> Failure (17 Jun)
            </span>
            <span className="flex items-center gap-1 text-ok">
              <span className="inline-block size-1.5 bg-ok" /> Repaired (16 Jul)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
