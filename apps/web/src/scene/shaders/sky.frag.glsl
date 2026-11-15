uniform vec3 uHazeDay;
uniform vec3 uHazeNight;
uniform vec3 uZenith;
uniform float uNight;
varying vec3 vDir;

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  vec3 haze = mix(uHazeDay, uHazeNight, uNight);
  float h = smoothstep(-0.05, 0.55, d.y);
  vec3 col = mix(haze, uZenith, pow(h, 0.6));
  col = mix(col, haze * 0.6, smoothstep(0.0, -0.4, d.y));
  // night (Act 2): sparse stars above the horizon
  float st = step(0.9972, hash31(floor(d * 420.0))) * smoothstep(0.03, 0.3, d.y);
  col += vec3(0.80, 0.88, 1.0) * st * uNight * (0.5 + 0.5 * hash31(floor(d * 97.0)));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
