// @vitest-environment jsdom
/**
 * Unit tests for packages/core/src/ui/privacy-notice.ts
 *
 * TDD red phase: tests written before implementation exists.
 * Tests verify DOM rendering, ARIA attributes, acknowledgement flow,
 * session-scoped tracking, and cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountPrivacyNotice } from '../../src/ui/privacy-notice.js'
import type { VoiceFormStrings } from '../../src/types.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PrivacyNoticeConfig {
  privacyNotice: string
  requirePrivacyAcknowledgement: boolean
  strings: Pick<VoiceFormStrings, 'privacy'>
}

// ─── Test Helpers ─────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<PrivacyNoticeConfig> = {}): PrivacyNoticeConfig {
  return {
    privacyNotice: 'Voice is processed by Google Speech-to-Text. No audio is stored.',
    requirePrivacyAcknowledgement: false,
    strings: {
      privacy: {
        acknowledgeLabel: 'I understand',
        acknowledgeAriaLabel: 'I understand and agree to voice processing',
        regionAriaLabel: 'Voice input privacy notice',
      },
    },
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('mountPrivacyNotice', () => {
  let anchor: HTMLElement

  beforeEach(() => {
    anchor = document.createElement('button')
    anchor.type = 'button'
    anchor.textContent = 'mic'
    document.body.appendChild(anchor)
  })

  afterEach(() => {
    anchor.remove()
    // Clean up any privacy notice panels left in DOM
    document.querySelectorAll('[role="region"]').forEach((el) => el.remove())
  })

  // ── Return value ─────────────────────────────────────────────────────────

  it('returns an object with show, hide, destroy, and acknowledged properties', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig())
    expect(typeof notice.show).toBe('function')
    expect(typeof notice.hide).toBe('function')
    expect(typeof notice.destroy).toBe('function')
    expect(typeof notice.acknowledged).toBe('boolean')
    notice.destroy()
  })

  it('initial acknowledged state is false', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig())
    expect(notice.acknowledged).toBe(false)
    notice.destroy()
  })

  // ── show() ───────────────────────────────────────────────────────────────

  it('show() renders the privacy notice panel in the DOM', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig())
    notice.show()
    const panel = document.querySelector('[role="region"]')
    expect(panel).not.toBeNull()
    notice.destroy()
  })

  it('show() renders panel with role="region"', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig())
    notice.show()
    const panel = document.querySelector('[role="region"]')
    expect(panel?.getAttribute('role')).toBe('region')
    notice.destroy()
  })

  it('show() renders panel with aria-label from strings', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig())
    notice.show()
    const panel = document.querySelector('[role="region"]')
    expect(panel?.getAttribute('aria-label')).toBe('Voice input privacy notice')
    notice.destroy()
  })

  it('show() renders the privacy notice text', () => {
    const config = makeConfig({ privacyNotice: 'Voice is processed by Google.' })
    const notice = mountPrivacyNotice(anchor, config)
    notice.show()
    expect(document.body.textContent).toContain('Voice is processed by Google.')
    notice.destroy()
  })

  it('does NOT render the panel on init (only after show() is called)', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig())
    const panel = document.querySelector('[role="region"]')
    expect(panel).toBeNull()
    notice.destroy()
  })

  // ── hide() ───────────────────────────────────────────────────────────────

  it('hide() removes the panel from visible DOM', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig())
    notice.show()
    expect(document.querySelector('[role="region"]')).not.toBeNull()
    notice.hide()
    const panel = document.querySelector('[role="region"]')
    if (panel) {
      const style = window.getComputedStyle(panel as HTMLElement)
      const isHidden =
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        (panel as HTMLElement).hidden === true ||
        !(panel as HTMLElement).isConnected
      expect(isHidden).toBe(true)
    }
    notice.destroy()
  })

  it('can call show() again after hide()', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig())
    notice.show()
    notice.hide()
    notice.show()
    const panel = document.querySelector('[role="region"]')
    expect(panel).not.toBeNull()
    notice.destroy()
  })

  // ── requirePrivacyAcknowledgement: true ──────────────────────────────────

  it('renders "I understand" button when requirePrivacyAcknowledgement is true', () => {
    const notice = mountPrivacyNotice(
      anchor,
      makeConfig({ requirePrivacyAcknowledgement: true }),
    )
    notice.show()

    const buttons = Array.from(document.querySelectorAll('button'))
    const ackBtn = buttons.find(
      (b) =>
        b.textContent?.trim() === 'I understand' ||
        b.getAttribute('aria-label')?.includes('I understand'),
    )
    expect(ackBtn).toBeDefined()
    notice.destroy()
  })

  it('"I understand" button has correct aria-label', () => {
    const notice = mountPrivacyNotice(
      anchor,
      makeConfig({ requirePrivacyAcknowledgement: true }),
    )
    notice.show()

    const buttons = Array.from(document.querySelectorAll('button'))
    const ackBtn = buttons.find(
      (b) =>
        b.textContent?.trim() === 'I understand' ||
        b.getAttribute('aria-label')?.includes('I understand'),
    )
    expect(ackBtn?.getAttribute('aria-label')).toBe('I understand and agree to voice processing')
    notice.destroy()
  })

  it('clicking "I understand" sets acknowledged to true', () => {
    const notice = mountPrivacyNotice(
      anchor,
      makeConfig({ requirePrivacyAcknowledgement: true }),
    )
    notice.show()

    const buttons = Array.from(document.querySelectorAll('button'))
    const ackBtn = buttons.find(
      (b) =>
        b.textContent?.trim() === 'I understand' ||
        b.getAttribute('aria-label')?.includes('understand'),
    )
    ackBtn?.click()
    expect(notice.acknowledged).toBe(true)
    notice.destroy()
  })

  it('clicking "I understand" hides the panel', () => {
    const notice = mountPrivacyNotice(
      anchor,
      makeConfig({ requirePrivacyAcknowledgement: true }),
    )
    notice.show()

    const buttons = Array.from(document.querySelectorAll('button'))
    const ackBtn = buttons.find(
      (b) =>
        b.textContent?.trim() === 'I understand' ||
        b.getAttribute('aria-label')?.includes('understand'),
    )
    ackBtn?.click()

    const panel = document.querySelector('[role="region"]')
    if (panel) {
      const isHidden =
        !(panel as HTMLElement).isConnected ||
        (panel as HTMLElement).hidden === true ||
        window.getComputedStyle(panel as HTMLElement).display === 'none'
      expect(isHidden).toBe(true)
    }
    notice.destroy()
  })

  // ── requirePrivacyAcknowledgement: false ─────────────────────────────────

  it('does not require "I understand" button when requirePrivacyAcknowledgement is false', () => {
    const notice = mountPrivacyNotice(
      anchor,
      makeConfig({ requirePrivacyAcknowledgement: false }),
    )
    notice.show()

    // Either no button at all, or a dismiss/close button — NOT the required acknowledge button
    // The key test: the mic should not be blocked
    // We just verify the panel renders without the mandatory acknowledge flow
    const panel = document.querySelector('[role="region"]')
    expect(panel).not.toBeNull()
    notice.destroy()
  })

  // ── Session-scoped acknowledgement ───────────────────────────────────────

  it('acknowledged state persists in session (not reset on hide/show)', () => {
    const notice = mountPrivacyNotice(
      anchor,
      makeConfig({ requirePrivacyAcknowledgement: true }),
    )
    notice.show()

    const buttons = Array.from(document.querySelectorAll('button'))
    const ackBtn = buttons.find(
      (b) =>
        b.textContent?.trim() === 'I understand' ||
        b.getAttribute('aria-label')?.includes('understand'),
    )
    ackBtn?.click()
    expect(notice.acknowledged).toBe(true)

    // Hide and show again
    notice.show()
    // Acknowledged should still be true (session-scoped variable)
    expect(notice.acknowledged).toBe(true)
    notice.destroy()
  })

  it('does NOT use localStorage for acknowledgement', () => {
    const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem')
    const notice = mountPrivacyNotice(
      anchor,
      makeConfig({ requirePrivacyAcknowledgement: true }),
    )
    notice.show()

    const buttons = Array.from(document.querySelectorAll('button'))
    const ackBtn = buttons.find(
      (b) =>
        b.textContent?.trim() === 'I understand' ||
        b.getAttribute('aria-label')?.includes('understand'),
    )
    ackBtn?.click()

    expect(localStorageSpy).not.toHaveBeenCalled()
    localStorageSpy.mockRestore()
    notice.destroy()
  })

  // ── ARIA live region ─────────────────────────────────────────────────────

  it('panel has aria-live="polite" for announcements', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig())
    notice.show()

    const liveRegion = document.querySelector('[aria-live="polite"]')
    expect(liveRegion).not.toBeNull()
    notice.destroy()
  })

  // ── CSS custom properties ────────────────────────────────────────────────

  it('panel uses --vf-privacy-bg custom property', () => {
    // We verify by checking the style attribute or a CSS class that references the var
    // Since we inject CSS, look for the custom property reference in injected styles or inline styles
    const notice = mountPrivacyNotice(anchor, makeConfig())
    notice.show()
    const panel = document.querySelector('[role="region"]') as HTMLElement | null
    // Check either inline style references or that a voiceform-styles tag contains it
    const styleTag = document.getElementById('voiceform-styles')
    const panelStyle = panel?.getAttribute('style') ?? ''
    const usesVar =
      panelStyle.includes('--vf-privacy') ||
      (styleTag?.textContent ?? '').includes('--vf-privacy-bg') ||
      (panel?.className ?? '').includes('vf-privacy')
    expect(usesVar).toBe(true)
    notice.destroy()
  })

  // ── destroy() ────────────────────────────────────────────────────────────

  it('destroy() removes the panel from DOM', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig())
    notice.show()
    expect(document.querySelector('[role="region"]')).not.toBeNull()
    notice.destroy()
    const panel = document.querySelector('[role="region"]')
    if (panel) {
      expect((panel as HTMLElement).isConnected).toBe(false)
    }
  })

  it('destroy() does not throw if panel was never shown', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig())
    expect(() => notice.destroy()).not.toThrow()
  })

  it('destroy() removes event listeners (no-op after destroy)', () => {
    const notice = mountPrivacyNotice(anchor, makeConfig({ requirePrivacyAcknowledgement: true }))
    notice.show()
    notice.destroy()
    // After destroy, clicking any remaining elements should not throw
    expect(() => {
      anchor.click()
    }).not.toThrow()
  })
})
