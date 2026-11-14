#include height.glsl;

uniform sampler2D uBase;   // Sentinel-2 basemap (sRGB, decoded to linear by the sampler)
uniform sampler2D uHill;   // hillshade (linear data)
uniform sampler2D uWater;  // JRC water occurrence 0..1 (linear data)
uniform sampler2D uRadarA; // lake chip, "before" side of the swipe (db8, linear data)
uniform sampler2D uRadarB; // lake chip, current date
uniform sampler2D uMaskA;  // water masks of A / B
uniform sampler2D uMaskB;
uniform sampler2D uHand;   // HAND (M6)

uniform vec4 uLakeChipRect; // lake chip bounds in image UV (u0, v0, u1, v1)
uniform vec4 uOpacity;      // x basemap, y radar chip, z water mask, w contours
uniform float uSwipe;       // 0..1 screen x of the swipe line
uniform float uSwipeOn;     // 1 when two radar layers are compared
uniform float uNight;       // 0 day .. 1 night (Act 2)
uniform float uExag;
uniform float uHandH;       // flood height above nearest drainage, metres (0 = off)
uniform float uHandScale;   // HAND texel → metres
uniform float uTexelKm;     // heightmap texel size in km
uniform float uTime;
uniform vec2 uResolution;   // drawing-buffer size
uniform vec3 uSunDir;
uniform vec3 uHazeDay;
uniform vec3 uHazeNight;
uniform vec3 uWaterCol;
uniform vec3 uTeal;

varying vec2 vUv;
varying vec3 vWorld;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  // --- relief from height texel differences
  vec2 px = 1.0 / uHeightSize;
  float hC = heightAt(vUv);
  float hL = heightAt(vUv - vec2(px.x, 0.0));
  float hR = heightAt(vUv + vec2(px.x, 0.0));
  float hU = heightAt(vUv - vec2(0.0, px.y));
  float hD = heightAt(vUv + vec2(0.0, px.y));
  float k = uExag / 1000.0 / (2.0 * uTexelKm);
  vec3 n = normalize(vec3(-(hR - hL) * k, 1.0, -(hD - hU) * k));

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

  // --- 10 m lake chip (radar + water mask), swipe in screen space
  vec2 cuv = (vUv - uLakeChipRect.xy) / (uLakeChipRect.zw - uLakeChipRect.xy);
  vec2 edge = min(cuv, 1.0 - cuv);
  float inChip = step(0.0, min(edge.x, edge.y));
  if (inChip > 0.5) {
    float feather = smoothstep(0.0, 0.035, min(edge.x, edge.y));
    float sx = gl_FragCoord.x / uResolution.x;
    float side = mix(1.0, step(uSwipe, sx), uSwipeOn); // 0 = A (before), 1 = B (current)
    float r = mix(texture2D(uRadarA, cuv).r, texture2D(uRadarB, cuv).r, side);
    float mk = mix(texture2D(uMaskA, cuv).r, texture2D(uMaskB, cuv).r, side);
    vec3 rc = vec3(pow(r, 2.2)) * vec3(0.94, 1.0, 1.03);
    col = mix(col, rc, feather * uOpacity.y);
    col = mix(col, uWaterCol, mk * feather * uOpacity.z * 0.78);
    float lineW = 1.5 / uResolution.x;
    float sl = (1.0 - smoothstep(lineW, lineW * 2.0, abs(sx - uSwipe))) * uSwipeOn * max(uOpacity.y, uOpacity.z);
    col = mix(col, uTeal * 1.6, sl);
  }

  // --- HAND quick flood (wired in M6)
  if (uHandH > 0.0) {
    float hand = texture2D(uHand, vUv).r * uHandScale;
    float wet = 1.0 - smoothstep(uHandH - 0.5, uHandH + 0.5, hand);
    col = mix(col, uWaterCol, wet * 0.7);
  }

  // --- faint teal contour every 100 m
  float cv = hC / 100.0;
  float cd = abs(fract(cv - 0.5) - 0.5) / max(fwidth(cv), 1e-5);
  float line = (1.0 - smoothstep(0.0, 1.0, cd)) * (1.0 - smoothstep(6.0, 28.0, dist));
  col = mix(col, uTeal * 0.8, line * 0.10 * uOpacity.w * (1.0 - w));

  // --- night (Act 2): moonlit blue
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  vec3 nightCol = lum * vec3(0.20, 0.32, 0.62) * 0.55 + col * 0.05;
  col = mix(col, nightCol, uNight);

  // --- atmospheric haze with distance, and a soft fade at the edge of the data
  vec3 haze = mix(uHazeDay, uHazeNight, uNight);
  float f = 1.0 - exp(-dist * 0.011);
  col = mix(col, haze, clamp(f, 0.0, 1.0) * 0.92);
  vec2 be = min(vUv, 1.0 - vUv);
  col = mix(haze * 0.6, col, smoothstep(0.0, 0.03, min(be.x, be.y)));

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
