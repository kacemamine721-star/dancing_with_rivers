#include height.glsl;

uniform sampler2D uBase;   // Sentinel-2 basemap (sRGB, decoded to linear by the sampler)
uniform sampler2D uHill;   // hillshade (linear data)
uniform sampler2D uWater;  // JRC water occurrence 0..1 (linear data)
uniform sampler2D uRadarA; // lake chip, "before" side of the swipe (db8, linear data)
uniform sampler2D uRadarB; // lake chip, current date
uniform sampler2D uMaskA;  // water masks of A / B
uniform sampler2D uMaskB;
uniform sampler2D uHand;   // HAND, metres (half float; outside the corridor = 9999)
uniform sampler2D uFloodMax;          // ANUGA max depth, crop of the scene grid (r8)
uniform highp sampler2DArray uFloodFrames; // ANUGA depth frames, same crop (r8, one layer per frame)
uniform sampler2D uCrop;   // irrigated cropland mask (rasterised polygons)

uniform vec4 uLakeChipRect; // lake chip bounds in image UV (u0, v0, u1, v1)
uniform vec4 uOpacity;      // x basemap, y radar chip, z water mask, w contours
uniform float uSwipe;       // 0..1 screen x of the swipe line
uniform float uSwipeOn;     // 1 when two radar layers are compared
uniform float uNight;       // 0 day .. 1 night (Act 2)
uniform float uExag;
uniform float uHandH;       // flood height above nearest drainage, metres (0 = off)
uniform float uHandScale;   // HAND texel → metres
uniform float uFloodOn;     // 0..1 flood layer opacity
uniform float uFloodMode;   // 0 HAND bathtub, 1 ANUGA depth
uniform vec4 uFloodRect;    // ANUGA crop in image UV (u0, v0, u1, v1)
uniform float uFloodScale;  // ANUGA byte → metres
uniform float uFloodT;      // ANUGA playhead, fractional frame index
uniform float uFloodN;      // ANUGA frame count
uniform float uFloodAnim;   // 0 = max-depth envelope, 1 = animated frames
uniform vec3 uRamp[4];      // ANUGA depth ramp colours (floodRamp.ts ANUGA_RAMP)
uniform vec4 uRampStops;    // their depths, m (the last = 8 m, where the rasters clip)
uniform vec3 uHandRamp[3];  // HAND ramp colours (floodRamp.ts HAND_RAMP)
uniform vec3 uHandStops;    // their depths, m
uniform float uCropOn;
uniform vec3 uCropCol;
uniform float uTexelKm;     // heightmap texel size in km
uniform float uTime;
uniform vec2 uResolution;   // drawing-buffer size
uniform vec3 uSunDir;
uniform vec3 uHazeDay;
uniform vec3 uHazeNight;
uniform vec3 uWaterCol;
uniform vec3 uTeal;

uniform float uFloodGlow;   // shoreline / wave-front emphasis (1 = full; 0.6 on low tier)

varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vN;
varying float vH;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 floodRamp(float d) {
  vec3 c = mix(uRamp[0], uRamp[1], smoothstep(uRampStops.x, uRampStops.y, d));
  c = mix(c, uRamp[2], smoothstep(uRampStops.y, uRampStops.z, d));
  return mix(c, uRamp[3], smoothstep(uRampStops.z, uRampStops.w, d)); // ≥ 8 m: one class
}

/** Moving light streaks on flood water (world km): reads as flowing water, not paint. */
float sheen(vec3 w, float speed) {
  float a = sin(w.x * 7.0 + w.z * 4.0 - uTime * 2.2 * speed);
  float b = sin(w.x * 3.1 - w.z * 8.3 - uTime * 1.3 * speed);
  return smoothstep(0.35, 0.95, a * b);
}

void main() {
  vec3 n = normalize(vN);
  float hC = vH;

  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);

  // --- basemap × hillshade, low NW sun
  vec3 base = texture2D(uBase, vUv).rgb;
  float hs = texture2D(uHill, vUv).r;
  float lam = max(dot(n, uSunDir), 0.0);
  float shade = mix(0.45 + 0.85 * hs, 0.30 + 1.25 * lam, 0.55);
  vec3 col = base * shade * 1.35 * uOpacity.x + vec3(0.012, 0.016, 0.022) * (1.0 - uOpacity.x);
  // warm light on sun-facing slopes, cool shadows
  col *= mix(vec3(0.80, 0.90, 1.08), vec3(1.10, 1.02, 0.90), smoothstep(0.15, 0.75, lam));

  // --- open water (JRC occurrence): dark with a fresnel sky sheen and sparse glints
  float w = smoothstep(0.45, 0.65, texture2D(uWater, vUv).r);
  float fr = pow(1.0 - max(V.y, 0.0), 4.0);
  float glint = step(0.985, hash21(floor(vUv * uHeightSize * 2.0) + floor(uTime * 3.0))) * smoothstep(0.2, 0.7, fr);
  vec3 wc = mix(vec3(0.010, 0.030, 0.065), vec3(0.30, 0.52, 0.70), fr) + vec3(0.9, 0.95, 1.0) * glint * 0.6;
  col = mix(col, wc, w * 0.9);

  // --- 10 m lake chip (radar + water mask), swipe in screen space, thin teal frame like a data tile
  vec2 cuv = (vUv - uLakeChipRect.xy) / (uLakeChipRect.zw - uLakeChipRect.xy);
  vec2 edge = min(cuv, 1.0 - cuv);
  float inChip = step(0.0, min(edge.x, edge.y));
  if (inChip > 0.5) {
    float feather = smoothstep(0.0, 0.02, min(edge.x, edge.y));
    float sx = gl_FragCoord.x / uResolution.x;
    float side = mix(1.0, step(uSwipe, sx), uSwipeOn); // 0 = A (before), 1 = B (current)
    float r = mix(texture2D(uRadarA, cuv).r, texture2D(uRadarB, cuv).r, side);
    float mk = mix(texture2D(uMaskA, cuv).r, texture2D(uMaskB, cuv).r, side);
    vec3 rc = vec3(pow(r, 2.2)) * vec3(0.94, 1.0, 1.03) * 1.15;
    col = mix(col, rc, feather * uOpacity.y);
    col = mix(col, uWaterCol, mk * feather * uOpacity.z * 0.78);
    float lineW = 1.5 / uResolution.x;
    float sl = (1.0 - smoothstep(lineW, lineW * 2.0, abs(sx - uSwipe))) * uSwipeOn * max(uOpacity.y, uOpacity.z);
    col = mix(col, uTeal * 1.6, sl);
  }
  vec2 cfw = max(fwidth(cuv), vec2(1e-6));
  float frameD = min(abs(edge.x) / cfw.x, abs(edge.y) / cfw.y);
  float inBand = step(-0.02, min(edge.x, edge.y));
  col = mix(col, uTeal, (1.0 - smoothstep(0.0, 1.3, frameD)) * inBand * uOpacity.y * 0.55);

  // --- irrigated cropland, summer 2026 (fill + crisp polygon edge)
  if (uCropOn > 0.001) {
    float cm = texture2D(uCrop, vUv).r;
    float ce = clamp(fwidth(cm) * 1.6, 0.0, 1.0);
    col = mix(col, uCropCol * 0.55, cm * 0.38 * uCropOn);
    col = mix(col, uCropCol, ce * 0.8 * uCropOn);
  }

  // --- flood: HAND bathtub (amber, still, stippled) or ANUGA depth (blue ramp, flowing, wave front).
  // Shorelines come from the depth field's screen derivative, so they stay 1–2 px crisp at any
  // distance, and a soft halo keeps a 200 m wide flood readable from 40 km away.
  float fmask = 0.0; // flood pixels keep more of their colour through the haze
  if (uFloodOn > 0.001) {
    if (uFloodMode < 0.5) {
      float hand = min(texture2D(uHand, vUv).r * uHandScale, 60.0); // outside the corridor = 9999 m
      float on = smoothstep(0.0, 0.05, uHandH);
      float depth = uHandH - hand;
      float fw = max(fwidth(depth), 1e-4);
      float wet = smoothstep(-0.5, 0.5, depth / fw) * on;
      float d = max(depth, 0.0);
      vec3 handDeep = uHandRamp[2];
      vec3 handCol = mix(uHandRamp[0], uHandRamp[1], smoothstep(uHandStops.x, uHandStops.y, d));
      handCol      = mix(handCol,      handDeep,     smoothstep(uHandStops.y, uHandStops.z, d));
      float sh = 0.92 + 0.12 * sheen(vWorld, 0.35);
      col = mix(col, handCol * sh, wet * 0.88 * uFloodOn);
      // stipple: a static estimate, not a simulation
      float grid = step(0.72, fract(vUv.x * 420.0)) * step(0.72, fract(vUv.y * 420.0));
      col = mix(col, handDeep * 0.7, grid * wet * 0.16 * uFloodOn);
      float shore = (1.0 - smoothstep(0.0, 1.6, abs(depth) / fw)) * on;
      col = mix(col, vec3(1.0, 0.88, 0.55) * 1.7, shore * 0.85 * uFloodOn * uFloodGlow);
      float halo = exp(-max(-depth, 0.0) / fw / 4.0) * (1.0 - wet) * on;
      col += vec3(1.0, 0.62, 0.18) * halo * 0.30 * uFloodOn * uFloodGlow;
      fmask = max(wet, max(shore, halo)) * uFloodOn;
    } else {
      vec2 fuv = (vUv - uFloodRect.xy) / (uFloodRect.zw - uFloodRect.xy);
      if (fuv.x >= 0.0 && fuv.y >= 0.0 && fuv.x <= 1.0 && fuv.y <= 1.0) {
        float dmax = texture2D(uFloodMax, fuv).r * 255.0 * uFloodScale;
        float depth = dmax;
        float front = 0.0;
        if (uFloodAnim > 0.001) {
          float i0 = floor(uFloodT);
          float i1 = min(i0 + 1.0, uFloodN - 1.0);
          float a = texture(uFloodFrames, vec3(fuv, i0)).r;
          float b = texture(uFloodFrames, vec3(fuv, i1)).r;
          float now = mix(a, b, uFloodT - i0) * 255.0 * uFloodScale;
          // where the water was ~2 frames ago: the band in between is the advancing front
          float tp = max(uFloodT - 2.0, 0.0);
          float p0 = floor(tp);
          float pa = texture(uFloodFrames, vec3(fuv, p0)).r;
          float pb = texture(uFloodFrames, vec3(fuv, min(p0 + 1.0, uFloodN - 1.0))).r;
          float prev = mix(pa, pb, tp - p0) * 255.0 * uFloodScale;
          depth = mix(dmax, now, uFloodAnim);
          front = (1.0 - smoothstep(0.06, 0.2, prev)) * step(0.5, uFloodT) * uFloodAnim;
        }
        float fw = max(fwidth(depth), 1e-4);
        float wet = smoothstep(-0.5, 0.5, (depth - 0.1) / fw);
        float d = max(depth, 0.0);
        // ghost of the peak extent: a thin line showing where the water will reach
        float fwm = max(fwidth(dmax), 1e-4);
        float envelope = (1.0 - smoothstep(0.0, 1.3, abs(dmax - 0.1) / fwm)) * uFloodAnim * (1.0 - wet);
        col = mix(col, uRamp[0], envelope * 0.55 * uFloodOn);
        float sh = 0.90 + 0.35 * sheen(vWorld, 1.0);
        col = mix(col, floodRamp(d) * sh, wet * 0.9 * uFloodOn);
        float shore = 1.0 - smoothstep(0.0, 1.6, abs(depth - 0.1) / fw);
        col = mix(col, uRamp[0] * 1.8, shore * 0.85 * uFloodOn * uFloodGlow);
        float halo = exp(-max(0.1 - depth, 0.0) / fw / 4.0) * (1.0 - wet);
        col += uRamp[1] * halo * 0.35 * uFloodOn * uFloodGlow;
        float pulse = 0.75 + 0.25 * sin(uTime * 6.0);
        col = mix(col, vec3(0.85, 1.0, 1.0) * 2.2 * pulse, front * wet * 0.8 * uFloodOn * uFloodGlow);
        fmask = max(wet, max(shore, halo)) * uFloodOn;
      }
    }
  }

  // --- faint teal contour every 100 m
  float cv = hC / 100.0;
  float cd = abs(fract(cv - 0.5) - 0.5) / max(fwidth(cv), 1e-5);
  float line = (1.0 - smoothstep(0.0, 1.0, cd)) * (1.0 - smoothstep(6.0, 28.0, dist));
  col = mix(col, uTeal * 0.8, line * 0.10 * uOpacity.w * (1.0 - w));

  // --- night (Act 2): moonlit blue
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  vec3 nightCol = lum * vec3(0.20, 0.32, 0.62) * 0.55 + col * 0.05;
  vec3 moonDir = normalize(vec3(0.45, 0.42, -0.55));
  float moon = pow(max(dot(reflect(-moonDir, vec3(0.0, 1.0, 0.0)), V), 0.0), 18.0);
  nightCol += vec3(0.55, 0.68, 0.95) * moon * w * 0.9 + vec3(0.05, 0.08, 0.16) * fr * w;
  col = mix(col, nightCol, uNight);

  // --- atmospheric haze with distance, and a soft fade at the edge of the data
  vec3 haze = mix(uHazeDay, uHazeNight, uNight);
  float f = 1.0 - exp(-dist * 0.011);
  col = mix(col, haze, clamp(f, 0.0, 1.0) * 0.92 * (1.0 - 0.65 * fmask));
  vec2 be = min(vUv, 1.0 - vUv);
  col = mix(haze * 0.6, col, smoothstep(0.0, 0.03, min(be.x, be.y)));

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
