import { describe, expect, it } from 'vitest'

import { getSafeWindowState } from '../windowState'

const primaryDisplay = {
  bounds: { x: 0, y: 0, width: 1512, height: 982 },
  workArea: { x: 0, y: 25, width: 1512, height: 945 }
}

describe('windowState', () => {
  it('keeps a window that is already visible on the current displays', () => {
    expect(getSafeWindowState({ x: 120, y: 80, width: 960, height: 600 }, [primaryDisplay], primaryDisplay)).toEqual({
      x: 120,
      y: 80,
      width: 960,
      height: 600
    })
  })

  it('recenters a window that was saved on a disconnected display', () => {
    expect(getSafeWindowState({ x: -1450, y: 300, width: 960, height: 600 }, [primaryDisplay], primaryDisplay)).toEqual(
      {
        x: 276,
        y: 198,
        width: 960,
        height: 600
      }
    )
  })

  it('recenters and clamps a window that is larger than the current work area', () => {
    expect(
      getSafeWindowState({ x: -2200, y: -120, width: 2200, height: 1400 }, [primaryDisplay], primaryDisplay)
    ).toEqual({
      x: 0,
      y: 25,
      width: 1512,
      height: 945
    })
  })

  it('falls back to the primary display when position is missing', () => {
    expect(getSafeWindowState({ width: 960, height: 600 }, [primaryDisplay], primaryDisplay)).toEqual({
      x: 276,
      y: 198,
      width: 960,
      height: 600
    })
  })
})
