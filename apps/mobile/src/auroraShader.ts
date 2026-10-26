/**
 * The aurora as SkSL for Skia's RuntimeEffect: slowly flowing silk lines over a hazy deep layer. Ripples (uEv) bend the lines and
 * light them, a heartbeat (uBeat) sweeps left to right, uWarm turns it amber, uDim darkens it when there is no data. Display only.
 */
export const AURORA_SKSL = `
uniform float2 uRes;
uniform float uT;
uniform float uWarm;
uniform float uDim;
uniform float uBeat;
uniform float4 uEv[8];

float hash(float2 p) { p = fract(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(float2 p) {
  float2 i = floor(p); float2 f = fract(p); float2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + float2(1, 0)), u.x), mix(hash(i + float2(0, 1)), hash(i + float2(1, 1)), u.x), u.y);
}
float fbm(float2 p) {
  float v = 0.; float a = .5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + float2(1.7, 9.2); a *= .5; }
  return v;
}

half4 main(float2 frag) {
  float2 uv = (frag - .5 * uRes) / min(uRes.x, uRes.y);
  uv.y = -uv.y;
  float t = uT;
  float lv = 1. - uWarm;
  float2 c = float2(0., .05);
  float hot = 0.; float cool = 0.; float flash = 0.; float2 warp = float2(0.);
  for (int i = 0; i < 8; i++) {
    float4 e = uEv[i];
    if (e.x >= 0.) {
      float d = length(uv - c); float r = e.x * 1.25;
      float x = (d - r) * 4.5; float w = exp(-x * x) * (1. - e.x);
      float2 dir = normalize(uv - c + float2(.0001));
      warp += dir * w * .035 * (1. + e.y * .8);
      if (e.y > .5) { hot += w; } else { cool += w; }
      flash += e.y * pow(1. - e.x, 3.) * step(e.x, .4);
    }
  }
  float2 p = uv + warp;
  float2 q = float2(fbm(p * float2(.9, 1.6) + float2(t * .05, 0.)), fbm(p * float2(.9, 1.6) + float2(5.2, 1.3) - float2(t * .04, 0.)));
  float r = fbm(p * float2(1., 1.8) + 2.2 * q + t * .03);
  float sw = (r - .5) * 3.2 + sin(p.x * 1.7 + t * .25) * .35;
  float ph1 = p.y * 7.5 + sw * 2.6 + t * .30;
  float ph2 = p.y * 13. + sw * 3.6 - t * .22 + 1.7;
  float glint = .45 + .9 * pow(.5 + .5 * sin(p.x * 3.2 - t * 1.4 + sw * 2.), 3.);
  float l1 = pow(1. - abs(sin(ph1)), 14.);
  float l2 = pow(1. - abs(sin(ph2)), 22.) * .65;
  float glow1 = pow(1. - abs(sin(ph1)), 3.) * .30;
  float line = (l1 + l2) * glint;
  float dph = p.y * 3.6 + fbm(p * float2(.7, 1.2) + 7.3) * 5. - t * .12;
  float far = pow(1. - abs(sin(dph)), 6.) * .35 + pow(1. - abs(sin(dph * 1.9 + .8)), 16.) * .2;
  float haze = fbm(p * float2(.6, .9) + t * .02 + 11.) * .5;
  float3 ground = float3(.010, .024, .030) + float3(0., .05, .06) * haze + float3(0., .02, .05) * smoothstep(-.4, .6, -uv.y);
  float3 deep = float3(.02, .24, .20); float3 mid = float3(.06, .62, .40);
  float3 lime = float3(.74, .97, .26); float3 amber = float3(.96, .70, .22);
  float hz = smoothstep(.25, .8, r + uv.x * .25);
  float3 hue = mix(mix(deep, mid, hz), mix(float3(.30, .20, .05), amber, hz), uWarm);
  float3 col = ground + float3(.03, .22, .30) * far * (.5 + .5 * lv) + hue * glow1 * 1.3 + hue * line * 1.15;
  col += mix(float3(.25, .85, .65), lime, hz) * (l1 + l2 * .7) * smoothstep(.45, 1., r + uv.x * .2) * .9 * lv;
  col += float3(.55, .95, .85) * pow(1. - abs(sin(ph1 + .18)), 30.) * .25 * lv;
  float bx = (frag.x / uRes.x - uBeat) * 13.; float band = exp(-bx * bx) * step(uBeat, 1.);
  col += mix(lime, float3(1.), .35) * line * band * 1.4 + hue * band * .18;
  col += lime * flash * .10 * (.4 + line) + lime * line * hot * 2.6 + lime * hot * .34
       + float3(.75, .95, 1.) * line * cool * 1.4 + float3(.35, .9, 1.) * cool * cool * .6;
  float core = exp(-length(uv - c) * 3.6);
  col += mix(amber * .5, lime * .55, lv) * core * .55 * (.3 + .7 * lv) + float3(1.) * exp(-length(uv - c) * 22.) * .5 * lv;
  col *= 1. - smoothstep(.25, 1.35, length(uv * float2(.9, .8)));
  col += (hash(frag + t) - .5) * .02;
  return half4(half3(col * uDim), 1.);
}
`;
