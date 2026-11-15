import { chromium } from '@playwright/test';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const OUT_DIR = resolve('..', '..', 'docs', 'figures');
const ARTIFACT_DIR = 'C:\\Users\\Dell\\.gemini\\antigravity\\brain\\31953e8c-ef0c-4739-baf6-e8ebde05414f';

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(ARTIFACT_DIR, { recursive: true });

const commonCSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #060b14;
    color: #f1f5f9;
    padding: 32px;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .canvas {
    width: 1400px;
    background: #0a1120;
    border: 1px solid #1e293b;
    border-radius: 16px;
    padding: 36px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1px solid #1e293b;
    padding-bottom: 20px;
    margin-bottom: 28px;
  }
  .header-left h1 {
    font-size: 24px;
    font-weight: 700;
    color: #f8fafc;
    letter-spacing: -0.02em;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .header-left p {
    font-size: 13px;
    color: #94a3b8;
    margin-top: 6px;
  }
  .badge {
    display: inline-block;
    padding: 4px 10px;
    font-size: 11px;
    font-family: monospace;
    font-weight: 600;
    border-radius: 6px;
    background: rgba(20, 184, 166, 0.12);
    color: #2dd4bf;
    border: 1px solid rgba(20, 184, 166, 0.3);
  }
  .badge-amber {
    background: rgba(245, 158, 11, 0.12);
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }
  .badge-blue {
    background: rgba(59, 130, 246, 0.12);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }
  .card {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 16px;
  }
  .node-title {
    font-size: 13px;
    font-weight: 700;
    color: #e2e8f0;
    margin-bottom: 4px;
  }
  .node-sub {
    font-size: 11px;
    color: #94a3b8;
    line-height: 1.4;
  }
  .node-tag {
    font-family: monospace;
    font-size: 10px;
    color: #2dd4bf;
    margin-top: 6px;
    display: block;
  }
  .arrow {
    display: flex;
    justify-content: center;
    align-items: center;
    color: #475569;
    font-size: 20px;
    font-weight: bold;
  }
`;

// 1. High-Level System Architecture
const htmlDiag1 = `
<!DOCTYPE html>
<html>
<head><style>${commonCSS}
  .col-container { display: grid; grid-template-columns: 1fr 40px 1.25fr 40px 1fr; align-items: stretch; gap: 8px; }
  .stage-box { background: rgba(15, 23, 42, 0.6); border: 1px solid #1e293b; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  .stage-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; border-bottom: 1px solid #1e293b; padding-bottom: 10px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
</style></head>
<body>
<div class="canvas">
  <div class="header">
    <div class="header-left">
      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <span class="badge">NASA SPACE APPS 2026 · TUNIS</span>
        <span class="badge badge-blue">DANCING WITH SARS</span>
      </div>
      <h1><span>🛰️</span> High-Level System Architecture</h1>
      <p>Seamless data flow from multi-sensor spaceborne observation to offline hydrodynamic modeling and WebGL client</p>
    </div>
    <div style="text-align:right;">
      <span class="badge badge-amber">END-TO-END PIPELINE</span>
      <div style="font-size:11px; color:#64748b; margin-top:6px; font-family:monospace;">Mellègue Basin · 45 km Reach 1</div>
    </div>
  </div>

  <div class="col-container">
    <!-- COL 1: SATELLITES -->
    <div class="stage-box">
      <div class="stage-title"><span>1. Satellite & Ancillary Telemetry</span> <span class="badge" style="font-size:9px;">INGEST</span></div>
      
      <div class="card" style="border-left: 3px solid #38bdf8;">
        <div class="node-title">Sentinel-1 RTC (ESA / PC)</div>
        <div class="node-sub">10 m C-band VV/VH calibrated backscatter timeseries (2024–2026).</div>
        <span class="node-tag">C-SAR · Speeds: 6-12d revisit</span>
      </div>

      <div class="card" style="border-left: 3px solid #14b8a6;">
        <div class="node-title">NISAR GCOV/SME2 (NASA/ISRO)</div>
        <div class="node-sub">Dual-band L+S SAR. High vegetation canopy penetration, specular water reflection.</div>
        <span class="node-tag">L-band (1.26 GHz) · 12d repeat</span>
      </div>

      <div class="card" style="border-left: 3px solid #818cf8;">
        <div class="node-title">SWOT KaRIn (NASA/CNES)</div>
        <div class="node-sub">Ka-band radar interferometry. Lake surface water elevation (cm precision).</div>
        <span class="node-tag">LakeSP · WSE (m above geoid)</span>
      </div>

      <div class="card" style="border-left: 3px solid #f59e0b;">
        <div class="node-title">GEM-15 & COP-30 DEM</div>
        <div class="node-sub">15 m Bare-Earth DTM. Vegetation canopy removed for accurate valley routing.</div>
        <span class="node-tag">Topography · D8 flow lines</span>
      </div>

      <div class="card" style="border-left: 3px solid #10b981;">
        <div class="node-title">ESA WorldCover & OSM</div>
        <div class="node-sub">10 m global landcover (Manning roughness n) + OSM villages & roads.</div>
        <span class="node-tag">Vulnerability & friction</span>
      </div>
    </div>

    <!-- ARROW 1 -->
    <div class="arrow">➔</div>

    <!-- COL 2: PYTHON PIPELINE -->
    <div class="stage-box">
      <div class="stage-title"><span>2. Scientific Python Pipeline</span> <span class="badge" style="font-size:9px;">OFFLINE DOCKER</span></div>

      <div class="card">
        <div class="node-title">00_context_data & 01_terrain</div>
        <div class="node-sub">Standardize to UTM 32N (EPSG:32632). Hydro-enforced DTM, river centerline (44.9 km), and HAND grid.</div>
        <span class="node-tag">pipeline/01_terrain.py & 01b_gem15.py</span>
      </div>

      <div class="card">
        <div class="node-title">02_reservoir & 03_anomaly</div>
        <div class="node-sub">Otsu backscatter thresholding (σ⁰ < -16 dB), area series A(t), and robust Z-score breach alert (Z < -3.5).</div>
        <span class="node-tag">pipeline/02_reservoir.py & 03_anomaly.py</span>
      </div>

      <div class="card">
        <div class="node-title">04_routing_hand & 07_level_volume</div>
        <div class="node-sub">SWOT hypsometric integral V(z) = ∫ A(z')dz' (21 Mm³ escape) + static HAND stage-discharge rating LUT.</div>
        <span class="node-tag">pipeline/04_routing_hand.py & 07_level_volume.py</span>
      </div>

      <div class="card" style="border-color: rgba(20, 184, 166, 0.4); background: rgba(20, 184, 166, 0.05);">
        <div class="node-title" style="color: #2dd4bf;">05_anuga_scenarios (2D SWE)</div>
        <div class="node-sub">Finite-volume non-linear shallow water equations on 69,616-triangle mesh. 3 scenarios: 21, 50, 195 Mm³.</div>
        <span class="node-tag" style="color: #38bdf8;">Mass balance error: 8.96 × 10⁻¹³</span>
      </div>

      <div class="card">
        <div class="node-title">06_impacts & 08_bundle</div>
        <div class="node-sub">Wave front arrival times (Muthul @ 5.33 h), crop hectares flooded, and strict Zod schema validation (< 12 MB).</div>
        <span class="node-tag">pipeline/06_impacts.py & 08_bundle.py</span>
      </div>
    </div>

    <!-- ARROW 2 -->
    <div class="arrow">➔</div>

    <!-- COL 3: WEB APP -->
    <div class="stage-box">
      <div class="stage-title"><span>3. Client Web Delivery</span> <span class="badge" style="font-size:9px;">REACT + THREE.JS</span></div>

      <div class="card" style="border-left: 3px solid #2dd4bf;">
        <div class="node-title">DataSource Layer (Zod + Query)</div>
        <div class="node-sub">Zero-backend static ingestion of JSON manifest and 16-bit terrain heightmaps.</div>
        <span class="node-tag">apps/web/src/data/</span>
      </div>

      <div class="card" style="border-left: 3px solid #f59e0b;">
        <div class="node-title">Dual-Layer GLSL Shaders</div>
        <div class="node-sub">Amber Gold stipple grid (HAND Bathtub) vs Cyan-Teal depth ramp (ANUGA 2D SWE).</div>
        <span class="node-tag">apps/web/src/scene/shaders/</span>
      </div>

      <div class="card" style="border-left: 3px solid #a855f7;">
        <div class="node-title">9-Act Interactive Story Engine</div>
        <div class="node-sub">Choreographed 3D camera flythroughs, volume scrubber, and Simplified vs Advanced reading.</div>
        <span class="node-tag">apps/web/src/routes/Story.tsx</span>
      </div>

      <div class="card" style="border-left: 3px solid #3b82f6;">
        <div class="node-title">National Dam Watch Dashboard</div>
        <div class="node-sub">Real-time status, telemetry counts, and alert thresholds across 5 Medjerda reservoirs.</div>
        <span class="node-tag">apps/web/src/routes/Watch.tsx</span>
      </div>

      <div class="card" style="border-left: 3px solid #10b981;">
        <div class="node-title">Cloudflare Pages Edge CDN</div>
        <div class="node-sub">Deployed live at dancingwithrivers.study with global SSL, strict CSP, and instant caching.</div>
        <span class="node-tag">Production: 11.5 MB static bundle</span>
      </div>
    </div>
  </div>
</div>
</body>
</html>
`;

// 2. End-to-End Pipeline Execution Phases
const htmlDiag2 = `
<!DOCTYPE html>
<html>
<head><style>${commonCSS}
  .phases-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-top: 10px; }
  .phase-col { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .phase-header { border-bottom: 1px solid #1e293b; padding-bottom: 12px; }
  .phase-num { font-family: monospace; font-size: 11px; font-weight: 700; color: #2dd4bf; margin-bottom: 4px; }
  .phase-name { font-size: 15px; font-weight: 700; color: #f8fafc; }
  .flow-item { background: #0a1120; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; position: relative; }
  .flow-arrow-down { text-align: center; color: #475569; font-size: 14px; margin: -4px 0; }
  .math-box { font-family: monospace; font-size: 11px; color: #38bdf8; background: rgba(56, 189, 248, 0.08); padding: 6px 8px; border-radius: 4px; margin-top: 6px; }
</style></head>
<body>
<div class="canvas">
  <div class="header">
    <div class="header-left">
      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <span class="badge">METHODOLOGY & PHASING</span>
        <span class="badge badge-amber">SCIENTIFIC RIGOR</span>
      </div>
      <h1><span>📐</span> End-to-End Pipeline Execution Phases</h1>
      <p>Algorithmic chain from hydro-topographic base to radar detection, 2D shallow water simulation, and impacts</p>
    </div>
    <div style="text-align:right;">
      <span class="badge badge-blue">PIPELINE 00 → 08</span>
      <div style="font-size:11px; color:#64748b; margin-top:6px; font-family:monospace;">Reproducible via Docker</div>
    </div>
  </div>

  <div class="phases-grid">
    <!-- PHASE 1 -->
    <div class="phase-col">
      <div class="phase-header">
        <div class="phase-num">PHASE I</div>
        <div class="phase-name">Hydrologic Baseline</div>
      </div>

      <div class="flow-item">
        <div class="node-title">GEM-15 & COP-30 DEM</div>
        <div class="node-sub">15 m Bare-Earth DTM removes tree cover along Oued Mellègue valley.</div>
      </div>
      <div class="flow-arrow-down">▼</div>

      <div class="flow-item">
        <div class="node-title">D8 Single Flow Routing</div>
        <div class="node-sub">Computes downstream drainage steepest descent vector on every grid cell.</div>
        <div class="math-box">S_i = (z_center - z_i) / d_i</div>
      </div>
      <div class="flow-arrow-down">▼</div>

      <div class="flow-item">
        <div class="node-title">River Centerline & HAND</div>
        <div class="node-sub">44.9 km Reach 1 to Sidi Salem + Height Above Nearest Drainage grid.</div>
        <div class="math-box">HAND = z(x,y) - z(drain)</div>
      </div>
    </div>

    <!-- PHASE 2 -->
    <div class="phase-col">
      <div class="phase-header">
        <div class="phase-num">PHASE II</div>
        <div class="phase-name">Radar Water Detection</div>
      </div>

      <div class="flow-item">
        <div class="node-title">SAR Backscatter (σ⁰)</div>
        <div class="node-sub">Sentinel-1 C-band & NISAR L-band radiometrically terrain-corrected.</div>
      </div>
      <div class="flow-arrow-down">▼</div>

      <div class="flow-item">
        <div class="node-title">Otsu Segmentation</div>
        <div class="node-sub">Adaptive bimodal log-intensity threshold separating water from dry soil.</div>
        <div class="math-box">σ⁰_threshold ≈ -16.5 dB</div>
      </div>
      <div class="flow-arrow-down">▼</div>

      <div class="flow-item">
        <div class="node-title">Z-Score Breach Alert</div>
        <div class="node-sub">Rate of change dA/dt triggers acute alert on 17–18 June 2026 gate failure.</div>
        <div class="math-box">Z = (ΔA - median) / MAD < -3.5</div>
      </div>
    </div>

    <!-- PHASE 3 -->
    <div class="phase-col">
      <div class="phase-header">
        <div class="phase-num">PHASE III</div>
        <div class="phase-name">2D Dynamic Physics</div>
      </div>

      <div class="flow-item">
        <div class="node-title">SWOT Hypsometry V(z)</div>
        <div class="node-sub">12 m water elevation drop integrated over bathymetric contours: 21 Mm³ lost.</div>
        <div class="math-box">V(z) = ∫ A(z') dz' = 21 Mm³</div>
      </div>
      <div class="flow-arrow-down">▼</div>

      <div class="flow-item">
        <div class="node-title">69,616-Triangle Mesh</div>
        <div class="node-sub">Unstructured mesh graded from 15 m in riverbed to 60 m in floodplain.</div>
        <div class="math-box">Manning: n=0.035 to 0.100</div>
      </div>
      <div class="flow-arrow-down">▼</div>

      <div class="flow-item">
        <div class="node-title">ANUGA 2D Simulation</div>
        <div class="node-sub">Saint-Venant shallow water equations solved over 48 h runtime across 3 runs.</div>
        <div class="math-box">∂U/∂t + ∂E/∂x + ∂G/∂y = S</div>
      </div>
    </div>

    <!-- PHASE 4 -->
    <div class="phase-col">
      <div class="phase-header">
        <div class="phase-num">PHASE IV</div>
        <div class="phase-name">Downstream Impacts & Web</div>
      </div>

      <div class="flow-item">
        <div class="node-title">Wave Front Tracking</div>
        <div class="node-sub">Arrival times: Muthul in 5.33 h (21 Mm³), 4.0 h (50 Mm³), 2.67 h (195 Mm³).</div>
        <div class="math-box">t_arr: min{t | h > 0.10 m}</div>
      </div>
      <div class="flow-arrow-down">▼</div>

      <div class="flow-item">
        <div class="node-title">Exposure Assessment</div>
        <div class="node-sub">Inundated cropland hectares (WorldCover) & infrastructure cuts.</div>
        <div class="math-box">19.35 km² max inundation</div>
      </div>
      <div class="flow-arrow-down">▼</div>

      <div class="flow-item">
        <div class="node-title">Static Web Bundle</div>
        <div class="node-sub">49 hourly frames (0.65 MB), verified Zod schemas, 11.5 MB total bundle.</div>
        <div class="math-box">dancingwithrivers.study</div>
      </div>
    </div>
  </div>
</div>
</body>
</html>
`;

// 3. Web Engine Architecture & Layer Rendering
const htmlDiag3 = `
<!DOCTYPE html>
<html>
<head><style>${commonCSS}
  .render-grid { display: grid; grid-template-columns: 1.1fr 40px 1fr 40px 1.1fr; align-items: stretch; gap: 10px; }
  .render-box { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 22px; display: flex; flex-direction: column; gap: 14px; }
  .render-title { font-size: 13px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #1e293b; padding-bottom: 10px; }
</style></head>
<body>
<div class="canvas">
  <div class="header">
    <div class="header-left">
      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <span class="badge badge-amber">WEBGL SHADER ENGINE</span>
        <span class="badge">THREE.JS / REACT THREE FIBER</span>
      </div>
      <h1><span>🌊</span> Web Engine Architecture & Shader Synthesis</h1>
      <p>Dual-mode rendering pipeline: Static Analytical Bathtub (HAND) vs Dynamic 2D Physics (ANUGA)</p>
    </div>
    <div style="text-align:right;">
      <span class="badge badge-blue">GPU SHADER PIPELINE</span>
      <div style="font-size:11px; color:#64748b; margin-top:6px; font-family:monospace;">Zero-Backend Single Page App</div>
    </div>
  </div>

  <div class="render-grid">
    <!-- LEFT: ASSETS -->
    <div class="render-box">
      <div class="render-title">1. Static Asset Package (/data/2026-11-15/)</div>
      
      <div class="card">
        <div class="node-title">manifest.json & schemas</div>
        <div class="node-sub">Strict Zod contracts validating hashes, bounding boxes, bounds, and scenario metadata.</div>
        <span class="node-tag">Integrity & Schema Safety</span>
      </div>

      <div class="card">
        <div class="node-title">terrain/heightmap.png (16-bit)</div>
        <div class="node-sub">High-precision elevation texture encoding DEM elevations for vertex displacement.</div>
        <span class="node-tag">Resolution: 15 m / pixel</span>
      </div>

      <div class="card">
        <div class="node-title">flood/anuga/v21_d12/ (PNG frames)</div>
        <div class="node-sub">49 hourly depth frames (0.65 MB). Normalized 8-bit depth maps (0 to 12 m max).</div>
        <span class="node-tag">Temporal Resolution: 1 hour</span>
      </div>

      <div class="card">
        <div class="node-title">vectors/*.geojson</div>
        <div class="node-sub">Strahler rivers, OSM villages (Muthul), road bridges, and reservoir perimeters.</div>
        <span class="node-tag">Vector Topologies</span>
      </div>
    </div>

    <!-- ARROW 1 -->
    <div class="arrow">➔</div>

    <!-- MIDDLE: GPU PIPELINE -->
    <div class="render-box">
      <div class="render-title">2. WebGL / GLSL GPU Pipeline</div>

      <div class="card" style="border-left: 3px solid #38bdf8;">
        <div class="node-title">terrain.vert.glsl (Vertex Shader)</div>
        <div class="node-sub">Displaces terrain grid mesh in real-time from 16-bit heightmap texture:</div>
        <div style="font-family:monospace; font-size:11px; color:#38bdf8; margin-top:6px; background:#0a1120; padding:6px; border-radius:4px;">
          z_world = texture2D(heightmap, uv).r * Z_scale;
        </div>
      </div>

      <div class="card" style="border-left: 3px solid #14b8a6;">
        <div class="node-title">terrain.frag.glsl (Fragment Shader)</div>
        <div class="node-sub">Interpolates consecutive hourly simulation frames (t_cur and t_next) based on scrubber:</div>
        <div style="font-family:monospace; font-size:11px; color:#14b8a6; margin-top:6px; background:#0a1120; padding:6px; border-radius:4px;">
          h = mix(h_frameA, h_frameB, fract(time));
        </div>
      </div>

      <div class="card" style="border-left: 3px solid #f59e0b;">
        <div class="node-title">Camera Choreography</div>
        <div class="node-sub">Automated smooth cinematic transitions across 9 acts via GSAP and lens-shift framing.</div>
        <span class="node-tag">Stage Framing & Pitch</span>
      </div>
    </div>

    <!-- ARROW 2 -->
    <div class="arrow">➔</div>

    <!-- RIGHT: VISUAL MODES -->
    <div class="render-box">
      <div class="render-title">3. Dual Visual Representations</div>

      <div class="card" style="border: 1px solid rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.05);">
        <div class="node-title" style="color: #fbbf24;">Mode A: "Bathtub" (HAND Model)</div>
        <div class="node-sub">Static level-set water fill. Rendered with an <b>amber-gold palette</b>, 2 m contour rings, and an analytical stipple grid.</div>
        <span class="node-tag" style="color: #fbbf24;">Fast lookup · No momentum</span>
      </div>

      <div class="card" style="border: 1px solid rgba(20, 184, 166, 0.4); background: rgba(20, 184, 166, 0.05);">
        <div class="node-title" style="color: #2dd4bf;">Mode B: "2D Physics" (ANUGA SWE)</div>
        <div class="node-sub">Dynamic shallow water flow. Rendered with a luminous <b>cyan-teal animated gradient</b>, wave front propagation, and velocity vectors.</div>
        <span class="node-tag" style="color: #2dd4bf;">Saint-Venant · Wave propagation</span>
      </div>

      <div class="card" style="border-left: 3px solid #818cf8;">
        <div class="node-title">Volume & Time Scrubbers</div>
        <div class="node-sub">Interactive controls enabling instant scenario switching (21, 50, 195 Mm³) and scrubbing through 48 h.</div>
        <span class="node-tag">Real-Time Client Interactivity</span>
      </div>
    </div>
  </div>
</div>
</body>
</html>
`;

// 4. Executive All-In-One Poster
const htmlDiag4 = `
<!DOCTYPE html>
<html>
<head><style>${commonCSS}
  .infographic-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .scenario-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
  .scenario-table th { background: #1e293b; color: #94a3b8; text-align: left; padding: 8px 10px; font-weight: 600; font-family: monospace; }
  .scenario-table td { border-bottom: 1px solid #1e293b; padding: 8px 10px; color: #f1f5f9; }
</style></head>
<body>
<div class="canvas" style="width: 1500px;">
  <div class="header">
    <div class="header-left">
      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <span class="badge">NASA SPACE APPS CHALLENGE 2026</span>
        <span class="badge badge-amber">TUNIS WINNER SUBMISSION</span>
        <span class="badge badge-blue">DANCING WITH SARS</span>
      </div>
      <h1 style="font-size:28px;">Dancing with Rivers · Scientific & Hydrodynamic Architecture</h1>
      <p style="font-size:14px;">Monitoring dam structural integrity and flood routing from space: NISAR, Sentinel-1, SWOT, and ANUGA 2D physics</p>
    </div>
    <div style="text-align:right;">
      <div style="font-size:18px; font-weight:700; color:#2dd4bf; font-family:monospace;">dancingwithrivers.study</div>
      <div style="font-size:11px; color:#64748b; margin-top:4px;">Mellègue Reservoir Failure Replay & National Dam Watch</div>
    </div>
  </div>

  <div class="infographic-grid">
    <!-- LEFT: SATELLITES & PIPELINE -->
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div class="card" style="border-left: 4px solid #14b8a6;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h2 style="font-size:14px; color:#2dd4bf; font-weight:700; text-transform:uppercase;">Spaceborne Observation Fusion</h2>
          <span class="badge" style="font-size:9px;">5 SATELLITE MISSIONS</span>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; font-size:11px;">
          <div style="background:#0a1120; padding:10px; border-radius:6px; border:1px solid #1e293b;">
            <b style="color:#f8fafc;">NISAR (NASA/ISRO)</b>
            <p style="color:#94a3b8; margin-top:3px;">L-band radar. Penetrates canopy, captures specular lake reflection.</p>
          </div>
          <div style="background:#0a1120; padding:10px; border-radius:6px; border:1px solid #1e293b;">
            <b style="color:#f8fafc;">Sentinel-1 (ESA)</b>
            <p style="color:#94a3b8; margin-top:3px;">10m C-SAR multi-year baseline for historical normal envelope.</p>
          </div>
          <div style="background:#0a1120; padding:10px; border-radius:6px; border:1px solid #1e293b;">
            <b style="color:#f8fafc;">SWOT KaRIn (NASA/CNES)</b>
            <p style="color:#94a3b8; margin-top:3px;">Water surface elevation (WSE) drop: 265 m to 253 m (Δh = 12 m).</p>
          </div>
          <div style="background:#0a1120; padding:10px; border-radius:6px; border:1px solid #1e293b;">
            <b style="color:#f8fafc;">GEM-15 DTM (Google)</b>
            <p style="color:#94a3b8; margin-top:3px;">15 m bare-earth elevation model for accurate hydraulic routing.</p>
          </div>
        </div>
      </div>

      <div class="card" style="border-left: 4px solid #38bdf8;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h2 style="font-size:14px; color:#38bdf8; font-weight:700; text-transform:uppercase;">Algorithmic Workflow (Pipeline 00 → 08)</h2>
          <span class="badge badge-blue" style="font-size:9px;">OFFLINE PYTHON</span>
        </div>
        <div style="font-size:11px; line-height:1.6; color:#cbd5e1;">
          <p><b>1. Drainage:</b> D8 single flow direction computes 44.9 km Reach 1 river centerline and HAND grid.</p>
          <p><b>2. SAR Water Extraction:</b> Bimodal Otsu thresholding identifies open water pixels (σ⁰ < -16.5 dB).</p>
          <p><b>3. Breach Anomaly:</b> Robust Z-score flags abrupt lake area loss (Z < -3.5) on 17–18 June 2026.</p>
          <p><b>4. Hypsometry:</b> V(z) = ∫ A(z')dz' confirms 21.0 Mm³ water volume released during the gate failure.</p>
        </div>
      </div>
    </div>

    <!-- RIGHT: ANUGA PHYSICS & VALIDATION -->
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div class="card" style="border-left: 4px solid #f59e0b;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <h2 style="font-size:14px; color:#fbbf24; font-weight:700; text-transform:uppercase;">2D Hydrodynamics: Validated Benchmarks</h2>
          <span class="badge badge-amber" style="font-size:9px;">69,616 TRIANGLE MESH</span>
        </div>
        <p style="font-size:11px; color:#94a3b8;">Saint-Venant 2D Shallow Water Equations solved with ANUGA finite-volume engine:</p>
        
        <table class="scenario-table">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Volume</th>
              <th>Max Extent</th>
              <th>Muthul Arrival</th>
              <th>Mass Balance Err</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b style="color:#2dd4bf;">v21_d12 (Reported)</b></td>
              <td>21 Mm³</td>
              <td>19.35 km²</td>
              <td>5.33 h</td>
              <td style="color:#10b981; font-family:monospace;">8.96 × 10⁻¹³</td>
            </tr>
            <tr>
              <td><b style="color:#fbbf24;">v50_d12 (Severe)</b></td>
              <td>50 Mm³</td>
              <td>35.45 km²</td>
              <td>4.00 h</td>
              <td style="color:#10b981; font-family:monospace;">4.40 × 10⁻¹³</td>
            </tr>
            <tr>
              <td><b style="color:#f87171;">v195_d12 (Total Breach)</b></td>
              <td>195 Mm³</td>
              <td>71.83 km²</td>
              <td>2.67 h</td>
              <td style="color:#10b981; font-family:monospace;">&lt; 10⁻¹²</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" style="border-left: 4px solid #a855f7;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h2 style="font-size:14px; color:#c084fc; font-weight:700; text-transform:uppercase;">Client Experience & Web Delivery</h2>
          <span class="badge" style="font-size:9px;">11.5 MB TOTAL BUNDLE</span>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; font-size:11px;">
          <div style="background:#0a1120; padding:10px; border-radius:6px; border:1px solid #1e293b;">
            <b style="color:#f8fafc;">Dual-Layer Visuals</b>
            <p style="color:#94a3b8; margin-top:2px;">Amber HAND stipple grid vs Cyan-Teal dynamic ANUGA depth ramp.</p>
          </div>
          <div style="background:#0a1120; padding:10px; border-radius:6px; border:1px solid #1e293b;">
            <b style="color:#f8fafc;">National Dam Watch</b>
            <p style="color:#94a3b8; margin-top:2px;">Generalised to 5 reservoirs across Tunisia: telemetry, alerts, and risk maps.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
</body>
</html>
`;

const DIAGRAMS = [
  { name: '01_system_architecture.png', html: htmlDiag1, w: 1480, h: 740 },
  { name: '02_pipeline_phases.png', html: htmlDiag2, w: 1480, h: 740 },
  { name: '03_web_layer_rendering.png', html: htmlDiag3, w: 1480, h: 720 },
  { name: '00_full_pipeline_infographic.png', html: htmlDiag4, w: 1580, h: 720 },
];

async function main() {
  console.log('Launching Chromium for high-resolution PNG rendering...');
  const browser = await chromium.launch();

  for (const diag of DIAGRAMS) {
    const page = await browser.newPage({
      viewport: { width: diag.w, height: diag.h },
      deviceScaleFactor: 2, // 2x Retina resolution
    });

    await page.setContent(diag.html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    const outPath = resolve(OUT_DIR, diag.name);
    await page.screenshot({ path: outPath, fullPage: true });
    console.log(`✓ Rendered: ${outPath} (${diag.w * 2}x${diag.h * 2} px)`);

    // Copy to artifact directory
    const artifactPath = resolve(ARTIFACT_DIR, diag.name);
    copyFileSync(outPath, artifactPath);
    console.log(`  ↳ Copied to Artifacts: ${artifactPath}`);

    await page.close();
  }

  await browser.close();
  console.log('All diagrams successfully rendered to PNG!');
}

main().catch(err => {
  console.error('Rendering error:', err);
  process.exit(1);
});
