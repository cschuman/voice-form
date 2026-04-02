// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/index.js'

describe('@voiceform/core', () => {
  it('exports a VERSION string', () => {
    expect(typeof VERSION).toBe('string')
    expect(VERSION).toBe('0.0.0')
  })

  it('is a valid semver stub', () => {
    const semverPattern = /^\d+\.\d+\.\d+/
    expect(VERSION).toMatch(semverPattern)
  })
})
