import { CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

import { HonestyNote } from '@/components/HonestyNote';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { DocPage } from '@/routes/DocPage';

/** `/methods` — Methods, numerical benchmarks, and scientific validation. */
export function Component() {
  useDocumentTitle('Methods & Validation');

  return (
    <DocPage kicker="Methods & Validation" title="How we measure, model and verify">
      <div className="space-y-8 text-ink/90">
        <p className="text-[15px] leading-relaxed">
          HydroStress combines radar remote sensing (NISAR L-band, Sentinel-1 C-band), terrain hydrology (Google Research
          GEM-15 DTM, pysheds routing), and shallow-water hydrodynamics (ANUGA 2D). Every number and simulation shown in the
          story is backed by reproducible numerical benchmarks and published scientific data.
        </p>

        {/* Section 1: Validation Table */}
        <section aria-labelledby="benchmark-table" className="space-y-4">
          <div className="flex items-center gap-2 border-b border-white/10 pb-2">
            <ShieldCheck className="size-5 text-teal" />
            <h2 id="benchmark-table" className="font-mono text-sm font-semibold uppercase tracking-wider text-teal">
              Benchmark & Validation Results
            </h2>
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10 bg-black/30">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 bg-white/[0.03] font-mono uppercase text-mute">
                <tr>
                  <th className="p-3">Analysis</th>
                  <th className="p-3">Metric / Check</th>
                  <th className="p-3">Numerical Result</th>
                  <th className="p-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                <tr>
                  <td className="p-3 font-semibold text-ink">Water Area (SAR)</td>
                  <td className="p-3 text-mute">Dual-sensor agreement</td>
                  <td className="p-3 text-ink/80">NISAR & Sentinel-1 align within ±12% after calibration</td>
                  <td className="p-3 text-center text-teal">
                    <CheckCircle2 className="mx-auto size-4" />
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-ink">Anomaly Detector</td>
                  <td className="p-3 text-mute">Confirmed departure</td>
                  <td className="p-3 text-ink/80">ALERT triggered 22 Jun; 0 false alarms on baseline (Aug–Oct)</td>
                  <td className="p-3 text-center text-teal">
                    <CheckCircle2 className="mx-auto size-4" />
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-ink">ANUGA E1 Mass Balance</td>
                  <td className="p-3 text-mute">Conservation error</td>
                  <td className="p-3 text-ink/80">&lt; 9 × 10⁻¹³ % across 48-hour continuous simulation</td>
                  <td className="p-3 text-center text-teal">
                    <CheckCircle2 className="mx-auto size-4" />
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-ink">ANUGA E2 Hydrograph</td>
                  <td className="p-3 text-mute">Inflow volume integral</td>
                  <td className="p-3 text-ink/80">Error &lt; 3 × 10⁻¹⁰ % (21.0, 50.0, 195.0 Mm³)</td>
                  <td className="p-3 text-center text-teal">
                    <CheckCircle2 className="mx-auto size-4" />
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-ink">ANUGA E3 Stability</td>
                  <td className="p-3 text-mute">Velocity & depth bounds</td>
                  <td className="p-3 text-ink/80">Max speed 4.2–5.6 m/s; 0 NaN/Inf values encountered</td>
                  <td className="p-3 text-center text-teal">
                    <CheckCircle2 className="mx-auto size-4" />
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-ink">ANUGA E7 Arrival Time</td>
                  <td className="p-3 text-mute">45 km confluence reach</td>
                  <td className="p-3 text-ink/80">Front reaches Medjerda in 12.9 h (21 Mm³) / 9.3 h (50 Mm³)</td>
                  <td className="p-3 text-center text-teal">
                    <CheckCircle2 className="mx-auto size-4" />
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-ink">HAND vs ANUGA D5</td>
                  <td className="p-3 text-mute">Spatial overlap (IoU)</td>
                  <td className="p-3 text-ink/80">IoU = 0.55 (Reach 1); bathtub matches hydrodynamic envelope</td>
                  <td className="p-3 text-center text-teal">
                    <CheckCircle2 className="mx-auto size-4" />
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-ink">Impacts F2 Monotonicity</td>
                  <td className="p-3 text-mute">Exposure vs Volume</td>
                  <td className="p-3 text-ink/80">Strictly monotonic for wet ha, cropland ha, buildings, road km</td>
                  <td className="p-3 text-center text-teal">
                    <CheckCircle2 className="mx-auto size-4" />
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-ink">Bathymetry Limitation</td>
                  <td className="p-3 text-mute">Channel survey data</td>
                  <td className="p-3 text-amber-300/80">DEM-based channel burn (2 m); sub-grid bathymetry unmeasured</td>
                  <td className="p-3 text-center text-amber-400">
                    <AlertTriangle className="mx-auto size-4" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 2: Honest Limits */}
        <section aria-labelledby="honest-limits" className="space-y-3">
          <h2 id="honest-limits" className="font-mono text-sm font-semibold uppercase tracking-wider text-teal">
            Scientific Limits & Boundaries
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 text-xs">
            <div className="rounded-lg border border-teal/20 bg-teal/[0.03] p-4">
              <h3 className="font-mono font-semibold uppercase text-teal">What this project proves</h3>
              <ul className="mt-2 list-inside list-disc space-y-1.5 text-mute">
                <li>NISAR L-band penetrates cloud and accurately tracks reservoir shrinkage.</li>
                <li>Automated change detection flagged the anomaly 5 days post-event.</li>
                <li>ANUGA 2D reproduces downstream flood propagation with strict mass conservation.</li>
              </ul>
            </div>
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.03] p-4">
              <h3 className="font-mono font-semibold uppercase text-amber-400">What we do NOT claim</h3>
              <ul className="mt-2 list-inside list-disc space-y-1.5 text-mute">
                <li>We did not predict the gate failure before it occurred.</li>
                <li>Simulations are scenario explorations, not official hydraulic forecasts.</li>
                <li>Sediment deposition depth inside the reservoir is estimated, not sound-surveyed.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Section 3: Honest Disclosure */}
        <HonestyNote kind="info" label="OPEN REPRODUCIBILITY">
          All hydraulic meshes, hydrographs, and SAR pipelines are version-controlled in the project repository and runnable
          offline via Docker container (`dwd-anuga:1`).
        </HonestyNote>
      </div>
    </DocPage>
  );
}
