varying vec3 vDir;

void main() {
  vDir = position;
  // follow the camera: only the rotation part of the view matrix
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
