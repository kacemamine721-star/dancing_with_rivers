#include height.glsl;

uniform float uExag;
uniform float uZMin;

varying vec2 vUv; // image UV: u from west, v from north
varying vec3 vWorld;

void main() {
  vUv = vec2(uv.x, 1.0 - uv.y);
  float m = heightAt(vUv);
  vec3 p = position;
  p.y = (m - uZMin) / 1000.0 * uExag;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
