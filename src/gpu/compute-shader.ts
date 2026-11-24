export const LINE_COUNT = 256
export const SAMPLE_COUNT = 1024
export const MAX_SIM_DEPTH_MM = 180

export const COMPUTE_WGSL = /* wgsl */ `
const LINE_COUNT: u32 = 256u;
const SAMPLE_COUNT: u32 = 1024u;

struct SimUniforms {
  origin: vec4<f32>,
  dir: vec4<f32>,
  lateral: vec4<f32>,
  elevational: vec4<f32>,
  spacing: vec4<f32>,
  dims: vec4<f32>,
  geo: vec4<f32>,
  points: array<vec4<f32>, 8>,
};

struct Material {
  impedance: f32,
  attenuation: f32,
  scatter: f32,
};

@group(0) @binding(0) var<uniform> u: SimUniforms;
@group(0) @binding(1) var huTex: texture_3d<u32>;
@group(0) @binding(2) var<storage, read_write> lineBuffer: array<f32>;

fn loadHu(c: vec3<i32>) -> f32 {
  let lo = vec3<i32>(0, 0, 0);
  let hi = vec3<i32>(i32(u.dims.x) - 1, i32(u.dims.y) - 1, i32(u.dims.z) - 1);
  let safe = clamp(c, lo, hi);
  return f32(textureLoad(huTex, safe, 0).x) - 1024.0;
}

fn sampleHu(world: vec3<f32>) -> f32 {
  let idx = world / u.spacing.xyz - vec3<f32>(0.5);
  let i0 = vec3<i32>(floor(idx));
  let f = fract(idx);

  let h000 = loadHu(i0 + vec3<i32>(0, 0, 0));
  let h100 = loadHu(i0 + vec3<i32>(1, 0, 0));
  let h010 = loadHu(i0 + vec3<i32>(0, 1, 0));
  let h110 = loadHu(i0 + vec3<i32>(1, 1, 0));
  let h001 = loadHu(i0 + vec3<i32>(0, 0, 1));
  let h101 = loadHu(i0 + vec3<i32>(1, 0, 1));
  let h011 = loadHu(i0 + vec3<i32>(0, 1, 1));
  let h111 = loadHu(i0 + vec3<i32>(1, 1, 1));

  let x00 = mix(h000, h100, f.x);
  let x10 = mix(h010, h110, f.x);
  let x01 = mix(h001, h101, f.x);
  let x11 = mix(h011, h111, f.x);
  let y0 = mix(x00, x10, f.y);
  let y1 = mix(x01, x11, f.y);
  return mix(y0, y1, f.z);
}

fn materialAt(hu: f32) -> Material {
  var p0 = u.points[0];
  if (hu <= p0.x) {
    return Material(p0.y, p0.z, p0.w);
  }
  for (var i: i32 = 0; i < 7; i = i + 1) {
    let a = u.points[i];
    let b = u.points[i + 1];
    if (hu <= b.x) {
      let span = max(b.x - a.x, 0.0001);
      let t = clamp((hu - a.x) / span, 0.0, 1.0);
      return Material(mix(a.y, b.y, t), mix(a.z, b.z, t), mix(a.w, b.w, t));
    }
  }
  let last = u.points[7];
  return Material(last.y, last.z, last.w);
}

fn hashLattice(p: vec3<i32>) -> f32 {
  var q = bitcast<vec3<u32>>(p);
  q = q * vec3<u32>(1664525u, 2246822519u, 3266489917u);
  let h = (q.x ^ q.y ^ q.z) * 1103515245u + 12345u;
  return f32(h) / 4294967295.0;
}

fn valueNoise(p: vec3<f32>) -> f32 {
  let i = vec3<i32>(floor(p));
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);

  let n000 = hashLattice(i + vec3<i32>(0, 0, 0));
  let n100 = hashLattice(i + vec3<i32>(1, 0, 0));
  let n010 = hashLattice(i + vec3<i32>(0, 1, 0));
  let n110 = hashLattice(i + vec3<i32>(1, 1, 0));
  let n001 = hashLattice(i + vec3<i32>(0, 0, 1));
  let n101 = hashLattice(i + vec3<i32>(1, 0, 1));
  let n011 = hashLattice(i + vec3<i32>(0, 1, 1));
  let n111 = hashLattice(i + vec3<i32>(1, 1, 1));

  let x00 = mix(n000, n100, s.x);
  let x10 = mix(n010, n110, s.x);
  let x01 = mix(n001, n101, s.x);
  let x11 = mix(n011, n111, s.x);
  let y0 = mix(x00, x10, s.y);
  let y1 = mix(x01, x11, s.y);
  return mix(y0, y1, s.z);
}

// 噪声场锁定在 CT 世界坐标，探头移动时采样位置连续变化，不会逐帧换随机种子。
fn coherentSpeckle(p: vec3<f32>) -> f32 {
  let n1 = valueNoise(p * 2.35 + vec3<f32>(11.7, 4.1, 7.3));
  let n2 = valueNoise(p * 5.8 + vec3<f32>(3.2, 19.1, 1.7));
  let n = n1 * 0.68 + n2 * 0.32;
  return clamp(pow(abs(n * 2.0 - 1.0), 0.72) * 1.35, 0.0, 1.6);
}

@compute @workgroup_size(16, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let lineId = gid.x;
  if (lineId >= LINE_COUNT) {
    return;
  }

  let fi = f32(lineId) / 255.0;
  let sideCoord = fi * 2.0 - 1.0;
  let probeType = i32(u.geo.x + 0.5);
  let halfAngle = u.geo.y;
  let curvature = max(u.geo.z, 1.0);
  let frequency = max(u.geo.w, 0.5);
  let stepMm = u.spacing.w;

  var origin = u.origin.xyz;
  var rayDir = normalize(u.dir.xyz);

  if (probeType == 0) {
    let halfWidth = max(u.elevational.w, 4.0) * 0.5;
    origin = origin + u.lateral.xyz * (sideCoord * halfWidth);
  } else if (probeType == 2) {
    let angle = sideCoord * halfAngle;
    rayDir = normalize(u.dir.xyz * cos(angle) + u.lateral.xyz * sin(angle));
  } else {
    let angle = sideCoord * halfAngle;
    let radial = normalize(u.dir.xyz * cos(angle) + u.lateral.xyz * sin(angle));
    let arcCenter = u.origin.xyz - u.dir.xyz * curvature;
    origin = arcCenter + radial * curvature;
    rayDir = radial;
  }

  var impedancePrev = materialAt(sampleHu(origin)).impedance;
  var transmission = 1.0;
  var oneWayAttenuation = 1.0;
  let baseIndex = lineId * SAMPLE_COUNT;

  for (var s: u32 = 0u; s < SAMPLE_COUNT; s = s + 1u) {
    let nextDistance = f32(s + 1u) * stepMm;
    let nextWorld = origin + rayDir * nextDistance;
    let nextMaterial = materialAt(sampleHu(nextWorld));
    let impedanceNext = nextMaterial.impedance;

    let reflection = (impedanceNext - impedancePrev) /
      (impedanceNext + impedancePrev + 0.00001);
    let absReflection = clamp(abs(reflection), 0.0, 0.985);

    let cellDb = nextMaterial.attenuation * frequency * (stepMm / 10.0);
    let cellAttenuation = pow(10.0, -cellDb / 20.0);
    oneWayAttenuation = oneWayAttenuation * cellAttenuation;

    let incident = transmission * oneWayAttenuation;
    let interfaceEcho = incident * absReflection * oneWayAttenuation;

    let midWorld = origin + rayDir * (f32(s) + 0.5) * stepMm;
    let speckle = coherentSpeckle(midWorld);
    let scatterAmplitude = nextMaterial.scatter * speckle * 0.20;
    let scatterEcho = incident * scatterAmplitude * oneWayAttenuation;

    // 强衰减/高反射组织让 incident 快速下降，自然形成声影；
    // 低衰减液体保留后方声能，经 TGC 后形成后方回声增强。
    let value = max(interfaceEcho, scatterEcho);
    lineBuffer[baseIndex + s] = clamp(value, 0.0, 1.0);

    transmission = transmission * sqrt(max(0.015, 1.0 - reflection * reflection));
    impedancePrev = impedanceNext;
  }
}
`
