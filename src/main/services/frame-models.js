export const frameModels = {
  'galaxy-s24': {
    id: 'galaxy-s24',
    name: 'Galaxy S24 风格',
    padding: { top: 24, right: 11, bottom: 15, left: 11 },
    radius: 44,
    accent: '#26262b',
    notch: 'punch-hole',
    buttons: true
  },
  'mate-60': {
    id: 'mate-60',
    name: 'Mate 60 风格',
    padding: { top: 24, right: 11, bottom: 15, left: 11 },
    radius: 48,
    accent: '#20242c',
    notch: 'punch-hole-center',
    buttons: true
  },
  'pixel-8': {
    id: 'pixel-8',
    name: 'Pixel 8 风格',
    padding: { top: 24, right: 10, bottom: 12, left: 10 },
    radius: 40,
    accent: '#2a2d33',
    notch: 'punch-hole-center',
    buttons: true
  },
  generic: {
    id: 'generic',
    name: '通用边框',
    padding: { top: 24, right: 10, bottom: 12, left: 10 },
    radius: 36,
    accent: '#1f2229',
    notch: 'none',
    buttons: true
  },
  none: {
    id: 'none',
    name: '无边框',
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    radius: 0,
    accent: 'transparent',
    notch: 'none',
    buttons: false
  }
}

export function getFrameModel(id) {
  return frameModels[id] || frameModels['galaxy-s24']
}
