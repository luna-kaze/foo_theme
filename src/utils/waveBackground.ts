// Four rotating blurred artwork discs, adapted from Wave-Player by Ekko (MIT).
// Copyright (c) 2026 Ekko. Full license: public/third-party/Wave-Player-LICENSE.txt.
import { extractLightPalette, renderAlbumLightField, type AlbumLightField } from './albumLightField'
import { normalizeLightFieldSettings, lightFieldDefaults, type LightFieldSettings } from './lightFieldSettings'

export const waveFragmentShader = `
precision mediump float;
uniform sampler2D uA, uB;
uniform vec2 uResolution;
uniform float uTime, uMix, uFrozen, uMotion, uScale;
uniform vec4 uCircles[4];
uniform vec4 uOpacity;
vec4 disc(sampler2D image, vec2 p, vec4 c) {
  vec2 drift = vec2(sin(uTime*.17+c.w),cos(uTime*.13-c.w))*uResolution*.025*uMotion;
  vec2 d=(p-c.xy-drift)/(c.z*uScale);
  if(dot(d,d)>1.0) return vec4(0.0);
  float a=uTime*c.w*uMotion, s=sin(a), k=cos(a);
  return texture2D(image, mat2(k,-s,s,k)*d*.5+.5);
}
vec3 swirl(sampler2D image, vec2 p) {
  vec3 color=mix(vec3(.12,.12,.14),disc(image,p,uCircles[0]).rgb,uOpacity.x);
  for(int i=1;i<4;i++) {
    vec4 sampleColor=disc(image,p,uCircles[i]);
    color=mix(color,sampleColor.rgb,clamp(sampleColor.a*uOpacity[i],0.0,1.0));
  }
  float luminance=dot(color,vec3(.2126,.7152,.0722));
  return clamp(mix(vec3(luminance),color,1.7)*.78,0.0,1.0);
}
void main() {
  vec2 p=gl_FragCoord.xy;
  vec3 oldColor=uFrozen>.5 ? texture2D(uA,p/uResolution).rgb : swirl(uA,p);
  gl_FragColor=vec4(mix(oldColor,swirl(uB,p),uMix),1.0);
}`
const vertexShader = 'attribute vec2 v; void main(){gl_Position=vec4(v,0.0,1.0);}'

async function image(source: string) {
  const element = new Image()
  element.crossOrigin = 'anonymous'; element.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => { clearTimeout(timer); element.onload = element.onerror = null; error ? reject(error) : resolve() }
    const timer = setTimeout(() => finish(new Error('Artwork timed out')), 3500)
    element.onload = () => finish(); element.onerror = () => finish(new Error('Artwork unavailable')); element.src = source
  })
  return element
}

export function createArtworkDisc(art: HTMLImageElement) {
  const size = 256, pad = 72, side = Math.min(art.naturalWidth, art.naturalHeight)
  if (!(side > 0)) throw new Error('Artwork has no pixels')
  const cut = document.createElement('canvas'); cut.width = cut.height = size
  const context = cut.getContext('2d')
  if (!context) throw new Error('Canvas 2D unavailable')
  context.beginPath(); context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); context.clip()
  context.drawImage(art, (art.naturalWidth - side) / 2, (art.naturalHeight - side) / 2, side, side, 0, 0, size, size)
  const disc = document.createElement('canvas'); disc.width = disc.height = size + pad
  const blurred = disc.getContext('2d')
  if (!blurred) throw new Error('Canvas 2D unavailable')
  blurred.filter = 'blur(16px)'; blurred.drawImage(cut, pad / 2, pad / 2)
  return disc
}

export async function generateWaveLightField(source: string, fallback?: () => Promise<string>): Promise<AlbumLightField> {
  async function read(url: string) {
    const art = await image(url)
    const sample = document.createElement('canvas'); sample.width = sample.height = 48
    const context = sample.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas 2D unavailable')
    context.drawImage(art, 0, 0, 48, 48)
    const field = renderAlbumLightField(source, extractLightPalette(context.getImageData(0, 0, 48, 48).data))
    try { field.disc = createArtworkDisc(art) } catch { /* The color field is an independent fallback. */ }
    return field
  }
  if ((!source || source.startsWith('fb2k://')) && fallback) {
    try { const safe = await fallback(); if (safe) return await read(safe) } catch { /* Try the rendered source next. */ }
  }
  if (source) {
    try { return await read(source) } catch {
      if (fallback) { try { const safe = await fallback(); if (safe) return await read(safe) } catch { /* Neutral fallback below. */ } }
    }
  }
  return renderAlbumLightField(source, [{ r: 80, g: 87, b: 94 }], true)
}

export function waveRenderSize(width: number, height: number, dpr: number) {
  const factor = Math.min(Math.max(dpr || 1, 1), 2) * .35
  const scale = Math.min(factor, 960 / Math.max(width, height, 1))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function createWaveBackgroundRenderer(canvas: HTMLCanvasElement, notify: (ready: boolean) => void) {
  let gl: WebGLRenderingContext | null = null, program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null
  let textures: WebGLTexture[] = [], shaders: WebGLShader[] = []
  let uniforms: Record<string, WebGLUniformLocation | null> = {}
  let field: HTMLCanvasElement | null = null, settings = { ...lightFieldDefaults }
  let active = false, disposed = false, initialized = false, frozen = false
  let frame = 0, last = 0, elapsed = 0, fadeAt = -1, lastDraw = 0
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { size(); wake() }) : null
  function stopLoop() { if (frame) cancelAnimationFrame(frame); frame = 0; last = 0 }
  function clearResources() {
    stopLoop()
    if (gl) {
      textures.forEach(texture => gl!.deleteTexture(texture)); shaders.forEach(shader => gl!.deleteShader(shader))
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
    }
    textures = []; shaders = []; buffer = program = null; gl = null; initialized = false
  }
  function size() {
    if (!gl) return
    const rect = canvas.getBoundingClientRect()
    const width = rect.width || canvas.parentElement?.parentElement?.getBoundingClientRect().width || window.innerWidth
    const height = rect.height || canvas.parentElement?.parentElement?.getBoundingClientRect().height || window.innerHeight
    const target = waveRenderSize(width, height, window.devicePixelRatio)
    if (canvas.width !== target.width || canvas.height !== target.height) {
      if (frozen && field) { upload(textures[0]!, field); frozen = false; fadeAt = -1 }
      canvas.width = target.width; canvas.height = target.height
    }
    const w = canvas.width, h = canvas.height, l = Math.max(w, h), wide = w > h
    gl.viewport(0, 0, w, h); gl.uniform2f(uniforms.uResolution!, w, h)
    gl.uniform4fv(uniforms['uCircles[0]']!, [w/2,h/2,l*1.5,-.25, w/2,h/2,l*(wide?1:.75),.5, 0,h,l*.75,1, w,0,l*(wide?.65:.5),-.75])
  }
  function upload(texture: WebGLTexture, value: HTMLCanvasElement) {
    if (!gl) return
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, value)
  }
  function bind() {
    if (!gl) return
    textures.forEach((texture, index) => { gl!.activeTexture(gl!.TEXTURE0 + index); gl!.bindTexture(gl!.TEXTURE_2D, texture) })
  }
  function draw(now: number) {
    if (!gl || !initialized) return
    if (last && active && settings.animated && settings.motion > 0 && !reduced.matches) elapsed += Math.min(100, now - last) * settings.speed / 3500
    last = now
    let mix = fadeAt < 0 ? 0 : Math.min(1, Math.max(0, (now - fadeAt) / 1000))
    if (reduced.matches && fadeAt >= 0) mix = 1
    if (mix >= 1) { textures.reverse(); frozen = false; fadeAt = -1; mix = 0 }
    bind()
    gl.uniform1f(uniforms.uMix!, mix); gl.uniform1f(uniforms.uFrozen!, frozen ? 1 : 0); gl.uniform1f(uniforms.uTime!, elapsed)
    gl.uniform1f(uniforms.uMotion!, settings.motion); gl.uniform1f(uniforms.uScale!, settings.glowScale)
    gl.uniform4f(uniforms.uOpacity!, settings.baseOpacity, .75 * settings.primaryIntensity, .5 * settings.secondaryIntensity, .5 * settings.secondaryIntensity)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
  function wake() {
    if (disposed || !gl || !initialized || !active || document.hidden) { stopLoop(); return }
    if (!frame) {
      draw(performance.now())
      if (reduced.matches || (!settings.animated || settings.motion === 0) && fadeAt < 0) { last = 0; return }
      const tick = (now: number) => {
        frame = 0
        if (disposed || !active || document.hidden || !gl) { last = 0; return }
        if (now - lastDraw >= 1000 / 60 - .2) { draw(now); lastDraw = now }
        if (!reduced.matches && (settings.animated && settings.motion > 0 || fadeAt >= 0)) frame = requestAnimationFrame(tick)
        else last = 0
      }
      frame = requestAnimationFrame(tick)
    }
  }
  function fail() { clearResources(); notify(false) }
  function init() {
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' })
      if (!gl) { notify(false); return }
      for (const [type, source] of [[gl.VERTEX_SHADER, vertexShader], [gl.FRAGMENT_SHADER, waveFragmentShader]] as const) {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('Shader unavailable')
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed')
      }
      program = gl.createProgram()
      if (!program) throw new Error('Program unavailable')
      shaders.forEach(shader => gl!.attachShader(program!, shader)); gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed')
      gl.useProgram(program); buffer = gl.createBuffer()
      if (!buffer) throw new Error('Vertex buffer unavailable')
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW)
      const location = gl.getAttribLocation(program, 'v'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
      uniforms = Object.fromEntries(['uA','uB','uResolution','uTime','uMix','uFrozen','uMotion','uScale','uOpacity','uCircles[0]'].map(name => [name, gl!.getUniformLocation(program!, name)]))
      gl.uniform1i(uniforms.uA!, 0); gl.uniform1i(uniforms.uB!, 1)
      for (let index = 0; index < 2; index++) {
        const texture = gl.createTexture()
        if (!texture) throw new Error('Texture unavailable')
        textures.push(texture); gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      }
      size(); if (field) setField(field)
    } catch { fail() }
  }
  function setField(value: HTMLCanvasElement) {
    field = value
    if (!gl) return false
    try {
      if (!initialized) {
        gl.activeTexture(gl.TEXTURE0); upload(textures[0]!, value)
        gl.activeTexture(gl.TEXTURE1); upload(textures[1]!, value)
        initialized = true; fadeAt = -1; frozen = false
      } else {
        const now = performance.now()
        if (fadeAt >= 0) {
          draw(now)
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textures[0]!)
          gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, canvas.width, canvas.height, 0)
          frozen = true
        }
        gl.activeTexture(gl.TEXTURE1); upload(textures[1]!, value); fadeAt = now
      }
      bind(); draw(performance.now()); notify(true); wake(); return true
    } catch { fail(); return false }
  }
  function lost(event: Event) { event.preventDefault(); fail() }
  function restored() { if (!disposed) init() }
  function visibility() { if (document.hidden) stopLoop(); else { last = 0; wake() } }
  canvas.addEventListener('webglcontextlost', lost); canvas.addEventListener('webglcontextrestored', restored)
  document.addEventListener('visibilitychange', visibility); reduced.addEventListener('change', visibility)
  resize?.observe(canvas); init()
  return {
    setField,
    clearField() { field = null; initialized = false; stopLoop(); notify(false) },
    setActive(value: boolean) { active = value; if (!value) stopLoop(); else { size(); wake() } },
    setSettings(value: LightFieldSettings) { settings = normalizeLightFieldSettings(value); stopLoop(); wake() },
    dispose() {
      disposed = true; clearResources(); resize?.disconnect(); field = null
      canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored)
      document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', visibility)
    },
  }
}
