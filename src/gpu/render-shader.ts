export const RENDER_WGSL = /* wgsl */ `
const LINE_COUNT: f32 = 255.0;
const SAMPLE_COUNT_F: f32 = 1024.0;

struct RenderUniforms {
  view: vec4<f32>, // backingWidth, backingHeight, displayedDepthMm, maxSimDepthMm
  geo: vec4<f32>,  // probeType, halfAngleRad, curvatureMm, probeWidthMm
  img: vec4<f32>,  // gainDb, focusMm, dynamicRangeDb, speckleMix
  tgc: array<vec4<f32>, 2>,
};

@group(0) @binding(0) var<uniform> u: RenderUniforms;
@group(0) @binding(1) var<storage, read> lineBuffer: array<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-3.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(positions[vertexIndex], 0.0, 1.0);
}

fn loadSample(lineIndex: f32, sampleIndex: f32) -> f32 {
  let li = clamp(i32(lineIndex), 0, 255);
  let si = clamp(i32(sampleIndex), 0, 1023);
  return lineBuffer[u32(li) * 1024u + u32(si)];
}

fn sampleLines(lineCoord: f32, axialMm: f32) -> f32 {
  let sampleF = clamp(axialMm / u.view.w * SAMPLE_COUNT_F - 0.5, 0.0, 1023.0);
  let s0 = floor(sampleF);
  let sf = fract(sampleF);

  let l0 = floor(lineCoord);
  let lf = fract(lineCoord);

  let v00 = loadSample(l0, s0);
  let v01 = loadSample(l0, s0 + 1.0);
  let v10 = loadSample(l0 + 1.0, s0);
  let v11 = loadSample(l0 + 1.0, s0 + 1.0);
  let a = mix(v00, v01, sf);
  let b = mix(v10, v11, sf);
  return mix(a, b, lf);
}

fn tgcAt(axialMm: f32) -> f32 {
  let segment = clamp(axialMm / max(u.view.z, 1.0), 0.0, 0.999) * 8.0;
  let index = i32(floor(segment));
  let f = fract(segment);
  var a = 0.0;
  var b = 0.0;
  if (index < 4) {
    a = u.tgc[0][u32(index)];
  } else {
    a = u.tgc[1][u32(index - 4)];
  }
  let next = min(index + 1, 7);
  if (next < 4) {
    b = u.tgc[0][u32(next)];
  } else {
    b = u.tgc[1][u32(next - 4)];
  }
  return mix(a, b, f);
}

fn geometryToLine(xMm: f32, yMm: f32) -> vec2<f32> {
  let probeType = i32(u.geo.x + 0.5);
  let halfAngle = max(u.geo.y, 0.01);

  if (probeType == 0) {
    if (yMm < 0.0 || yMm > u.view.z || abs(xMm) > u.geo.w * 0.5) {
      return vec2<f32>(-1000.0, yMm);
    }
    let lineCoord = (xMm / u.geo.w + 0.5) * LINE_COUNT;
    return vec2<f32>(lineCoord, yMm);
  }

  if (probeType == 2) {
    let axial = length(vec2<f32>(xMm, max(yMm, 0.0)));
    let angle = atan2(xMm, max(yMm, 0.001));
    if (yMm < 0.0 || axial > u.view.z || abs(angle) > halfAngle) {
      return vec2<f32>(-1000.0, axial);
    }
    let lineCoord = (angle / halfAngle * 0.5 + 0.5) * LINE_COUNT;
    return vec2<f32>(lineCoord, axial);
  }

  let radius = max(u.geo.z, 10.0);
  let yy = yMm + radius;
  let radial = length(vec2<f32>(xMm, yy));
  let axial = radial - radius;
  let angle = atan2(xMm, yy);
  if (axial < -0.35 || axial > u.view.z || abs(angle) > halfAngle) {
    return vec2<f32>(-1000.0, axial);
  }
  let lineCoord = (angle / halfAngle * 0.5 + 0.5) * LINE_COUNT;
  return vec2<f32>(lineCoord, max(axial, 0.0));
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let mmPerPixel = u.view.z / max(u.view.y, 1.0);
  let xMm = (position.x - u.view.x * 0.5) * mmPerPixel;

  let probeType = i32(u.geo.x + 0.5);
  let topPad = select(0.0, u.geo.z * (1.0 - cos(u.geo.y)), probeType == 1);
  let yMm = position.y * mmPerPixel - topPad;

  let geometry = geometryToLine(xMm, yMm);
  let lineCoord = geometry.x;
  let axial = geometry.y;
  if (lineCoord < 0.0) {
    return vec4<f32>(0.015, 0.018, 0.022, 1.0);
  }

  // 焦点处声束最窄，离焦后横向 PSF 变宽；参数变化不需要重跑声学追踪。
  let beamMm = 1.05 + abs(axial - u.img.y) * 0.032 + axial * 0.004;
  var lineSigma = beamMm / max(u.geo.w / 255.0, 0.08);
  if (probeType != 0) {
    let angularWidth = beamMm / max(axial, 8.0);
    lineSigma = angularWidth / max(u.geo.y, 0.01) * 127.5;
  }
  lineSigma = clamp(lineSigma, 0.35, 5.0);

  var value = 0.0;
  let offsets = array<f32, 3>(-1.0, 0.0, 1.0);
  let weights = array<f32, 3>(0.25, 0.50, 0.25);
  for (var i: i32 = 0; i < 3; i = i + 1) {
    let lc = lineCoord + offsets[i] * lineSigma * 0.62;
    let a = sampleLines(lc, axial - 0.42);
    let b = sampleLines(lc, axial);
    let c = sampleLines(lc, axial + 0.42);
    value = value + weights[i] * (a * 0.24 + b * 0.52 + c * 0.24);
  }

  // 界面/探头间往返反射：一次回波在 2z、3z 深度形成衰减重复像。
  let repeat2 = sampleLines(lineCoord, axial * 0.5);
  let repeat3 = sampleLines(lineCoord, axial / 3.0);
  value = value + 0.22 * repeat2 * smoothstep(0.004, 0.06, repeat2);
  value = value + 0.08 * repeat3 * smoothstep(0.004, 0.05, repeat3);

  let db = 20.0 * log(max(value, 0.000001)) / log(10.0) + u.img.x + tgcAt(axial);
  let dynamicRange = max(u.img.z, 20.0);
  var gray = clamp((db + dynamicRange * 0.82) / dynamicRange, 0.0, 1.0);
  gray = pow(gray, 0.92);

  let tint = vec3<f32>(gray * 0.96, gray, gray * 1.04);
  return vec4<f32>(tint, 1.0);
}
`
