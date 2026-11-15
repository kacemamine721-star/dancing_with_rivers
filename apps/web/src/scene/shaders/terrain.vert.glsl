#include height.glsl;

uniform float uExag;
uniform float uZMin;
uniform float uTexelKm;

varying vec2 vUv;    // image UV: u from west, v from north
varying vec3 vWorld;
varying vec3 vN;     // surface normal (per vertex: the fragment shader no longer refetches 4 heights)
varying float vH;    // terrain height, metres (contours)

void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);
  float m = heightAt(vUv);
  // normal from the neighbouring heights, 1.5 texels apart (smoother than the mesh step on low tiers)
  vec2 px = 1.5 / uHeightSize;
  float hL = heightAt(vUv - vec2(px.x, 0.0));
  float hR = heightAt(vUv + vec2(px.x, 0.0));
  float hU = heightAt(vUv - vec2(0.0, px.y));
  float hD = heightAt(vUv + vec2(0.0, px.y));
  float k = uExag / 1000.0 / (2.0 * 1.5 * uTexelKm);
  vN = normalize(vec3(-(hR - hL) * k, 1.0, -(hD - hU) * k));
  vH = m;
  vec3 p = position;
  p.y = (m - uZMin) / 1000.0 * uExag;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
