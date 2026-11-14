// RG16 heightmap decode (docs/03 §6.2): metres = (R·256 + G) · scale + offset, bytes R,G.
// The texture is NearestFilter / no mipmaps / NoColorSpace; bilinear filtering is done here on
// the decoded values (filtering the packed bytes would be wrong).
uniform sampler2D uHeight;
uniform vec2 uHeightSize;
uniform vec2 uHeightEnc; // (scale, offset)

float decodeHeight(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uHeightSize) - 1);
  vec4 t = texelFetch(uHeight, p, 0);
  return (floor(t.r * 255.0 + 0.5) * 256.0 + floor(t.g * 255.0 + 0.5)) * uHeightEnc.x + uHeightEnc.y;
}

// tuv: image UV (u from west, v from north)
float heightAt(vec2 tuv) {
  vec2 p = tuv * uHeightSize - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  ivec2 ip = ivec2(i);
  float a = decodeHeight(ip);
  float b = decodeHeight(ip + ivec2(1, 0));
  float c = decodeHeight(ip + ivec2(0, 1));
  float d = decodeHeight(ip + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
