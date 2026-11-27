import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Html, QuadraticBezierLine, RoundedBox } from "@react-three/drei"
import * as THREE from "three"
import { BOARD, type SceneLabels, type Shot, type Vec3 } from "./shots"

/**
 * A small island homestay at blue hour: modern villa, pool, palms, a jetty with lanterns,
 * sitting in an animated lagoon. Built from primitives + procedural textures (no assets).
 *
 * Interaction: the cursor is projected onto the sea — the water ripples where it passes and
 * a warm glow follows it; lanterns and windows near the cursor light up.
 * Camera: interpolates between `shots` by the deck's scroll `progress` (float slide index).
 */

const ISLAND_SCALE = 0.6
const SUN = new THREE.Vector3(-0.62, 0.07, -0.78).normalize()
const RIPPLES = 12

/* ------------------------------------------------------------------ shared cursor state */

interface CursorState {
  ndc: THREE.Vector2
  inside: boolean
  point: THREE.Vector3
  on: number
  ripples: THREE.Vector4[]
  next: number
  lastSpawn: THREE.Vector3
  lastSpawnAt: number
}

function makeCursor(): CursorState {
  return {
    ndc: new THREE.Vector2(0, 0),
    inside: false,
    point: new THREE.Vector3(0, 0, 50),
    on: 0,
    ripples: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0)),
    next: 0,
    lastSpawn: new THREE.Vector3(0, 0, 999),
    lastSpawnAt: 0,
  }
}

/* ------------------------------------------------------------------ procedural textures */

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvasTexture(size: number, repeat: [number, number], draw: (ctx: CanvasRenderingContext2D, r: () => number) => void, seed = 1) {
  const c = document.createElement("canvas")
  c.width = c.height = size
  const ctx = c.getContext("2d")!
  draw(ctx, rng(seed))
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(...repeat)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

function speckle(base: string, tones: string[], count: number, maxSize: number) {
  return (ctx: CanvasRenderingContext2D, r: () => number) => {
    const s = ctx.canvas.width
    ctx.fillStyle = base
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = 0.08 + r() * 0.25
      ctx.fillStyle = tones[Math.floor(r() * tones.length)]
      const w = 0.5 + r() * maxSize
      ctx.fillRect(r() * s, r() * s, w, w)
    }
    ctx.globalAlpha = 1
  }
}

function useTextures() {
  return useMemo(() => {
    const wood = canvasTexture(256, [1, 1], (ctx, r) => {
      const s = ctx.canvas.width
      for (let x = 0; x < s; x++) {
        const l = 34 + Math.sin(x * 0.09) * 4 + Math.sin(x * 0.37) * 2 + r() * 5
        ctx.fillStyle = `hsl(26, 42%, ${l}%)`
        ctx.fillRect(x, 0, 1, s)
      }
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = 0.15
        ctx.fillStyle = "#3b2414"
        ctx.fillRect(r() * s, 0, 1, s)
      }
      ctx.globalAlpha = 1
    }, 3)
    const plaster = canvasTexture(256, [2, 2], speckle("#ece7de", ["#d9d2c6", "#ffffff", "#cfc7ba"], 5000, 2), 5)
    const sand = canvasTexture(256, [6, 6], speckle("#e2cfa4", ["#cdb68a", "#f3e4c2", "#b89f74"], 9000, 1.6), 7)
    const grass = canvasTexture(256, [5, 5], (ctx, r) => {
      const s = ctx.canvas.width
      ctx.fillStyle = "#4e7a45"
      ctx.fillRect(0, 0, s, s)
      for (let i = 0; i < 7000; i++) {
        ctx.globalAlpha = 0.25 + r() * 0.35
        ctx.strokeStyle = ["#5f8f4f", "#3f6838", "#6f9c58", "#47713f"][Math.floor(r() * 4)]
        const x = r() * s
        const y = r() * s
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + (r() - 0.5) * 2, y - 2 - r() * 3)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }, 11)
    const gravel = canvasTexture(128, [3, 3], speckle("#8f8a82", ["#6f6a62", "#b0aaa0", "#7d776e"], 3000, 2.5), 13)
    const solar = canvasTexture(128, [1, 1], (ctx) => {
      const s = ctx.canvas.width
      ctx.fillStyle = "#14203a"
      ctx.fillRect(0, 0, s, s)
      ctx.strokeStyle = "#5d7194"
      ctx.lineWidth = 1
      for (let i = 0; i <= 6; i++) {
        ctx.beginPath()
        ctx.moveTo((i * s) / 6, 0)
        ctx.lineTo((i * s) / 6, s)
        ctx.moveTo(0, (i * s) / 4)
        ctx.lineTo(s, (i * s) / 4)
        ctx.stroke()
      }
    })
    return { wood, plaster, sand, grass, gravel, solar }
  }, [])
}

/* ------------------------------------------------------------------ sky + sea shaders */

const SKY_GLSL = /* glsl */ `
uniform vec3 uSun;
vec3 skyColor(vec3 d) {
  float y = d.y;
  vec3 top = vec3(0.010, 0.022, 0.065);
  vec3 mid = vec3(0.045, 0.090, 0.210);
  vec3 hor = vec3(0.900, 0.420, 0.220);
  vec3 c = mix(hor, mid, smoothstep(-0.02, 0.24, y));
  c = mix(c, top, smoothstep(0.24, 0.85, y));
  float s = max(dot(normalize(d), uSun), 0.0);
  c += vec3(1.0, 0.42, 0.16) * pow(s, 5.0) * 0.6;
  c += vec3(1.0, 0.78, 0.55) * pow(s, 500.0) * 6.0;
  return c;
}
float shoreNoise(float a) { return 0.25 * sin(3.0 * a) + 0.12 * sin(7.0 * a + 1.3) + 0.08 * sin(13.0 * a + 0.7); }
`

const SKY_FRAG = /* glsl */ `
varying vec3 vDir;
${SKY_GLSL}
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyColor(d);
  float star = step(0.9978, hash(floor(d * 280.0))) * smoothstep(0.18, 0.65, d.y);
  c += vec3(star) * 0.7;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform vec4 uRipples[${RIPPLES}];
uniform vec3 uCursor;
uniform float uCursorOn;
uniform float uScale;
uniform vec3 uLanterns[4];
varying vec3 vW;
${SKY_GLSL}

// gradient of the swell, analytic (no extra height samples)
vec2 wavesGrad(vec2 p) {
  float t = uTime;
  vec2 g = vec2(0.0);
  vec2 d;
  d = vec2(0.8, 0.6);   g += d * 1.3 * cos(dot(p, d) * 1.3 + t * 1.0) * 0.045;
  d = vec2(-0.6, 0.8);  g += d * 2.3 * cos(dot(p, d) * 2.3 + t * 1.5) * 0.025;
  d = vec2(0.95, -0.3); g += d * 4.1 * cos(dot(p, d) * 4.1 + t * 2.2) * 0.012;
  d = vec2(0.3, 0.95);  g += d * 7.3 * cos(dot(p, d) * 7.3 + t * 3.0) * 0.006;
  d = vec2(-0.9, -0.4); g += d * 11.0 * cos(dot(p, d) * 11.0 + t * 3.7) * 0.003;
  return g;
}
// cursor ripples in a single pass: x = height, yz = gradient
vec3 ripples(vec2 p) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${RIPPLES}; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 3.5) continue;
    vec2 rel = p - r.xy;
    float d = max(length(rel), 1e-4);
    float x = d - age * 1.5;
    float env = exp(-x * x * 5.0) * exp(-age) * r.w;
    if (env < 0.002) continue;
    float sn = sin(x * 20.0);
    acc.x += sn * 0.03 * env;
    acc.yz += 0.021 * env * (20.0 * cos(x * 20.0) - 10.0 * x * sn) * rel / d;
  }
  return acc;
}

void main() {
  vec2 p = vW.xz;
  vec3 rp = ripples(p);
  vec2 g = wavesGrad(p) + rp.yz;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vW);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  vec3 sky = skyColor(R);

  float dist = length(p);
  float a = atan(p.y, p.x);
  float shore = uScale * (4.8 + shoreNoise(a));
  float shallow = smoothstep(shore + 2.2, shore, dist);
  vec3 deep = vec3(0.004, 0.028, 0.06);
  vec3 lagoon = vec3(0.015, 0.24, 0.25);
  vec3 col = mix(deep, lagoon, shallow);
  col = mix(col, sky, fres);
  col += vec3(1.0, 0.68, 0.42) * pow(max(dot(R, uSun), 0.0), 160.0) * 3.0;

  // breaking foam along the beach
  float fl = shore + 0.04 + 0.05 * sin(uTime * 1.2 + a * 9.0);
  float foam = smoothstep(0.11, 0.0, abs(dist - fl)) * (0.55 + 0.45 * sin(a * 37.0 + uTime * 1.8));
  col = mix(col, vec3(0.82, 0.88, 0.9), foam * 0.5);

  // lantern reflections: long wobbly warm streaks towards the viewer
  for (int i = 0; i < 4; i++) {
    vec2 lp = uLanterns[i].xz;
    vec2 toCam = normalize(cameraPosition.xz - lp);
    vec2 rel = p - lp;
    float along = dot(rel, toCam);
    float across = abs(rel.x * toCam.y - rel.y * toCam.x) + n.x * 0.06;
    float streak = exp(-across * across * 220.0) * smoothstep(-0.1, 0.1, along) * exp(-max(along, 0.0) * 0.9);
    col += vec3(1.0, 0.62, 0.3) * streak * 0.55 * uLanterns[i].y;
  }

  // cursor: warm glow on the water + glinting ripple crests
  float cd = distance(p, uCursor.xz);
  col += vec3(1.0, 0.6, 0.3) * exp(-cd * cd * 2.0) * 0.25 * uCursorOn;
  col += vec3(1.0, 0.82, 0.6) * abs(rp.x) * 7.0;

  float fogF = smoothstep(14.0, 80.0, length(cameraPosition - vW));
  col = mix(col, skyColor(normalize(vec3(-V.x, 0.015, -V.z))), fogF);

  col = max(col, vec3(0.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function Sky() {
  const ref = useRef<THREE.Mesh>(null)
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uSun: { value: SUN } },
        vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: SKY_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [],
  )
  useFrame(({ camera }) => ref.current?.position.copy(camera.position))
  return (
    <mesh ref={ref} material={mat} renderOrder={-1}>
      <sphereGeometry args={[150, 32, 16]} />
    </mesh>
  )
}

function Sea({ cursor, lanterns, glow }: { cursor: CursorState; lanterns: THREE.Vector3[]; glow: RefObject<number> }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSun: { value: SUN },
          uRipples: { value: cursor.ripples },
          uCursor: { value: cursor.point },
          uCursorOn: { value: 0 },
          uScale: { value: ISLAND_SCALE },
          uLanterns: { value: lanterns.slice(0, 4).map((l) => new THREE.Vector3(l.x, 1, l.z)) },
        },
        vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
        fragmentShader: WATER_FRAG,
      }),
    [cursor, lanterns],
  )
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.elapsedTime
    mat.uniforms.uCursorOn.value = cursor.on
    const ls = mat.uniforms.uLanterns.value as THREE.Vector3[]
    lanterns.slice(0, 4).forEach((l, i) => {
      ls[i].y = glow.current * 0.6 + Math.exp(-l.distanceToSquared(cursor.point) * 2) * 1.4 * cursor.on
    })
  })
  return (
    <mesh material={mat} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[400, 400]} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ cursor → sea */

function CursorFx({ cursor }: { cursor: CursorState }) {
  const light = useRef<THREE.PointLight>(null)
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const hit = useMemo(() => new THREE.Vector3(), [])

  useFrame(({ camera, clock }, dt) => {
    const d = Math.min(dt, 0.05)
    const t = clock.elapsedTime
    let onTarget = 0
    if (cursor.inside) {
      ray.setFromCamera(cursor.ndc, camera)
      if (ray.ray.intersectPlane(plane, hit) && hit.distanceTo(camera.position) < 40) {
        cursor.point.lerp(hit, 1 - Math.exp(-18 * d))
        onTarget = 1
        const moved = cursor.point.distanceTo(cursor.lastSpawn)
        if (moved > 0.28 || t - cursor.lastSpawnAt > 0.9) {
          const r = cursor.ripples[cursor.next]
          r.set(cursor.point.x, cursor.point.z, t, moved > 0.28 ? Math.min(1, 0.45 + moved) : 0.35)
          cursor.next = (cursor.next + 1) % RIPPLES
          cursor.lastSpawn.copy(cursor.point)
          cursor.lastSpawnAt = t
        }
      }
    }
    cursor.on = THREE.MathUtils.damp(cursor.on, onTarget, 5, d)
    if (light.current) {
      light.current.position.set(cursor.point.x, 0.45, cursor.point.z)
      light.current.intensity = cursor.on * 3
    }
  })

  return <pointLight ref={light} color="#ffb070" distance={3.2} decay={2} intensity={0} />
}

/* ------------------------------------------------------------------ island pieces */

const shoreNoise = (a: number) => 0.25 * Math.sin(3 * a) + 0.12 * Math.sin(7 * a + 1.3) + 0.08 * Math.sin(13 * a + 0.7)

function islandLathe(profile: [number, number][], noiseAmp: number, from: number) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 128)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const r = Math.hypot(x, z)
    if (r < from) continue
    const a = Math.atan2(z, x)
    const k = (r + shoreNoise(a) * noiseAmp * Math.min(1, (r - from) / 1.2)) / r
    pos.setX(i, x * k)
    pos.setZ(i, z * k)
  }
  g.computeVertexNormals()
  return g
}

type Tex = ReturnType<typeof useTextures>

function Palm({ position, lean = [0.5, 0], height = 2.4, seed = 1 }: { position: Vec3; lean?: [number, number]; height?: number; seed?: number }) {
  const { trunk, leaf, top } = useMemo(() => {
    const top = new THREE.Vector3(lean[0], height, lean[1])
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean[0] * 0.15, height * 0.55, lean[1] * 0.15), top)
    const trunk = new THREE.TubeGeometry(curve, 20, 0.07, 8, false)
    // a single drooping, slightly folded frond
    const seg = 12
    const len = 1.25
    const verts: number[] = []
    const idx: number[] = []
    for (let i = 0; i <= seg; i++) {
      const t = i / seg
      const w = 0.2 * Math.sin(Math.PI * Math.pow(t, 0.75)) + 0.01
      const x = t * len
      const y = 0.25 * t - 0.85 * t * t
      verts.push(x, y - w * 0.25, -w, x, y + 0.03, 0, x, y - w * 0.25, w)
      if (i < seg) {
        const a = i * 3
        idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5)
      }
    }
    const leaf = new THREE.BufferGeometry()
    leaf.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3))
    leaf.setIndex(idx)
    leaf.computeVertexNormals()
    return { trunk, leaf, top }
  }, [lean, height])
  const r = useMemo(() => rng(seed), [seed])
  const fronds = useMemo(() => Array.from({ length: 10 }, (_, i) => ({ yaw: (i / 10) * Math.PI * 2 + r() * 0.4, pitch: -0.1 - r() * 0.35, s: 0.85 + r() * 0.3 })), [r])
  const crown = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (crown.current) crown.current.rotation.z = Math.sin(clock.elapsedTime * 0.9 + seed) * 0.04
  })
  return (
    <group position={position}>
      <mesh geometry={trunk}>
        <meshStandardMaterial color="#7a6048" roughness={1} />
      </mesh>
      <group ref={crown} position={top}>
        {fronds.map((f, i) => (
          <mesh key={i} geometry={leaf} rotation={[0, f.yaw, f.pitch]} scale={f.s}>
            <meshStandardMaterial color={i % 2 ? "#3f7a38" : "#4c8a3f"} roughness={0.75} side={THREE.DoubleSide} />
          </mesh>
        ))}
        {[0, 2.1, 4.2].map((a) => (
          <mesh key={a} position={[Math.cos(a) * 0.09, -0.1, Math.sin(a) * 0.09]}>
            <sphereGeometry args={[0.075, 12, 10]} />
            <meshStandardMaterial color="#5a4a22" roughness={0.8} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function Bush({ position, scale = 1, seed = 1 }: { position: Vec3; scale?: number; seed?: number }) {
  const blobs = useMemo(() => {
    const r = rng(seed)
    return Array.from({ length: 5 }, () => ({
      p: [(r() - 0.5) * 0.35, 0.12 + r() * 0.12, (r() - 0.5) * 0.35] as Vec3,
      s: 0.13 + r() * 0.1,
      c: ["#3d6b36", "#4a7c3e", "#355f30"][Math.floor(r() * 3)],
    }))
  }, [seed])
  return (
    <group position={position} scale={scale}>
      {blobs.map((b, i) => (
        <mesh key={i} position={b.p}>
          <icosahedronGeometry args={[b.s, 2]} />
          <meshStandardMaterial color={b.c} roughness={0.95} />
        </mesh>
      ))}
    </group>
  )
}

function Lounger({ position, rotation = 0, tex }: { position: Vec3; rotation?: number; tex: Tex }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[0.26, 0.04, 0.68]} />
        <meshStandardMaterial map={tex.wood} roughness={0.7} />
      </mesh>
      <RoundedBox args={[0.24, 0.04, 0.5]} radius={0.015} position={[0, 0.12, 0.08]}>
        <meshStandardMaterial color="#f1ede4" roughness={0.9} />
      </RoundedBox>
      <RoundedBox args={[0.24, 0.04, 0.24]} radius={0.015} position={[0, 0.2, -0.24]} rotation={[0.7, 0, 0]}>
        <meshStandardMaterial color="#f1ede4" roughness={0.9} />
      </RoundedBox>
      {[-0.1, 0.1].flatMap((x) =>
        [-0.28, 0.28].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.03, z]}>
            <boxGeometry args={[0.03, 0.06, 0.03]} />
            <meshStandardMaterial color="#5a3a22" />
          </mesh>
        )),
      )}
    </group>
  )
}

/** A lamp whose glow follows the scene light level and swells when the cursor comes near. */
function Lamp({ position, cursor, glow, worldPos, tall = 0.18 }: { position: Vec3; cursor: CursorState; glow: RefObject<number>; worldPos: THREE.Vector3; tall?: number }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null)
  useFrame(() => {
    if (!mat.current) return
    const near = Math.exp(-worldPos.distanceToSquared(cursor.point) * 2.2) * cursor.on
    const target = 0.6 + glow.current * 1.1 + near * 7
    mat.current.emissiveIntensity = THREE.MathUtils.lerp(mat.current.emissiveIntensity, target, 0.15)
  })
  return (
    <group position={position}>
      <mesh position={[0, tall / 2, 0]}>
        <cylinderGeometry args={[0.025, 0.03, tall, 8]} />
        <meshStandardMaterial color="#2a2722" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[0, tall + 0.05, 0]}>
        <boxGeometry args={[0.08, 0.1, 0.08]} />
        <meshStandardMaterial ref={mat} color="#ffd6a0" emissive="#ffb066" emissiveIntensity={1.5} />
      </mesh>
    </group>
  )
}

function Villa({ tex, glow, cursor }: { tex: Tex; glow: RefObject<number>; cursor: CursorState }) {
  const interior = useRef<THREE.PointLight>(null)
  const warm = useRef<THREE.MeshStandardMaterial[]>([])
  const center = useMemo(() => new THREE.Vector3(-0.2, 0, -0.55), [])
  useFrame(() => {
    const near = Math.exp(-center.distanceToSquared(cursor.point) * 0.9) * cursor.on
    const g = 0.35 + glow.current * 0.55 + near * 1.6
    if (interior.current) interior.current.intensity = THREE.MathUtils.lerp(interior.current.intensity, g * 2.4, 0.12)
    warm.current.forEach((m) => {
      if (m) m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, g, 0.12)
    })
  })
  const addWarm = (i: number) => (m: THREE.MeshStandardMaterial | null) => {
    if (m) warm.current[i] = m
  }

  const glass = (
    <meshStandardMaterial color="#cfe3e6" transparent opacity={0.22} roughness={0.05} metalness={0.2} envMapIntensity={1.6} depthWrite={false} />
  )
  const frame = <meshStandardMaterial color="#26282a" metalness={0.6} roughness={0.35} />
  const plaster = <meshStandardMaterial map={tex.plaster} roughness={0.85} />

  return (
    <group position={[-0.35, 0.25, -1.0]}>
      {/* ---------- ground floor: glazed living space ---------- */}
      <mesh position={[-0.4, 0.03, -0.9]}>
        <boxGeometry args={[2.4, 0.06, 1.4]} />
        <meshStandardMaterial map={tex.wood} roughness={0.55} />
      </mesh>
      <RoundedBox args={[2.4, 0.9, 0.08]} radius={0.01} position={[-0.4, 0.5, -1.56]}>
        {plaster}
      </RoundedBox>
      <RoundedBox args={[0.08, 0.9, 1.4]} radius={0.01} position={[-1.56, 0.5, -0.9]}>
        {plaster}
      </RoundedBox>
      {/* warm-lit back wall panel */}
      <mesh position={[-0.4, 0.5, -1.51]}>
        <planeGeometry args={[2.2, 0.8]} />
        <meshStandardMaterial ref={addWarm(0)} color="#e8d5b5" emissive="#ffb470" emissiveIntensity={0.6} />
      </mesh>
      {/* furniture */}
      <RoundedBox args={[0.9, 0.16, 0.36]} radius={0.04} position={[-0.95, 0.16, -1.25]}>
        <meshStandardMaterial color="#cfc5b4" roughness={1} />
      </RoundedBox>
      <RoundedBox args={[0.9, 0.22, 0.1]} radius={0.04} position={[-0.95, 0.3, -1.4]}>
        <meshStandardMaterial color="#c7bca9" roughness={1} />
      </RoundedBox>
      <mesh position={[-0.95, 0.065, -0.85]}>
        <boxGeometry args={[1.1, 0.008, 0.7]} />
        <meshStandardMaterial color="#b6a58a" roughness={1} />
      </mesh>
      <mesh position={[-0.95, 0.12, -0.85]}>
        <cylinderGeometry args={[0.17, 0.17, 0.04, 24]} />
        <meshStandardMaterial map={tex.wood} roughness={0.5} />
      </mesh>
      <RoundedBox args={[0.75, 0.22, 0.32]} radius={0.02} position={[0.3, 0.17, -1.25]}>
        <meshStandardMaterial color="#f3f1ec" roughness={0.4} />
      </RoundedBox>
      {[-0.1, 0.3, 0.7].map((x, i) => (
        <mesh key={x} position={[x, 0.72, -1.05]}>
          <sphereGeometry args={[0.045, 16, 12]} />
          <meshStandardMaterial ref={addWarm(1 + i)} color="#fff1d6" emissive="#ffc27a" emissiveIntensity={1} />
        </mesh>
      ))}
      <mesh position={[-1.35, 0.25, -1.35]}>
        <cylinderGeometry args={[0.07, 0.06, 0.16, 16]} />
        <meshStandardMaterial color="#8a6a4a" />
      </mesh>
      <Bush position={[-1.35, 0.28, -1.35]} scale={0.6} seed={21} />
      {/* glazing + slim aluminium frames */}
      <mesh position={[-0.4, 0.5, -0.2]}>
        <boxGeometry args={[2.4, 0.86, 0.015]} />
        {glass}
      </mesh>
      <mesh position={[0.8, 0.5, -0.9]}>
        <boxGeometry args={[0.015, 0.86, 1.36]} />
        {glass}
      </mesh>
      {[-1.6, -1.0, -0.4, 0.2, 0.8].map((x) => (
        <mesh key={x} position={[x, 0.5, -0.2]}>
          <boxGeometry args={[0.03, 0.9, 0.04]} />
          {frame}
        </mesh>
      ))}
      {[0.07, 0.94].map((y) => (
        <mesh key={y} position={[-0.4, y, -0.2]}>
          <boxGeometry args={[2.42, 0.03, 0.04]} />
          {frame}
        </mesh>
      ))}
      <pointLight ref={interior} position={[-0.4, 0.62, -0.75]} color="#ffbe7a" intensity={2} distance={3.2} decay={2} />

      {/* ---------- floor plate + cantilevered upper volume ---------- */}
      <RoundedBox args={[2.95, 0.1, 1.78]} radius={0.015} position={[-0.12, 1.0, -0.86]}>
        <meshStandardMaterial color="#f4f2ee" roughness={0.6} />
      </RoundedBox>
      {[0.95, 1.2].map((x, i) => (
        <mesh key={x} position={[x, 0.948, -0.5]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.04, 16]} />
          <meshStandardMaterial ref={addWarm(4 + i)} color="#fff3dc" emissive="#ffd19a" emissiveIntensity={1} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <RoundedBox args={[2.3, 0.78, 1.6]} radius={0.015} position={[0.15, 1.44, -0.9]}>
        {plaster}
      </RoundedBox>
      {/* lit bedroom glazing behind the timber screen */}
      <mesh position={[0.15, 1.44, -0.095]}>
        <planeGeometry args={[2.1, 0.62]} />
        <meshStandardMaterial ref={addWarm(6)} color="#3a2f25" emissive="#ff9e55" emissiveIntensity={0.6} />
      </mesh>
      {Array.from({ length: 17 }, (_, i) => (
        <mesh key={i} position={[-0.88 + i * 0.129, 1.44, -0.06]}>
          <boxGeometry args={[0.05, 0.74, 0.045]} />
          <meshStandardMaterial map={tex.wood} roughness={0.7} />
        </mesh>
      ))}
      {/* ribbon window on the gable side */}
      <mesh position={[1.305, 1.47, -0.9]}>
        <boxGeometry args={[0.01, 0.26, 1.2]} />
        <meshStandardMaterial ref={addWarm(7)} color="#3a2f25" emissive="#ffa25c" emissiveIntensity={0.6} />
      </mesh>
      {/* roof: parapet, gravel, solar */}
      <RoundedBox args={[2.36, 0.06, 1.66]} radius={0.01} position={[0.15, 1.86, -0.9]}>
        <meshStandardMaterial color="#efece6" />
      </RoundedBox>
      <mesh position={[0.15, 1.895, -0.9]}>
        <boxGeometry args={[2.2, 0.01, 1.5]} />
        <meshStandardMaterial map={tex.gravel} roughness={1} />
      </mesh>
      {[
        [-0.5, -1.15],
        [0.0, -1.15],
        [0.5, -1.15],
        [-0.5, -0.7],
        [0.0, -0.7],
        [0.5, -0.7],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x + 0.15, 1.95, z]} rotation={[-0.22, 0, 0]}>
          <boxGeometry args={[0.44, 0.02, 0.36]} />
          <meshStandardMaterial map={tex.solar} metalness={0.55} roughness={0.25} />
        </mesh>
      ))}

      {/* ---------- timber deck, steps, pool ---------- */}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-0.1, 0.025, -0.14 + i * 0.1]}>
          <boxGeometry args={[3.4, 0.05, 0.092]} />
          <meshStandardMaterial map={tex.wood} color={i % 3 === 0 ? "#e8dccb" : i % 3 === 1 ? "#ffffff" : "#f2e6d4"} roughness={0.75} />
        </mesh>
      ))}
      <RoundedBox args={[2.6, 0.1, 1.25]} radius={0.02} position={[1.5, 0.03, 1.45]}>
        <meshStandardMaterial color="#e9e4da" roughness={0.8} />
      </RoundedBox>
      <mesh position={[1.5, 0.06, 1.45]}>
        <boxGeometry args={[2.4, 0.04, 1.05]} />
        <meshStandardMaterial color="#9fdde0" emissive="#3fc6d0" emissiveIntensity={0.25 + 0} roughness={0.3} />
      </mesh>
      <mesh position={[1.5, 0.084, 1.45]}>
        <boxGeometry args={[2.4, 0.004, 1.05]} />
        <meshStandardMaterial color="#7fd3da" transparent opacity={0.55} roughness={0.05} metalness={0.1} depthWrite={false} />
      </mesh>
      <Lounger position={[-0.15, 0, 1.45]} tex={tex} />
      <Lounger position={[-0.55, 0, 1.45]} tex={tex} />
    </group>
  )
}

const LAMP_LOCAL: Vec3[] = [
  // jetty lanterns first (these also reflect on the sea)
  [2.0, 0.12, 7.1],
  [2.6, 0.12, 7.1],
  [2.0, 0.12, 5.4],
  [2.6, 0.12, 5.4],
  // garden + beach path
  [-1.6, 0.25, 0.7],
  [0.2, 0.25, 1.9],
  [1.4, 0.12, 3.6],
  [-2.4, 0.12, 2.9],
]

function Island({ tex, glow, cursor, lampsWorld }: { tex: Tex; glow: RefObject<number>; cursor: CursorState; lampsWorld: THREE.Vector3[] }) {
  const group = useRef<THREE.Group>(null)
  const boat = useRef<THREE.Group>(null)
  const { sandGeo, grassGeo } = useMemo(
    () => ({
      sandGeo: islandLathe(
        [
          [0, 0.13],
          [3.6, 0.13],
          [4.2, 0.08],
          [4.8, 0.0],
          [5.3, -0.14],
          [5.9, -0.6],
        ],
        1,
        3.0,
      ),
      grassGeo: islandLathe(
        [
          [0, 0.25],
          [3.1, 0.25],
          [3.4, 0.21],
          [3.65, 0.12],
        ],
        0.6,
        2.6,
      ),
    }),
    [],
  )
  useLayoutEffect(() => {
    group.current?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
      }
    })
  }, [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (boat.current) {
      boat.current.position.y = Math.sin(t * 1.3) * 0.025
      boat.current.rotation.z = Math.sin(t * 1.1) * 0.05
      boat.current.rotation.x = Math.sin(t * 0.9 + 1) * 0.03
    }
  })

  return (
    <group ref={group} scale={ISLAND_SCALE}>
      <mesh geometry={sandGeo}>
        <meshStandardMaterial map={tex.sand} roughness={1} />
      </mesh>
      <mesh geometry={grassGeo}>
        <meshStandardMaterial map={tex.grass} roughness={1} />
      </mesh>

      {/* shoreline rocks */}
      {[
        [-4.6, -1.6, 0.35],
        [-4.2, -2.4, 0.25],
        [4.4, -2.2, 0.4],
        [3.9, -2.9, 0.22],
        [-3.4, 3.4, 0.3],
        [0.6, -4.7, 0.32],
      ].map(([x, z, s], i) => (
        <mesh key={i} position={[x, 0.02, z]} scale={[s * 1.3, s, s]} rotation={[0.3, i, 0.2]}>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color="#5d5850" roughness={0.95} />
        </mesh>
      ))}

      <Villa tex={tex} glow={glow} cursor={cursor} />

      {/* planting */}
      <Palm position={[-2.9, 0.25, -1.7]} lean={[0.4, 0.2]} height={2.6} seed={2} />
      <Palm position={[2.7, 0.25, -1.5]} lean={[-0.3, 0.3]} height={2.3} seed={4} />
      <Palm position={[-3.5, 0.13, 1.6]} lean={[-0.7, 0.5]} height={2.1} seed={6} />
      <Palm position={[3.4, 0.13, 2.4]} lean={[0.8, 0.6]} height={2.4} seed={8} />
      {[
        [-2.6, -2.5],
        [-1.6, -2.8],
        [-0.4, -2.9],
        [0.9, -2.8],
        [2.0, -2.4],
        [-2.9, 0.1],
        [2.7, 0.2],
      ].map(([x, z], i) => (
        <Bush key={i} position={[x, 0.25, z]} scale={1.3} seed={30 + i} />
      ))}

      {/* stepping stones down to the beach */}
      {[0, 1, 2, 3].map((i) => (
        <RoundedBox key={i} args={[0.4, 0.04, 0.26]} radius={0.015} position={[-1.3 + i * 0.22, 0.26 - (i > 2 ? 0.1 : 0), 1.0 + i * 0.5]} rotation={[0, i * 0.2, 0]}>
          <meshStandardMaterial color="#cfc8bb" roughness={0.9} />
        </RoundedBox>
      ))}

      {/* beach umbrella + loungers */}
      <group position={[-1.2, 0.13, 3.7]}>
        <mesh position={[0, 0.45, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.9, 8]} />
          <meshStandardMaterial color="#d9cfbf" />
        </mesh>
        <mesh position={[0, 0.88, 0]}>
          <coneGeometry args={[0.62, 0.2, 10, 1, true]} />
          <meshStandardMaterial color="#efe6d6" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        <Lounger position={[-0.25, 0, 0.1]} rotation={-0.2} tex={tex} />
        <Lounger position={[0.25, 0, 0.15]} rotation={0.15} tex={tex} />
      </group>

      {/* jetty */}
      <group position={[2.3, 0, 0]}>
        <mesh position={[0, 0.2, 5.6]}>
          <boxGeometry args={[0.75, 0.05, 3.4]} />
          <meshStandardMaterial map={tex.wood} roughness={0.8} />
        </mesh>
        {[4.2, 5.3, 6.4, 7.2].flatMap((z) =>
          [-0.34, 0.34].map((x) => (
            <mesh key={`${x}${z}`} position={[x, 0.0, z]}>
              <cylinderGeometry args={[0.04, 0.04, 0.45, 8]} />
              <meshStandardMaterial color="#4b3423" roughness={1} />
            </mesh>
          )),
        )}
      </group>
      <group ref={boat} position={[3.55, 0, 6.3]} rotation={[0, 0.25, 0]}>
        <mesh scale={[0.32, 0.2, 0.95]}>
          <sphereGeometry args={[1, 20, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshStandardMaterial color="#f2efe8" roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -0.02, 0]}>
          <boxGeometry args={[0.5, 0.02, 1.4]} />
          <meshStandardMaterial map={tex.wood} />
        </mesh>
      </group>

      {LAMP_LOCAL.map((p, i) => (
        <Lamp key={i} position={p} cursor={cursor} glow={glow} worldPos={lampsWorld[i]} tall={i < 4 ? 0.45 : 0.18} />
      ))}
    </group>
  )
}

/* ------------------------------------------------------------------ distant city */

function windowsTexture() {
  return canvasTexture(128, [1, 1], (ctx, r) => {
    const s = ctx.canvas.width
    ctx.fillStyle = "#121a2a"
    ctx.fillRect(0, 0, s, s)
    for (let y = 6; y < s; y += 12) {
      for (let x = 4; x < s; x += 10) {
        const lit = r()
        if (lit < 0.3) {
          ctx.fillStyle = lit < 0.08 ? "#bcd6ff" : lit < 0.3 ? "#ffcf8a" : "#ffb768"
          ctx.globalAlpha = 0.55 + r() * 0.45
          ctx.fillRect(x, y, 5, 6)
        }
      }
    }
    ctx.globalAlpha = 1
  }, 17)
}

/** A coastal city across the water: lit towers along the horizon, drawn as one instanced mesh. */
function City() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const { towers, material } = useMemo(() => {
    const r = rng(99)
    const map = windowsTexture()
    map.repeat.set(2, 5)
    const material = new THREE.MeshStandardMaterial({ color: "#1a2233", emissive: "#ffffff", emissiveMap: map, emissiveIntensity: 1.3, roughness: 0.8 })
    const towers = Array.from({ length: 90 }, () => {
      const a = THREE.MathUtils.degToRad(-5 + r() * 95) // spread across the +z / +x horizon
      const dist = 115 + r() * 20
      const h = 2.5 + Math.pow(r(), 2.4) * 14
      return { x: Math.sin(a) * dist, z: Math.cos(a) * dist, h, w: 2 + r() * 3, d: 2 + r() * 3, rot: r() * Math.PI }
    })
    return { towers, material }
  }, [])
  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const o = new THREE.Object3D()
    towers.forEach((t, i) => {
      o.position.set(t.x, t.h / 2 - 0.3, t.z)
      o.rotation.set(0, t.rot, 0)
      o.scale.set(t.w, t.h, t.d)
      o.updateMatrix()
      m.setMatrixAt(i, o.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  }, [towers])
  return (
    <group>
      <instancedMesh ref={mesh} args={[undefined, material, towers.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      {/* low hills behind the city */}
      <mesh position={[50, -9, 160]} scale={[150, 18, 12]}>
        <sphereGeometry args={[1, 32, 12]} />
        <meshStandardMaterial color="#141b2b" roughness={1} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ hanging boards */

/** Pricing + FAQ boards hanging from a timber frame; real HTML sheets project directly onto them. */
function Boards({ tex }: { tex: Tex }) {
  const [pw, ph] = BOARD.paper
  const f = BOARD.frame
  const a = BOARD.centers.pricing
  const b = BOARD.centers.faq
  const top = a[1] + ph / 2 + f
  const beamY = top + 0.13
  const left = a[0] - pw / 2 - 0.08
  const right = b[0] + pw / 2 + 0.08
  const z = a[2] - 0.02
  return (
    <group>
      {/* frame: two posts and a beam */}
      {[left, right].map((x) => (
        <mesh key={x} position={[x, beamY / 2 + 0.03, z]} castShadow>
          <boxGeometry args={[0.035, beamY, 0.035]} />
          <meshStandardMaterial map={tex.wood} roughness={0.8} />
        </mesh>
      ))}
      <mesh position={[(left + right) / 2, beamY, z]} castShadow>
        <boxGeometry args={[right - left + 0.08, 0.04, 0.045]} />
        <meshStandardMaterial map={tex.wood} roughness={0.8} />
      </mesh>
      {(["pricing", "faq"] as const).map((k) => {
        const c = BOARD.centers[k]
        return (
          <group key={k} position={c}>
            {/* hanging cords */}
            {[-pw / 2 + 0.05, pw / 2 - 0.05].map((x) => (
              <mesh key={x} position={[x, ph / 2 + f + (beamY - top) / 2, -0.01]}>
                <cylinderGeometry args={[0.002, 0.002, beamY - top, 4]} />
                <meshStandardMaterial color="#3b2a1c" />
              </mesh>
            ))}
            {/* timber frame + warm paper backing */}
            <mesh position={[0, 0, -0.006]} castShadow>
              <boxGeometry args={[pw + f * 2, ph + f * 2, 0.012]} />
              <meshStandardMaterial map={tex.wood} roughness={0.7} />
            </mesh>
            <mesh position={[0, 0, 0.0015]}>
              <planeGeometry args={[pw, ph]} />
              <meshStandardMaterial color="#f6efe2" emissive="#f6efe2" emissiveIntensity={0.35} roughness={0.95} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

export interface BoardRefs {
  pricing: RefObject<HTMLDivElement | null>
  faq: RefObject<HTMLDivElement | null>
}

/** Projects the two 3D hanging boards onto screen space every frame so real HTML sheets stay glued to them. */
function BoardProjector({ boardRefs }: { boardRefs?: BoardRefs }) {
  const { camera, gl } = useThree()
  const tl = useMemo(() => new THREE.Vector3(), [])
  const br = useMemo(() => new THREE.Vector3(), [])
  const ctr = useMemo(() => new THREE.Vector3(), [])
  // layout is read only when something resizes, never inside the render loop
  const layout = useRef({ rect: { left: 0, top: 0, width: 0, height: 0 }, vw: 0, vh: 0, sizes: { pricing: [1, 1], faq: [1, 1] } as Record<"pricing" | "faq", [number, number]> })
  const last = useRef<Record<"pricing" | "faq", string>>({ pricing: "", faq: "" })

  useEffect(() => {
    if (!boardRefs) return
    const measure = () => {
      const r = gl.domElement.getBoundingClientRect()
      layout.current.rect = { left: r.left, top: r.top, width: r.width, height: r.height }
      layout.current.vw = window.innerWidth
      layout.current.vh = window.innerHeight
      for (const k of ["pricing", "faq"] as const) {
        const el = boardRefs[k].current
        if (el) layout.current.sizes[k] = [el.offsetWidth || 1, el.offsetHeight || 1]
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(gl.domElement)
    for (const k of ["pricing", "faq"] as const) {
      const el = boardRefs[k].current
      if (el) ro.observe(el)
    }
    window.addEventListener("resize", measure)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [boardRefs, gl])

  useFrame(() => {
    if (!boardRefs) return
    camera.updateMatrixWorld()
    const rect = layout.current.rect
    if (rect.width <= 0 || rect.height <= 0) return
    const hide = (k: "pricing" | "faq", el: HTMLElement) => {
      if (last.current[k] !== "hidden") {
        el.style.visibility = "hidden"
        last.current[k] = "hidden"
      }
    }

    const hw = BOARD.paper[0] / 2
    const hh = BOARD.paper[1] / 2

    for (const k of ["pricing", "faq"] as const) {
      const el = boardRefs[k].current
      if (!el) continue
      const [cx, cy, cz] = BOARD.centers[k]
      const faceZ = cz + 0.002

      // Hide when camera is behind the front face of the board
      if (camera.position.z <= faceZ + 0.05) {
        hide(k, el)
        continue
      }

      ctr.set(cx, cy, faceZ).project(camera)
      if (ctr.z >= 1 || ctr.z <= -1) {
        hide(k, el)
        continue
      }

      tl.set(cx - hw, cy + hh, faceZ).project(camera)
      br.set(cx + hw, cy - hh, faceZ).project(camera)

      const left = rect.left + (tl.x * 0.5 + 0.5) * rect.width
      const right = rect.left + (br.x * 0.5 + 0.5) * rect.width
      const top = rect.top + (-tl.y * 0.5 + 0.5) * rect.height
      const bottom = rect.top + (-br.y * 0.5 + 0.5) * rect.height

      const sw = right - left
      const sh = bottom - top

      if (
        sw < 24 ||
        sh < 16 ||
        right < -200 ||
        left > layout.current.vw + 200 ||
        bottom < -200 ||
        top > layout.current.vh + 200
      ) {
        hide(k, el)
        continue
      }

      const [baseW, baseH] = layout.current.sizes[k]
      const scaleX = sw / baseW
      const scaleY = sh / baseH
      const x = (left + right) / 2
      const y = (top + bottom) / 2

      // write only when the projection actually moved
      const tf = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`
      if (last.current[k] !== tf) {
        if (last.current[k] === "hidden" || last.current[k] === "") el.style.visibility = "visible"
        el.style.transform = tf
        last.current[k] = tf
      }
    }
  })

  return null
}

/* ------------------------------------------------------------------ product UI cards */

function Card({ children, width = 176 }: { children: ReactNode; width?: number }) {
  return (
    <div
      style={{ width }}
      className="select-none rounded-2xl border border-white/60 bg-white/90 p-3 font-sans text-[11px] leading-snug text-[#14201b] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.55)]"
    >
      {children}
    </div>
  )
}

function Dot({ color = "#1f9d6a" }: { color?: string }) {
  return <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: color }} />
}

const HUB: Vec3 = [-0.1, 1.35, -1.0]

function FloatingCard({ position, children, delay = 0, visible }: { position: Vec3; children: ReactNode; delay?: number; visible: boolean }) {
  const line = useRef<{ material: THREE.Material & { dashOffset: number; opacity: number } } | null>(null)
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }, dt) => {
    const m = line.current?.material
    if (m) {
      m.dashOffset -= Math.min(dt, 0.05) * 0.8
      m.opacity = THREE.MathUtils.damp(m.opacity, visible ? 0.55 : 0, 4, Math.min(dt, 0.05))
    }
    if (group.current) group.current.position.y = position[1] + Math.sin(clock.elapsedTime * 1.2 + position[0]) * 0.06
  })
  const mid: Vec3 = [(HUB[0] + position[0]) / 2, Math.max(HUB[1], position[1]) + 0.7, (HUB[2] + position[2]) / 2]
  return (
    <>
      <QuadraticBezierLine
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={line as any}
        start={HUB}
        end={position}
        mid={mid}
        color="#ffd29a"
        lineWidth={1}
        dashed
        dashScale={8}
        dashSize={0.5}
        gapSize={0.5}
        transparent
        opacity={0}
      />
      <group ref={group} position={position}>
        <Html transform sprite distanceFactor={3.6} zIndexRange={[4, 0]} center>
          <div
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0) scale(1)" : "translateY(14px) scale(0.85)",
              transition: "opacity 600ms ease, transform 700ms cubic-bezier(0.22,1,0.36,1)",
              transitionDelay: `${visible ? delay : 0}ms`,
            }}
          >
            {children}
          </div>
        </Html>
      </group>
    </>
  )
}

function ProductCards({ labels, visible }: { labels: SceneLabels; visible: boolean }) {
  const booked = [1, 2, 3, 6, 7, 9, 10, 11, 12]
  return (
    <>
      <FloatingCard position={[-1.3, 2.45, 0.9]} delay={200} visible={visible}>
        <Card>
          <div className="flex items-center justify-between">
            <span className="font-semibold">{labels.booking}</span>
            <Dot />
          </div>
          <p className="mt-1 text-[#14201b]/60">{labels.bookingSub}</p>
        </Card>
      </FloatingCard>
      <FloatingCard position={[1.25, 2.75, -0.9]} delay={350} visible={visible}>
        <Card width={190}>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#1f5f4a]">
            <Dot color="#1f5f4a" /> {labels.ai}
          </div>
          <p className="rounded-xl rounded-tl-sm bg-[#1f5f4a] px-2.5 py-1.5 text-white">{labels.chat}</p>
        </Card>
      </FloatingCard>
      <FloatingCard position={[1.75, 1.55, -1.25]} delay={500} visible={visible}>
        <Card width={160}>
          <p className="text-[#14201b]/60">{labels.paid}</p>
          <p className="mt-0.5 text-[15px] font-bold tracking-tight">{labels.paidAmount}</p>
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#e9f6ef] px-2 py-0.5 text-[10px] font-semibold text-[#1f7a52]">✓ VNPay</p>
        </Card>
      </FloatingCard>
      <FloatingCard position={[-1.8, 1.45, 1.25]} delay={650} visible={visible}>
        <Card width={150}>
          <p className="text-[#14201b]/60">{labels.occupancy}</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <span className="text-[18px] font-bold tracking-tight">83%</span>
            <span className="flex h-6 items-end gap-[3px]">
              {[40, 55, 48, 70, 62, 83, 90].map((h, i) => (
                <span key={i} className="w-[5px] rounded-sm bg-[#1f5f4a]" style={{ height: `${h}%`, opacity: 0.45 + i * 0.08 }} />
              ))}
            </span>
          </div>
        </Card>
      </FloatingCard>
      <FloatingCard position={[-0.35, 3.15, 0.25]} delay={800} visible={visible}>
        <Card width={150}>
          <p className="mb-1.5 font-semibold">{labels.calendar}</p>
          <div className="grid grid-cols-7 gap-[3px]">
            {Array.from({ length: 14 }, (_, i) => (
              <span key={i} className="h-2.5 rounded-[3px]" style={{ background: booked.includes(i) ? "#f0a35e" : "#ece6db" }} />
            ))}
          </div>
        </Card>
      </FloatingCard>
    </>
  )
}

/* ------------------------------------------------------------------ camera rig */

function Rig({ shots, progress, glow, cursor, labels, showCards }: { shots: Shot[]; progress: RefObject<number>; glow: RefObject<number>; cursor: CursorState; labels: SceneLabels; showCards: boolean }) {
  const look = useRef(new THREE.Vector3(...shots[0].look))
  const cam = useMemo(() => new THREE.Vector3(), [])
  const tgt = useMemo(() => new THREE.Vector3(), [])
  const [cardsOn, setCardsOn] = useState(shots[0].cards && showCards)
  const cardsRef = useRef(cardsOn)
  const { camera } = useThree()

  // place the camera once; later shot changes are eased to, never jumped to
  const placed = useRef(false)
  useLayoutEffect(() => {
    if (placed.current) return
    placed.current = true
    const p = Math.round(THREE.MathUtils.clamp(progress.current, 0, shots.length - 1))
    camera.position.set(...shots[p].cam)
    look.current.set(...shots[p].look)
    camera.lookAt(look.current)
  }, [camera, progress, shots])

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05)
    const n = shots.length
    const p = THREE.MathUtils.clamp(progress.current, 0, n - 1)
    const i = Math.min(Math.floor(p), n - 1)
    const f = p - i
    const s = f * f * (3 - 2 * f)
    const a = shots[i]
    const b = shots[Math.min(i + 1, n - 1)]
    tgt.set(THREE.MathUtils.lerp(a.look[0], b.look[0], s), THREE.MathUtils.lerp(a.look[1], b.look[1], s), THREE.MathUtils.lerp(a.look[2], b.look[2], s))
    cam.set(THREE.MathUtils.lerp(a.cam[0], b.cam[0], s), THREE.MathUtils.lerp(a.cam[1], b.cam[1], s), THREE.MathUtils.lerp(a.cam[2], b.cam[2], s))
    // pointer parallax, scaled by distance so close-ups (the boards) stay put
    const sway = Math.min(1, cam.distanceTo(tgt) / 8)
    cam.x += cursor.ndc.x * 0.45 * sway
    cam.y += cursor.ndc.y * 0.25 * sway
    // light damping only smooths wheel steps; the camera stays glued to the scroll
    const k = 1 - Math.exp(-7 * d)
    camera.position.lerp(cam, k)
    look.current.lerp(tgt, k)
    camera.lookAt(look.current)
    glow.current = THREE.MathUtils.lerp(a.glow, b.glow, s)
    const fov = THREE.MathUtils.lerp(a.fov ?? 40, b.fov ?? 40, s)
    const pc = camera as THREE.PerspectiveCamera
    if (Math.abs(pc.fov - fov) > 0.01) {
      pc.fov = THREE.MathUtils.lerp(pc.fov, fov, k)
      pc.updateProjectionMatrix()
    }

    const want = (s < 0.5 ? a : b).cards && showCards
    if (want !== cardsRef.current) {
      cardsRef.current = want
      setCardsOn(want)
    }
  })

  return showCards ? <ProductCards labels={labels} visible={cardsOn} /> : null
}

/* ------------------------------------------------------------------ scene root */

/**
 * Reflections for glass/metal: three soft light panels (dusk sky, warm sunset strip, cool fill)
 * baked once into a PMREM map. Cheaper than drei's <Environment>, which ships HDR/EXR loaders.
 */
function SceneEnvironment() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = new THREE.Scene()
    const panel = (color: string, intensity: number, pos: Vec3, rot: Vec3, size: [number, number]) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size[0], size[1]),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide, toneMapped: false }),
      )
      m.position.set(...pos)
      m.rotation.set(...rot)
      env.add(m)
    }
    panel("#2b4673", 1.2, [0, 6, 0], [Math.PI / 2, 0, 0], [20, 20])
    panel("#ff9a5a", 2.4, [-10, 1.5, -12], [0, 0, 0], [18, 3])
    panel("#7fa7ff", 0.5, [10, 3, 8], [0, 0, 0], [10, 6])
    const rt = pmrem.fromScene(env, 0.04)
    scene.environment = rt.texture
    env.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    })
    return () => {
      scene.environment = null
      rt.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  return null
}

/**
 * The island barely moves, so the shadow map is rendered for the first half second (while
 * textures and the environment settle) and then frozen instead of re-rendered every frame.
 */
function StaticShadows() {
  const gl = useThree((st) => st.gl)
  useEffect(() => {
    gl.shadowMap.autoUpdate = false
    let n = 0
    let raf = 0
    const tick = () => {
      gl.shadowMap.needsUpdate = true
      if (++n < 30) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      gl.shadowMap.autoUpdate = true
    }
  }, [gl])
  return null
}

export default function StayScene({
  shots,
  progress,
  active,
  labels,
  boardRefs,
}: {
  shots: Shot[]
  progress: RefObject<number>
  active: boolean
  labels: SceneLabels
  boardRefs?: BoardRefs
}) {
  const showCards = typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches
  const cursor = useMemo(makeCursor, [])
  const glow = useRef(shots[0]?.glow ?? 1)
  const lampsWorld = useMemo(() => LAMP_LOCAL.map((p) => new THREE.Vector3(...p).multiplyScalar(ISLAND_SCALE)), [])

  // the canvas sits under the page, so track the pointer on the window
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      cursor.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1)
      cursor.inside = true
    }
    const onLeave = (e: PointerEvent) => {
      if (!e.relatedTarget) cursor.inside = false
    }
    window.addEventListener("pointermove", onMove, { passive: true })
    document.addEventListener("pointerout", onLeave)
    return () => {
      window.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerout", onLeave)
    }
  }, [cursor])

  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      frameloop={active ? "always" : "never"}
      camera={{ position: shots[0].cam, fov: 40, near: 0.03, far: 400 }}
      gl={{ antialias: true, powerPreference: "high-performance", toneMappingExposure: 1.18 }}
    >
      <Scene shots={shots} progress={progress} glow={glow} cursor={cursor} labels={labels} showCards={showCards} lampsWorld={lampsWorld} boardRefs={boardRefs} />
    </Canvas>
  )
}

function Scene({
  shots,
  progress,
  glow,
  cursor,
  labels,
  showCards,
  lampsWorld,
  boardRefs,
}: {
  shots: Shot[]
  progress: RefObject<number>
  glow: RefObject<number>
  cursor: CursorState
  labels: SceneLabels
  showCards: boolean
  lampsWorld: THREE.Vector3[]
  boardRefs?: BoardRefs
}) {
  const tex = useTextures()
  const sunPos = useMemo(() => SUN.clone().multiplyScalar(22).setY(6), [])
  return (
    <>
      <fog attach="fog" args={["#2a2f45", 30, 170]} />
      <SceneEnvironment />
      <hemisphereLight args={["#8ea3cf", "#4a3a2a", 0.85]} />
      <directionalLight
        position={sunPos.toArray()}
        intensity={1.6}
        color="#ffb27a"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={1}
        shadow-camera-far={50}
      />
      <directionalLight position={[8, 6, 9]} intensity={0.45} color="#9db6ff" />
      <StaticShadows />
      <Sky />
      <Sea cursor={cursor} lanterns={lampsWorld} glow={glow} />
      <Island tex={tex} glow={glow} cursor={cursor} lampsWorld={lampsWorld} />
      <Boards tex={tex} />
      <City />
      <CursorFx cursor={cursor} />
      <Rig shots={shots} progress={progress} glow={glow} cursor={cursor} labels={labels} showCards={showCards} />
      <BoardProjector boardRefs={boardRefs} />
    </>
  )
}
