import type { Rectangle } from 'electron'

type DisplayLike = {
  bounds: Rectangle
  workArea: Rectangle
}

type WindowStateLike = {
  x?: number
  y?: number
  width: number
  height: number
}

type WindowStatePatch = Pick<WindowStateLike, 'x' | 'y' | 'width' | 'height'>

function getIntersectionArea(a: Rectangle, b: Rectangle): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)

  if (right <= left || bottom <= top) {
    return 0
  }

  return (right - left) * (bottom - top)
}

function clampWindowSize(windowBounds: Rectangle, workArea: Rectangle): Rectangle {
  return {
    ...windowBounds,
    width: Math.min(windowBounds.width, workArea.width),
    height: Math.min(windowBounds.height, workArea.height)
  }
}

function centerWindowInWorkArea(windowBounds: Rectangle, workArea: Rectangle): WindowStatePatch {
  const safeBounds = clampWindowSize(windowBounds, workArea)

  return {
    width: safeBounds.width,
    height: safeBounds.height,
    x: workArea.x + Math.round((workArea.width - safeBounds.width) / 2),
    y: workArea.y + Math.round((workArea.height - safeBounds.height) / 2)
  }
}

export function getSafeWindowState(
  windowState: WindowStateLike,
  displays: DisplayLike[],
  primaryDisplay: DisplayLike
): WindowStatePatch {
  const { x, y, width, height } = windowState

  if (typeof x !== 'number' || typeof y !== 'number') {
    return centerWindowInWorkArea({ x: 0, y: 0, width, height }, primaryDisplay.workArea)
  }

  const windowBounds = { x, y, width, height }
  const hasVisibleDisplay = displays.some((display) => {
    return getIntersectionArea(windowBounds, display.workArea) > 0
  })

  if (hasVisibleDisplay) {
    return { x, y, width, height }
  }

  return centerWindowInWorkArea(windowBounds, primaryDisplay.workArea)
}
