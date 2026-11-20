;(function () {
  const bezel = document.getElementById('bezel')
  const screen = document.getElementById('screen')
  const screenCanvas = document.getElementById('screenCanvas')
  const btns = document.getElementById('win-btns')
  const frameTitle = document.getElementById('frame-title')
  const btnTopmost = document.getElementById('btn-topmost')
  const btnMin = document.getElementById('btn-min')
  const btnClose = document.getElementById('btn-close')
  let payload = null
  let renderedReported = false
  let dropHintTimer = null

  function log(...args) {
    console.log('[frame]', ...args)
  }

  function render(data) {
    if (!data || !data.model) {
      log('payload 为空，等待兜底重试')
      return
    }
    payload = data
    const model = data.model
    const p = model.padding
    log('渲染边框', data.sessionId, model.id)

    bezel.style.borderWidth = `${p.top}px ${p.right}px ${p.bottom}px ${p.left}px`
    const color = model.accent || '#26262b'
    const r =
      model.id === 'none'
        ? 0
        : Math.round(
            Math.sqrt(
              Math.max(0, model.radius - Math.min(p.left, p.right)) *
                Math.max(0, model.radius - Math.min(p.top, p.bottom))
            )
          )
    bezel.style.borderRadius =
      r <= 0
        ? '0'
        : `${r + p.left}px ${r + p.right}px ${r + p.right}px ${r + p.left}px / ${r + p.top}px ${r + p.top}px ${r + p.bottom}px ${r + p.bottom}px`
    bezel.style.borderColor = color
    bezel.style.boxShadow = 'none'
    bezel.style.opacity = String(data.opacity ?? 1)

    if (data.unified) {
      const isHos = data.stream === 'hos' || data.stream === 'scrcpy'
      const view = isHos ? screenCanvas : screen
      const other = isHos ? screen : screenCanvas
      other.style.display = 'none'
      view.style.display = 'block'
      view.style.left = `${p.left}px`
      view.style.top = `${p.top}px`
      view.style.width = `calc(100% - ${p.left + p.right}px)`
      view.style.height = `calc(100% - ${p.top + p.bottom}px)`
      view.style.borderRadius = `${r}px`
      if (isHos && data.deviceSize && data.deviceSize.width > 0) {
        if (screenCanvas.width !== data.deviceSize.width || screenCanvas.height !== data.deviceSize.height) {
          screenCanvas.width = data.deviceSize.width
          screenCanvas.height = data.deviceSize.height
          log('画布分辨率', screenCanvas.width, screenCanvas.height)
        }
      }
    } else {
      screen.style.display = 'none'
      screenCanvas.style.display = 'none'
    }

    const btnSize = model.id === 'none' ? 20 : Math.min(18, Math.max(12, p.top - 6))
    for (const b of [btnTopmost, btnMin, btnClose]) {
      b.style.width = `${btnSize}px`
      b.style.height = `${btnSize}px`
    }
    if (model.id === 'none') {
      btns.style.top = '10px'
      btns.style.right = '10px'
    } else {
      btns.style.top = `${-(p.top + btnSize) / 2}px`
      btns.style.right = `${Math.max(20, Math.round(model.radius * 0.8))}px`
    }
    btnTopmost.classList.toggle('active', !!data.topmost)
    btnTopmost.title = data.topmost ? '取消置顶' : '开启置顶'

    const devName = (data.device && (data.device.name || data.device.id)) || ''
    if (frameTitle) {
      frameTitle.textContent = devName
      const titleLeft = p.left + 6
      const reservedRight = (model.id === 'none' ? 92 : Math.max(92, Math.round(model.radius * 0.8) + 62))
      const avail = Math.max(0, window.innerWidth - titleLeft - reservedRight)
      frameTitle.style.left = `${titleLeft}px`
      frameTitle.style.maxWidth = `${avail}px`
      const lineH = 11
      const top = model.id === 'none' ? 6 : Math.max(2, Math.round((p.top - lineH) / 2))
      frameTitle.style.top = `${top}px`
      frameTitle.style.display = devName && avail > 24 ? 'block' : 'none'
    }

    if (!renderedReported) {
      renderedReported = true
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (window.starcast && window.starcast.frame) window.starcast.frame.rendered()
        })
      })
    }
  }

  async function loadPayload() {
    if (!window.starcast || !window.starcast.frame) {
      log('preload 未就绪，稍后兜底重试')
      return
    }
    const data = await window.starcast.frame.getPayload()
    log('拉取 payload', data ? data.sessionId : 'null')
    render(data)
  }

  document.addEventListener('DOMContentLoaded', () => {
    log('DOMContentLoaded')
    loadPayload()
  })

  setTimeout(loadPayload, 600)
  setTimeout(loadPayload, 1500)

  if (window.starcast && window.starcast.frame) {
    window.starcast.frame.onUpdated((data) => {
      log('收到推送更新')
      render(data)
    })
  }

  const h264 = {
    decoder: null,
    configured: false,
    sps: null,
    pps: null,
    pendingIdr: null,
    delivered: 0,
    fed: 0,
    ctx: screenCanvas.getContext('2d'),
    frames: 0
  }

  function parseNals(data) {
    const nals = []
    let start = -1
    for (let i = 0; i < data.length - 3; i++) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
        if (start >= 0) nals.push(data.subarray(start, i))
        start = i + 3
      } else if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) {
        if (start >= 0) nals.push(data.subarray(start, i))
        start = i + 4
        i++
      }
    }
    if (start >= 0) nals.push(data.subarray(start))
    return nals.filter((n) => n.length > 0)
  }

  function spsInfo(sps) {
    if (!sps || sps.length < 4) return null
    return { profile: sps[1], compat: sps[2], level: sps[3] }
  }

  function hex2(n) {
    return n.toString(16).padStart(2, '0')
  }

  function configureDecoder(sps, pps) {
    if (h264.configured || !sps || !pps) return
    const info = spsInfo(sps)
    if (!info) return
    const codec = `avc1.${hex2(info.profile)}${hex2(info.compat)}${hex2(info.level)}`
    try {
      h264.decoder.configure({ codec, optimizeForLatency: true })
      h264.configured = true
      log('H.264 解码器已配置(Annex-B)', codec)
    } catch (e) {
      log('解码器配置失败', e.message)
    }
  }

  function ensureDecoder() {
    if (h264.decoder) return
    try {
      h264.decoder = new VideoDecoder({
        output(frame) {
          if (h264.frames < 3) log('首帧输出', frame.displayWidth, frame.displayHeight, 'canvas', screenCanvas.width, screenCanvas.height)
          if (screenCanvas.width && screenCanvas.height) {
            h264.ctx.drawImage(frame, 0, 0, screenCanvas.width, screenCanvas.height)
          }
          frame.close()
          h264.frames++
          if (window.starcast && window.starcast.frame && window.starcast.frame.invalidate && Date.now() - (h264.lastInvalidate || 0) > 120) {
            h264.lastInvalidate = Date.now()
            window.starcast.frame.invalidate().catch(() => {})
          }
          if (h264.frames === 1 || h264.frames % 100 === 0) log('累计解码帧', h264.frames)
        },
        error(e) {
          log('解码错误', e.message)
        }
      })
      log('VideoDecoder 已创建')
    } catch (e) {
      log('VideoDecoder 不支持', e.message)
    }
  }

  function emitChunk(sps, pps, slices, isKey) {
    const out = []
    const SC = new Uint8Array([0, 0, 0, 1])
    if (sps && isKey) { out.push(SC, sps) }
    if (pps && isKey) { out.push(SC, pps) }
    for (const s of slices) { out.push(SC, s.nal) }
    const total = out.reduce((a, n) => a + n.length, 0)
    const chunk = new Uint8Array(total)
    let off = 0
    for (const n of out) { chunk.set(n, off); off += n.length }
    const now = performance.now() * 1000
    try {
      h264.decoder.decode(
        new EncodedVideoChunk({ type: isKey ? 'key' : 'delta', timestamp: Math.round(now), data: chunk })
      )
      h264.fed++
    } catch (e) {
      log('decode 异常', e.message)
    }
  }

  function feedH264(bytes) {
    if (!h264.decoder) return
    const nals = parseNals(bytes)
    let sps = null
    let pps = null
    const slices = []
    for (const nal of nals) {
      const type = nal[0] & 0x1f
      if (type === 7) sps = nal
      else if (type === 8) pps = nal
      else if (type === 1 || type === 5 || type === 2) slices.push({ nal, idr: type === 5 })
    }
    if (sps) h264.sps = sps
    if (pps) h264.pps = pps
    if (!h264.configured && h264.sps && h264.pps) configureDecoder(h264.sps, h264.pps)

    const idrSlices = slices.filter((s) => s.idr)
    if (idrSlices.length) h264.pendingIdr = { slices: idrSlices, sps: sps || h264.sps, pps: pps || h264.pps }
    if (!h264.configured) return

    if (h264.pendingIdr) {
      const key = h264.pendingIdr
      h264.pendingIdr = null
      if (h264.fed === 0) log('补发缓存关键帧', key.slices.length, '片')
      emitChunk(key.sps, key.pps, key.slices, true)
    }
    if (!slices.length) return
    emitChunk(sps, pps, slices, slices.some((s) => s.idr))
  }

  ensureDecoder()
  const deliverFrame = (bytes) => {
    if (screenCanvas.style.display === 'none') return
    h264.delivered++
    if (h264.delivered <= 3 || h264.delivered % 150 === 0) {
      log('收到帧', h264.delivered, '字节', bytes.length, '已解码', h264.fed)
    }
    feedH264(new Uint8Array(bytes))
  }
  if (window.starcast && window.starcast.hos) window.starcast.hos.onFrame(deliverFrame)
  if (window.starcast && window.starcast.scrcpyFrame) window.starcast.scrcpyFrame(deliverFrame)

  let touchDown = null
  function bindTouch(view) {
    if (!view) return
    view.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const box = view.getBoundingClientRect()
      touchDown = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height, t: Date.now() }
    })
    view.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !touchDown) return
      e.stopPropagation()
      const box = view.getBoundingClientRect()
      const up = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height }
      const start = touchDown
      touchDown = null
      if (!window.starcast || !window.starcast.hos) return
      const dist = Math.hypot(up.x - start.x, up.y - start.y)
      if (dist < 0.012) {
        window.starcast.hos.input({ type: 'tap', x: up.x, y: up.y })
      } else {
        window.starcast.hos.input({
          type: 'swipe',
          x1: start.x, y1: start.y, x2: up.x, y2: up.y,
          ms: Math.max(80, Math.min(800, Date.now() - start.t))
        })
      }
    })
    view.addEventListener('wheel', (e) => {
      if (!payload || !payload.unified || !window.starcast || !window.starcast.hos) return
      e.preventDefault()
      e.stopPropagation()
      const box = view.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width))
      const y = Math.max(0, Math.min(1, (e.clientY - box.top) / box.height))
      const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.height : 1
      window.starcast.hos.input({
        type: 'scroll', x, y,
        deltaX: e.deltaX * scale,
        deltaY: e.deltaY * scale
      })
    }, { passive: false })
    view.addEventListener('contextmenu', (e) => {
      if (!payload || !payload.unified || !window.starcast || !window.starcast.hos) return
      e.preventDefault()
      e.stopPropagation()
      window.starcast.hos.key('back')
    })
  }
  bindTouch(screen)
  bindTouch(screenCanvas)

  function isRing(e) {
    if (!payload || !payload.model || payload.model.id === 'none') return false
    const p = payload.model.padding
    const w = window.innerWidth
    const h = window.innerHeight
    return e.clientX < p.left || e.clientX > w - p.right || e.clientY < p.top || e.clientY > h - p.bottom
  }

  function hitButton(e) {
    const pad = 3
    for (const b of [btnTopmost, btnMin, btnClose]) {
      const r = b.getBoundingClientRect()
      if (e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad) {
        return true
      }
    }
    return false
  }

  let lastState = null
  let lastMove = 0
  document.addEventListener('mousemove', (e) => {
    const now = Date.now()
    const onBtn = hitButton(e)
    const ring = isRing(e)
    document.body.style.cursor = onBtn ? 'pointer' : ring ? 'move' : 'default'
    const interactive = ring || onBtn
    if (now - lastMove < 30 || interactive === lastState) return
    lastMove = now
    lastState = interactive
    if (window.starcast && window.starcast.frame) {
      window.starcast.frame.mouseState({ ring: interactive })
    }
  })

  document.addEventListener('mouseleave', () => {
    document.body.style.cursor = 'default'
    lastState = false
    if (window.starcast && window.starcast.frame) {
      window.starcast.frame.mouseState({ ring: false })
    }
  })

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || hitButton(e)) return
    if (!isRing(e)) return
    e.preventDefault()
    if (window.starcast && window.starcast.frame) {
      window.starcast.frame.dragStart()
    }
  })

  document.addEventListener('mouseup', () => {
    if (window.starcast && window.starcast.frame) {
      window.starcast.frame.dragEnd()
    }
  })

  function bindButton(el, action) {
    el.addEventListener('mousedown', (e) => e.stopPropagation())
    el.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!payload || !window.starcast) return
      log('窗口控制', action)
      window.starcast.windowControl(payload.sessionId, action)
    })
  }
  bindButton(btnTopmost, 'topmost')
  bindButton(btnMin, 'minimize')
  bindButton(btnClose, 'close')

  function showDropHint(text) {
    let hint = document.getElementById('drop-hint')
    if (!hint) {
      hint = document.createElement('div')
      hint.id = 'drop-hint'
      hint.style.cssText = 'position:absolute;left:50%;bottom:24px;transform:translateX(-50%);z-index:50;' +
        'background:rgba(18,18,22,.92);color:#fff;padding:9px 18px;border-radius:10px;' +
        'font:13px -apple-system,"Microsoft YaHei",sans-serif;pointer-events:none;white-space:nowrap;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.5);transition:opacity .2s'
      document.body.appendChild(hint)
    }
    hint.textContent = text
    hint.style.opacity = '1'
    clearTimeout(dropHintTimer)
    dropHintTimer = setTimeout(() => { hint.style.opacity = '0' }, 2600)
  }

  window.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  })
  window.addEventListener('drop', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!payload || !window.starcast || !window.starcast.device) {
      showDropHint('设备接口不可用')
      return
    }
    const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : []
    if (!files.length) return
    const deviceId = (payload.device && payload.device.id) || ''
    let ok = 0
    let fail = 0
    let lastError = ''
    for (const f of files) {
      let p = null
      try { p = window.starcast.getPathForFile && window.starcast.getPathForFile(f) } catch {}
      p = p || f.path || (f.webkitRelativePath && f.name)
      if (!p) { fail++; lastError = '无法获取文件路径'; continue }
      try {
        if (/\.(apk|hap)$/i.test(f.name)) {
          const r = await window.starcast.device.install(deviceId, p)
          if (r && r.ok) ok++; else { fail++; lastError = r && r.message }
        } else {
          const remote = `/sdcard/Download/${f.name}`
          const r = await window.starcast.device.push(deviceId, p, remote)
          if (r && r.ok) ok++; else { fail++; lastError = r && r.message }
        }
      } catch (e) { fail++; lastError = e && e.message }
    }
    const summary = `完成：成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ''}`
    showDropHint(lastError ? `${summary} · ${String(lastError).slice(0, 90)}` : summary)
  })

  const NAV_KEYS = {
    Enter: 'enter',
    Backspace: 'del',
    Delete: 'del',
    Tab: 61,
    Escape: 'back',
    ArrowUp: 19,
    ArrowDown: 20,
    ArrowLeft: 21,
    ArrowRight: 22,
    Home: 122,
    End: 123,
    PageUp: 92,
    PageDown: 93
  }
  document.addEventListener('keydown', (e) => {
    if (!payload || !payload.unified || !window.starcast) return
    const k = e.key || ''
    const key = k.toLowerCase()
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl && key === 'v') {
      e.preventDefault()
      e.stopPropagation()
      window.starcast.clipboard.pasteToDevice(payload.sessionId).then((r) => {
        showDropHint(r && r.ok ? '已粘贴到手机' : (r && r.message) || '粘贴失败')
      }).catch(() => showDropHint('粘贴失败'))
      return
    }
    if (ctrl && (key === 'c' || key === 'x')) {
      e.preventDefault()
      e.stopPropagation()
      const cut = key === 'x'
      window.starcast.clipboard.copyFromDevice(cut)
        .then(() => showDropHint(cut ? '已在手机剪切' : '已在手机复制'))
        .catch(() => showDropHint('操作失败'))
      return
    }
    if (ctrl && key === 'a') {
      e.preventDefault()
      e.stopPropagation()
      if (window.starcast.hos) window.starcast.hos.key('selectAll')
      else if (window.starcast.input) window.starcast.input.keycode(29, 0x3000)
      return
    }
    if (!ctrl && !e.altKey) {
      const nav = NAV_KEYS[k]
      if (nav != null && window.starcast.hos) {
        e.preventDefault()
        e.stopPropagation()
        window.starcast.hos.key(nav)
        return
      }
      if (k.length === 1 && window.starcast.input) {
        e.preventDefault()
        e.stopPropagation()
        window.starcast.input.text(k)
      }
    }
  })
})()
