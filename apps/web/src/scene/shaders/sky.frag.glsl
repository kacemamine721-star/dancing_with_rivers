uniform vec3 uHazeDay;
uniform vec3 uHazeNight;
uniform vec3 uZenith;
uniform float uNight;
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  vec3 haze = mix(uHazeDay, uHazeNight, uNight);
  float h = smoothstep(-0.05, 0.55, d.y);
  vec3 col = mix(haze, uZenith, pow(h, 0.6));
  col = mix(col, haze * 0.6, smoothstep(0.0, -0.4, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
