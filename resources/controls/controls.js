;(function () {
  const title = document.getElementById('title')
  let payload = null

  async function loadPayload() {
    if (!window.starcast || !window.starcast.controls) return
    payload = await window.starcast.controls.getPayload()
    if (payload) {
      title.textContent = payload.deviceName || payload.deviceId
      title.title = `${payload.deviceName || ''} (${payload.deviceId})`
    }
  }

  document.addEventListener('DOMContentLoaded', loadPayload)
  setTimeout(loadPayload, 600)

  async function act(action) {
    if (!payload) await loadPayload()
    if (!payload) return
    const { deviceId } = payload
    const control = window.starcast.control
    switch (action) {
      case 'back':
      case 'home':
      case 'recents':
      case 'power':
      case 'volumeUp':
      case 'volumeDown':
        return control.key(deviceId, action)
      case 'rotate':
        return control.rotate(deviceId, 'auto')
      case 'notifications':
        return control.notifications(deviceId, true)
      case 'screenshot':
        return window.starcast.device.screenshot(deviceId)
      default:
        return null
    }
  }

  for (const btn of document.querySelectorAll('.btn')) {
    btn.addEventListener('click', () => {
      act(btn.dataset.action).catch((e) => console.error('[controls]', e))
    })
  }
})()
